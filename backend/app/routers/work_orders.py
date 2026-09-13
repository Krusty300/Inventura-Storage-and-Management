from datetime import datetime, timezone
from math import ceil
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.constants import MAX_PAGE_SIZE, MAX_PAGE_SIZE_LOOKUP
from app.database import get_db
from app.models import BOM, BOMItem, Location, Lot, LotLink, Product, SerialNumber, StockMovement, WorkOrder, WorkOrderItem
from app.models.settings import Settings
from app.schemas.work_order import WorkOrderComplete, WorkOrderCreate, WorkOrderOut, WorkOrderUpdate
from app.services import inventory
from app.services.auth import require_permission
from app.services.filters import apply_date_range, apply_numeric_range
from app.services.sequences import next_document_number
from app.services.pdf_helpers import (
    BODY_RIGHT, MARGIN, money, draw_banner_header, draw_info_block, draw_item_table,
    draw_notes, draw_page_footer, draw_signoff, draw_totals, new_canvas, render_pdf,
)
from app.utils import get_or_404, log_activity, broadcast_change

router = APIRouter(prefix="/api/work-orders", tags=["work-orders"], dependencies=[Depends(require_permission("work_orders.view"))])


def _load_wo(db: Session, wo_id: int) -> WorkOrder:
    return get_or_404(WorkOrder, wo_id, db, options=[
        joinedload(WorkOrder.items).joinedload(WorkOrderItem.product),
        joinedload(WorkOrder.product), joinedload(WorkOrder.bom),
        joinedload(WorkOrder.wip_location), joinedload(WorkOrder.creator),
    ])


def _validate_output(db: Session, product_id: int) -> Product:
    product = get_or_404(Product, product_id, db)
    if not product.is_active:
        raise HTTPException(status_code=400, detail=f"'{product.display_name}' is inactive")
    if product.is_variant or product.parent_id is not None:
        raise HTTPException(status_code=400, detail=f"'{product.display_name}' is a variant - use the parent product")
    return product


def _validate_component(db: Session, product_id: int, output_id: int) -> None:
    if product_id == output_id:
        raise HTTPException(status_code=400, detail="A component cannot be the same product being manufactured")
    product = get_or_404(Product, product_id, db)
    if not product.is_active:
        raise HTTPException(status_code=400, detail=f"'{product.display_name}' is inactive")
    if product.is_variant or product.parent_id is not None:
        raise HTTPException(status_code=400, detail=f"'{product.display_name}' is a variant - use the parent product")


def _snapshot_bom(db: Session, bom_id: int, output_id: int, quantity: int) -> list[WorkOrderItem]:
    bom = get_or_404(BOM, bom_id, db, options=[joinedload(BOM.items).joinedload(BOMItem.product)])
    if bom.product_id != output_id:
        raise HTTPException(status_code=400, detail="The selected BOM does not produce this product")
    return [
        WorkOrderItem(product_id=item.product_id, quantity_required=item.quantity * quantity, quantity_issued=0)
        for item in bom.items
    ]


def _wip_location(db: Session) -> Location:
    loc = db.query(Location).filter(Location.location_type == "wip").first()
    if loc is None:
        loc = Location(name="Work In Progress", code="WIP", location_type="wip")
        db.add(loc)
        db.flush()
    return loc


def _issue_component(db: Session, wo: WorkOrder, item: WorkOrderItem, quantity: int, user_id: int) -> None:
    """Issue `quantity` of a component from sellable stock into the WIP location.

    Serialized components are issued unit-by-unit with serial tracking; lots are
    allocated FEFO so genealogy links to the exact source serials.
    """
    product = db.get(Product, item.product_id)
    if product and product.is_serialized:
        serials = inventory.allocate_serials(db, product_id=item.product_id, quantity=quantity)
        for serial in serials:
            inventory.post_journal_entry(
                db,
                product_id=item.product_id,
                user_id=user_id,
                quantity_change=-1,
                movement_type=inventory.BACKFLUSH,
                from_location_id=serial.location_id,
                to_location_id=wo.wip_location_id,
                lot_id=serial.lot_id,
                serial_id=serial.id,
                reference_type="work_order",
                reference=wo.wo_number,
                notes=f"Issued to {wo.wo_number}",
            )
        item.quantity_issued += quantity
        return
    remaining = quantity
    allocation = inventory.allocate_lots(db, product_id=item.product_id, quantity=remaining)
    for lot_id, take, source_location, lpn_id in allocation:
        inventory.post_journal_entry(
            db,
            product_id=item.product_id,
            user_id=user_id,
            quantity_change=-take,
            movement_type=inventory.BACKFLUSH,
            from_location_id=source_location,
            to_location_id=wo.wip_location_id,
            lot_id=lot_id,
            lpn_id=lpn_id,
            reference_type="work_order",
            reference=wo.wo_number,
            notes=f"Issued to {wo.wo_number}",
        )
        remaining -= take
    if remaining > 0:
        raise inventory.InventoryError(f"Insufficient stock for component '{item.product_name}': need {quantity}")
    item.quantity_issued += quantity


def _revert_component_issues(db: Session, wo: WorkOrder, user_id: int) -> int:
    """Return component stock issued to a work order back to its source locations.

    Serialized components are restored via ``release_serial_from_reserved`` (back
    to the location they were issued from); bulk components get a positive
    ``release`` journal entry restoring each source stock line. Resets each
    item's ``quantity_issued`` to zero. Returns the number of movements reverted.
    """
    movements = (
        db.query(StockMovement)
        .filter(
            StockMovement.reference_type == "work_order",
            StockMovement.reference == wo.wo_number,
            StockMovement.movement_type.in_([inventory.ISSUE, inventory.BACKFLUSH]),
        )
        .order_by(StockMovement.id.desc())
        .all()
    )
    for m in movements:
        if m.serial_id is not None:
            serial = db.get(SerialNumber, m.serial_id)
            if serial is not None and serial.status == inventory.SERIAL_STATUS_RESERVED:
                inventory.release_serial_from_reserved(
                    db, serial=serial, user_id=user_id,
                    reference=wo.wo_number, notes=f"Cancelled {wo.wo_number} - component returned to stock",
                )
        else:
            inventory.post_journal_entry(
                db,
                product_id=m.product_id,
                user_id=user_id,
                quantity_change=-m.quantity_change,
                movement_type=inventory.RELEASE,
                to_location_id=m.from_location_id if m.from_location_id is not None else m.to_location_id,
                lot_id=m.lot_id,
                lpn_id=m.lpn_id,
                reference_type="work_order",
                reference=wo.wo_number,
                notes=f"Cancelled {wo.wo_number} - component returned to stock",
            )
    for item in wo.items:
        item.quantity_issued = 0
    return len(movements)


def _consume_issued_serials(db: Session, wo: WorkOrder) -> int:
    """Flip reserved component serials issued to a completed work order to
    ``consumed`` so they leave stock and render as used. Returns the count."""
    movements = (
        db.query(StockMovement)
        .filter(
            StockMovement.reference_type == "work_order",
            StockMovement.reference == wo.wo_number,
            StockMovement.movement_type.in_([inventory.ISSUE, inventory.BACKFLUSH]),
            StockMovement.serial_id.isnot(None),
        )
        .all()
    )
    consumed = 0
    for m in movements:
        serial = db.get(SerialNumber, m.serial_id)
        if serial is None or serial.product_id != m.product_id:
            continue
        if serial.status in (inventory.SERIAL_STATUS_RESERVED, inventory.SERIAL_STATUS_INACTIVE):
            inventory.post_journal_entry(
                db,
                product_id=m.product_id,
                user_id=wo.created_by,
                quantity_change=-1,
                movement_type=inventory.CONSUME,
                from_location_id=wo.wip_location_id,
                serial_id=serial.id,
                reference_type="work_order",
                reference=wo.wo_number,
                notes=f"Consumed by {wo.wo_number}",
            )
            consumed += 1
    return consumed


def _create_lot_links(db: Session, wo: WorkOrder, fg_lot_id: int) -> None:
    """Record parent->child genealogy links for a completed work order.

    Parents are every lot consumed from by this work order (releases and
    backflushes) sourced from its stock movements; the child is the
    finished-good lot.
    """
    uses = (
        db.query(StockMovement.lot_id, func.sum(-StockMovement.quantity_change))
        .filter(
            StockMovement.reference_type == "work_order",
            StockMovement.reference == wo.wo_number,
            StockMovement.quantity_change < 0,
            StockMovement.lot_id.isnot(None),
        )
        .group_by(StockMovement.lot_id)
        .all()
    )
    for lot_id, quantity in uses:
        db.add(LotLink(
            parent_lot_id=lot_id,
            child_lot_id=fg_lot_id,
            work_order_id=wo.id,
            quantity=int(quantity),
        ))
    db.flush()


def _register_output_serials(db: Session, wo: WorkOrder, data: WorkOrderComplete, received_qty: int, lot: Lot | None = None) -> list[SerialNumber]:
    """Validate and register the serial numbers produced by a completed WO for a
    serialized product. Returns the created SerialNumber rows (one per unit)."""
    serials = [s.strip() for s in data.serial_numbers if s.strip()]
    if not serials:
        raise inventory.InventoryError(
            f"'{wo.product.display_name}' is serialized - provide one serial number per finished unit"
        )
    if received_qty is not None and len(serials) != received_qty:
        raise inventory.InventoryError(
            f"Serial count ({len(serials)}) must match received quantity ({received_qty})"
        )
    seen: set[str] = set()
    for sn in serials:
        if sn in seen:
            raise inventory.InventoryError(f"Duplicate serial number '{sn}' on this work order")
        seen.add(sn)
        existing = db.query(SerialNumber).filter(
            SerialNumber.product_id == wo.product_id, SerialNumber.serial_number == sn
        ).first()
        if existing:
            raise inventory.InventoryError(f"Serial number '{sn}' is already registered for '{wo.product.display_name}'")
    created: list[SerialNumber] = []
    for sn in serials:
        serial = SerialNumber(product_id=wo.product_id, serial_number=sn, status="in_stock", lot_id=lot.id if lot else None, location_id=data.receive_location_id)
        db.add(serial)
        db.flush()
        created.append(serial)
    return created


@router.get("")
def list_work_orders(
    status: str | None = None,
    product_id: int | None = None,
    search: str = Query(""),
    created_after: str = Query(""),
    created_before: str = Query(""),
    quantity_min: str = Query(""),
    quantity_max: str = Query(""),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=MAX_PAGE_SIZE),
    db: Session = Depends(get_db),
):
    q = db.query(WorkOrder).options(
        joinedload(WorkOrder.items), joinedload(WorkOrder.product), joinedload(WorkOrder.creator)
    )
    if status:
        q = q.filter(WorkOrder.status == status)
    if product_id:
        q = q.filter(WorkOrder.product_id == product_id)
    if search:
        like = f"%{search}%"
        q = q.join(WorkOrder.product, isouter=True).filter(
            WorkOrder.wo_number.ilike(like) | Product.name.ilike(like) | Product.sku.ilike(like)
        )
    q = apply_date_range(q, WorkOrder.created_at, created_after, created_before, "created_at")
    q = apply_numeric_range(q, WorkOrder.quantity, quantity_min, quantity_max, "quantity")
    total = q.count()
    items = q.order_by(WorkOrder.created_at.desc()).offset(skip).limit(limit).all()
    return {"items": [WorkOrderOut.model_validate(w) for w in items], "total": total,
            "page": (skip // limit) + 1, "pages": max(ceil(total / limit), 1)}


@router.get("/kanban")
def work_order_kanban(
    search: str = Query(""),
    db: Session = Depends(get_db),
):
    """Full pipeline view for the work-order kanban board.

    Returns **all** work orders (unbounded by ``MAX_PAGE_SIZE``) so the board can
    render every status column at once, plus per-status counts for the column
    badges. Callers that need strictly capped, pageable rows should use the
    plain list endpoint instead.
    """
    q = db.query(WorkOrder).options(
        joinedload(WorkOrder.items), joinedload(WorkOrder.product), joinedload(WorkOrder.creator)
    )
    if search:
        like = f"%{search}%"
        q = q.join(WorkOrder.product, isouter=True).filter(
            WorkOrder.wo_number.ilike(like) | Product.name.ilike(like) | Product.sku.ilike(like)
        )
    items = q.order_by(WorkOrder.created_at.desc()).limit(MAX_PAGE_SIZE_LOOKUP).all()
    by_status: dict[str, int] = {}
    for w in items:
        by_status[w.status] = by_status.get(w.status, 0) + 1
    return {
        "items": [WorkOrderOut.model_validate(w) for w in items],
        "total": len(items),
        "by_status": by_status,
    }


@router.get("/{wo_id}", response_model=WorkOrderOut)
def get_work_order(wo_id: int, db: Session = Depends(get_db)):
    return _load_wo(db, wo_id)


@router.get("/{wo_id}/pdf")
def work_order_pdf(wo_id: int, db: Session = Depends(get_db)):
    wo = _load_wo(db, wo_id)
    s = db.query(Settings).first()

    store_name = (s.store_name if s else None) or "My Store"
    currency = (s.currency_symbol if s else "$") or "$"
    store_lines = [store_name] + [ln for ln in (
        (s.address if s else None),
        (s.phone if s else None),
        (s.email if s else None),
    ) if ln]

    c, buf = new_canvas(f"Work Order {wo.wo_number}")
    base_dir = Path(__file__).resolve().parent.parent
    meta = [
        ("WO #:", wo.wo_number),
        ("Date:", wo.created_at.strftime("%b %d, %Y")),
        ("Status:", wo.status),
        ("Priority:", wo.priority),
    ]
    body_y = draw_banner_header(c, "WORK ORDER", meta, store_lines, logo_url=(s.logo_url if s else ""), base_dir=base_dir)

    product_lines = [wo.product_name or f"Product #{wo.product_id}"]
    product_lines.append(f"Quantity: {wo.quantity}")
    if wo.username:
        product_lines.append(f"Created by: {wo.username}")
    if wo.bom_name:
        product_lines.append(f"BOM: {wo.bom_name}")
    info_y = draw_info_block(c, MARGIN, body_y, "Product", product_lines)

    headers = ["Component", "Required", "Issued", "Remaining", "Unit Cost", "Amount"]
    aligns = ["l", "r", "r", "r", "r", "r"]
    col_widths = [210.0, 58.0, 58.0, 58.0, 70.0, 80.0]
    rows = []
    for item in wo.items:
        name = item.product_name or f"Product #{item.product_id}"
        cost = float(item.product.cost_price or 0) if item.product else 0.0
        remaining = max(0, item.quantity_required - item.quantity_issued)
        rows.append([
            (name[:42] + "\u2026") if len(name) > 42 else name,
            str(item.quantity_required),
            str(item.quantity_issued),
            str(remaining),
            money(currency, cost),
            money(currency, cost * item.quantity_required),
        ])

    y = draw_item_table(
        c, MARGIN, info_y, headers, aligns, col_widths, rows,
        on_page_break=lambda c: draw_banner_header(c, "WORK ORDER", meta, store_lines, logo_url=(s.logo_url if s else ""), base_dir=base_dir),
    )

    total_cost = sum(float(item.product.cost_price or 0) * item.quantity_required for item in wo.items if item.product)
    y = draw_totals(c, BODY_RIGHT, y, [
        ("Total Required", f"{wo.total_required} unit(s)"),
        ("Total Issued", f"{wo.total_issued} unit(s)"),
    ], "Total Cost", money(currency, total_cost))

    if wo.notes:
        draw_notes(c, MARGIN, y, wo.notes)
        y -= 18

    draw_signoff(c, y, "Manufacturing order")
    draw_page_footer(c, 1, tax_id=(s.tax_id if s else ""))
    return Response(render_pdf(c, buf), media_type="application/pdf", headers={
        "Content-Disposition": f"inline; filename={wo.wo_number}.pdf"
    })


@router.get("/{wo_id}/genealogy")
def work_order_genealogy(wo_id: int, db: Session = Depends(get_db)):
    """Lot genealogy for a work order: consumed component lots -> FG lots."""
    wo = _load_wo(db, wo_id)
    movements = (
        db.query(StockMovement)
        .options(joinedload(StockMovement.lot), joinedload(StockMovement.product))
        .filter(StockMovement.reference_type == "work_order", StockMovement.reference == wo.wo_number)
        .all()
    )
    component_lots: dict[int, dict] = {}
    fg_lots: dict[int, dict] = {}
    for m in movements:
        if m.lot_id is None:
            continue
        if m.quantity_change < 0:
            row = component_lots.setdefault(m.lot_id, _movement_lot_row(m))
            row["quantity"] += -m.quantity_change
        elif m.quantity_change > 0:
            row = fg_lots.setdefault(m.lot_id, _movement_lot_row(m))
            row["quantity"] += m.quantity_change
    links = []
    for link in (
        db.query(LotLink)
        .options(joinedload(LotLink.parent), joinedload(LotLink.child))
        .filter(LotLink.work_order_id == wo.id)
        .all()
    ):
        links.append({
            "parent_lot_id": link.parent_lot_id,
            "parent_lot_number": link.parent.lot_number if link.parent else "",
            "child_lot_id": link.child_lot_id,
            "child_lot_number": link.child.lot_number if link.child else "",
            "quantity": link.quantity,
        })
    return {
        "wo_number": wo.wo_number,
        "status": wo.status,
        "component_lots": sorted(component_lots.values(), key=lambda r: r["product_name"]),
        "fg_lots": sorted(fg_lots.values(), key=lambda r: r["product_name"]),
        "links": links,
    }


def _movement_lot_row(m: StockMovement) -> dict:
    return {
        "lot_id": m.lot_id,
        "lot_number": m.lot.lot_number if m.lot else "",
        "product_id": m.product_id,
        "product_name": m.product_name,
        "quantity": 0,
    }


@router.post("", response_model=WorkOrderOut, status_code=201)
def create_work_order(data: WorkOrderCreate, db: Session = Depends(get_db), user=Depends(require_permission("work_orders.create"))):
    _validate_output(db, data.product_id)
    if data.bom_id is not None and data.items:
        raise HTTPException(status_code=400, detail="Provide either a BOM reference or explicit component lines, not both")
    wo = WorkOrder(
        wo_number=next_document_number(db, "work_order", "WO-"),
        product_id=data.product_id,
        quantity=data.quantity,
        bom_id=data.bom_id,
        priority=data.priority if data.priority in ("low", "normal", "high") else "normal",
        notes=data.notes,
        created_by=user.id,
    )
    db.add(wo)
    db.flush()
    if data.bom_id is not None:
        wo.items = _snapshot_bom(db, data.bom_id, data.product_id, data.quantity)
    else:
        for item in data.items:
            _validate_component(db, item.product_id, data.product_id)
            wo.items.append(WorkOrderItem(product_id=item.product_id, quantity_required=item.quantity_required, quantity_issued=0))
    db.commit()
    wo = _load_wo(db, wo.id)
    log_activity(db, user.id, user.username, "create", "work_order", wo.id, f"Created work order '{wo.wo_number}' for {wo.quantity} x '{wo.product_name}'")
    db.commit()
    broadcast_change("work_order", "created")
    return wo


@router.put("/{wo_id}", response_model=WorkOrderOut)
def update_work_order(wo_id: int, data: WorkOrderUpdate, db: Session = Depends(get_db), user=Depends(require_permission("work_orders.update"))):
    wo = _load_wo(db, wo_id)
    if wo.status != "planned":
        raise HTTPException(status_code=400, detail="Only planned work orders can be edited")
    updates = data.model_dump(exclude_unset=True)
    if "items" in updates:
        seen: set[int] = set()
        for item in updates["items"]:
            if item.product_id in seen:
                raise HTTPException(status_code=400, detail="Each component may only appear once")
            seen.add(item.product_id)
            _validate_component(db, item.product_id, wo.product_id)
    for k, v in updates.items():
        setattr(wo, k, v)
    if "items" in updates:
        wo.items.clear()
        db.flush()
        for item in updates["items"]:
            wo.items.append(WorkOrderItem(product_id=item.product_id, quantity_required=item.quantity_required, quantity_issued=0))
    db.commit()
    wo = _load_wo(db, wo.id)
    log_activity(db, user.id, user.username, "update", "work_order", wo.id, f"Updated work order '{wo.wo_number}'")
    db.commit()
    broadcast_change("work_order", "updated")
    return wo


@router.post("/{wo_id}/release", response_model=WorkOrderOut)
def release_work_order(wo_id: int, db: Session = Depends(get_db), user=Depends(require_permission("work_orders.release"))):
    wo = _load_wo(db, wo_id)
    if wo.status != "planned":
        raise HTTPException(status_code=400, detail="Only planned work orders can be released")
    wip = _wip_location(db)
    wo.wip_location_id = wip.id
    try:
        for item in wo.items:
            remaining = item.quantity_required - item.quantity_issued
            if remaining > 0:
                _issue_component(db, wo, item, remaining, user.id)
    except inventory.InventoryError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    wo.status = "released"
    db.commit()
    wo = _load_wo(db, wo.id)
    log_activity(db, user.id, user.username, "release", "work_order", wo.id, f"Released work order '{wo.wo_number}' (components issued to WIP)")
    db.commit()
    broadcast_change("work_order", "updated")
    broadcast_change("stock_movement", "created")
    broadcast_change("product", "updated")
    return wo


@router.post("/{wo_id}/start", response_model=WorkOrderOut)
def start_work_order(wo_id: int, db: Session = Depends(get_db), user=Depends(require_permission("work_orders.release"))):
    wo = _load_wo(db, wo_id)
    if wo.status != "released":
        raise HTTPException(status_code=400, detail="Only released work orders can be started")
    wo.status = "in_progress"
    wo.started_at = datetime.now(timezone.utc)
    db.commit()
    wo = _load_wo(db, wo.id)
    log_activity(db, user.id, user.username, "start", "work_order", wo.id, f"Started work order '{wo.wo_number}'")
    db.commit()
    broadcast_change("work_order", "updated")
    return wo


@router.post("/{wo_id}/complete", response_model=WorkOrderOut)
def complete_work_order(wo_id: int, data: WorkOrderComplete, db: Session = Depends(get_db), user=Depends(require_permission("work_orders.complete"))):
    wo = _load_wo(db, wo_id)
    if wo.status not in ("released", "in_progress"):
        raise HTTPException(status_code=400, detail="Work order must be released or in progress to complete")
    get_or_404(Location, data.receive_location_id, db)
    received_qty = data.received_qty if data.received_qty is not None else wo.quantity
    if received_qty > wo.quantity:
        raise HTTPException(status_code=400, detail="Received quantity cannot exceed the work order quantity")
    try:
        lot = None
        if data.lot_number and data.lot_number.strip():
            lot = Lot(product_id=wo.product_id, lot_number=data.lot_number.strip(), status="in_stock")
            db.add(lot)
            db.flush()
        if wo.product.is_serialized:
            serials = _register_output_serials(db, wo, data, received_qty, lot)
            for serial in serials:
                inventory.post_journal_entry(
                    db,
                    product_id=wo.product_id,
                    user_id=user.id,
                    quantity_change=1,
                    movement_type=inventory.RECEIVE,
                    to_location_id=data.receive_location_id,
                    lot_id=lot.id if lot else None,
                    serial_id=serial.id,
                    reference_type="work_order",
                    reference=wo.wo_number,
                    notes=f"Received from {wo.wo_number}" + (" (backflushed)" if data.backflush else ""),
                )
            if lot:
                _create_lot_links(db, wo, lot.id)
        else:
            lot_id = lot.id if lot else None
            if lot:
                _create_lot_links(db, wo, lot.id)
            inventory.post_journal_entry(
                db,
                product_id=wo.product_id,
                user_id=user.id,
                quantity_change=received_qty,
                movement_type=inventory.RECEIVE,
                to_location_id=data.receive_location_id,
                lot_id=lot_id,
                reference_type="work_order",
                reference=wo.wo_number,
                notes=f"Received from {wo.wo_number}" + (" (backflushed)" if data.backflush else ""),
            )
        _consume_issued_serials(db, wo)
    except inventory.InventoryError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    wo.status = "completed"
    wo.completed_at = datetime.now(timezone.utc)
    db.commit()
    wo = _load_wo(db, wo.id)
    log_activity(db, user.id, user.username, "complete", "work_order", wo.id,
                 f"Completed work order '{wo.wo_number}' (received {received_qty} x '{wo.product_name}')")
    db.commit()
    broadcast_change("work_order", "updated")
    broadcast_change("stock_movement", "created")
    broadcast_change("product", "updated")
    return wo


@router.post("/{wo_id}/cancel", response_model=WorkOrderOut)
def cancel_work_order(wo_id: int, db: Session = Depends(get_db), user=Depends(require_permission("work_orders.update"))):
    wo = _load_wo(db, wo_id)
    if wo.status not in ("planned", "released", "in_progress"):
        raise HTTPException(status_code=400, detail="Only planned, released, or in-progress work orders can be cancelled")
    try:
        if wo.status != "planned":
            _revert_component_issues(db, wo, user.id)
    except inventory.InventoryError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    wo.status = "cancelled"
    db.commit()
    wo = _load_wo(db, wo.id)
    log_activity(db, user.id, user.username, "cancel", "work_order", wo.id, f"Cancelled work order '{wo.wo_number}'")
    db.commit()
    broadcast_change("work_order", "updated")
    broadcast_change("stock_movement", "created")
    broadcast_change("product", "updated")
    return wo
