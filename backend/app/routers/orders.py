from datetime import date, datetime, timezone
from math import ceil
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session, joinedload
from app.constants import MAX_PAGE_SIZE
from app.database import get_db
from app.models.location import Location
from app.models.lot import Lot
from app.models.lpn import LPN
from app.models.order import Order, OrderItem
from app.models.product import Product
from app.models.serial_number import SerialNumber
from app.models.settings import Settings
from app.models.stock_movement import StockMovement
from app.models.supplier import Supplier
from app.schemas.order import OrderBulkEdit, OrderCreate, OrderOut, OrderUpdate, ReorderLowStockRequest
from app.services import forecasting, inventory
from app.services.auth import require_permission
from app.services.notify import notify_admins
from app.services.sequences import next_document_number
from app.services.pdf_helpers import (
    BODY_RIGHT, MARGIN, money, draw_banner_header, draw_info_block, draw_item_table,
    draw_notes, draw_page_footer, draw_signoff, draw_totals, new_canvas, render_pdf,
)
from app.services.filters import apply_date_range, apply_numeric_range
from app.utils import get_or_404, log_activity, broadcast_change, require_active_location

router = APIRouter(prefix="/api/orders", tags=["orders"], dependencies=[Depends(require_permission("orders.view"))])


def _parse_expiry_date(value: str | None) -> date | None:
    """Parse an optional YYYY-MM-DD expiry date sent with a receive request."""
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid expiry date '{value}' - use YYYY-MM-DD")


ORDER_STATUSES = ("pending", "received", "cancelled")
ORDER_TRANSITIONS = {
    "pending": ("received", "cancelled"),
    "received": (),
    "cancelled": (),
}

ALLOWED_ORDER_BULK_FIELDS = {"status", "notes"}


@router.post("/auto-reorder", response_model=list[OrderOut])
def auto_reorder(
    service_level: float = Query(0.95, gt=0.5, lt=1.0),
    days: int = Query(90, ge=7, le=365),
    lead_time_days: int | None = Query(None, ge=1),
    db: Session = Depends(get_db),
    user=Depends(require_permission("orders.create")),
):
    rows = forecasting.replenishment_rows(
        db,
        service_level=service_level,
        days=days,
        lead_time_override=lead_time_days,
    )
    to_reorder = [
        r for r in rows
        if r["suggested_order_qty"] > 0 and _has_active_location(db, r["product_id"])
    ]
    if not to_reorder:
        raise HTTPException(status_code=400, detail="No products need reordering based on forecast demand")
    # Group products by their default supplier so each purchase order is
    # placed with the right supplier (a PO belongs to a single supplier).
    groups: dict[int | None, list[dict]] = {}
    for r in to_reorder:
        groups.setdefault(r["supplier_id"], []).append(r)
    orders = _create_reorder_orders(
        db, user, groups,
        "Auto-generated reorder for {count} product(s) based on forecast demand",
    )
    broadcast_change("order", "created")
    return orders


@router.post("/reorder-low-stock", response_model=list[OrderOut])
def reorder_low_stock(
    payload: ReorderLowStockRequest,
    db: Session = Depends(get_db),
    user=Depends(require_permission("orders.create")),
):
    """Create purchase order(s) to top low-stock products back up to their reorder level."""
    sellable = inventory.sellable_qty_by_product(db)
    q = db.query(Product).filter(
        Product.is_active == True,  # noqa: E712
        Product.id.notin_(Product.variant_parent_id_subquery()),
    )
    if payload.product_ids:
        q = q.filter(Product.id.in_(payload.product_ids))
    to_reorder: list[dict] = []
    for p in q.all():
        if p.reorder_level <= 0:
            continue
        on_hand = sellable.get(p.id, 0)
        if on_hand > p.reorder_level:
            continue
        if not _has_active_location(db, p.id):
            continue
        to_reorder.append({
            "product_id": p.id,
            "supplier_id": p.supplier_id,
            "suggested_order_qty": max(p.reorder_level - on_hand, 1),
        })
    if not to_reorder:
        raise HTTPException(status_code=400, detail="No low-stock products need reordering")
    groups: dict[int | None, list[dict]] = {}
    for r in to_reorder:
        groups.setdefault(r["supplier_id"], []).append(r)
    orders = _create_reorder_orders(
        db, user, groups,
        "Auto-generated reorder for {count} low-stock product(s)",
    )
    broadcast_change("order", "created")
    return orders


def _create_reorder_orders(db: Session, user, groups: dict[int | None, list[dict]], notes_template: str) -> list[Order]:
    orders: list[Order] = []
    s = db.query(Settings).first()
    currency = (s.currency_symbol if s else "$") or "$"
    for supplier_id, group in groups.items():
        items = []
        total = 0.0
        for r in group:
            p = db.get(Product, r["product_id"])
            qty = r["suggested_order_qty"]
            price = float(p.cost_price) if p.cost_price else 0.0
            items.append({"product_id": p.id, "quantity": qty, "unit_price": price})
            total += qty * price
        supplier = db.get(Supplier, supplier_id) if supplier_id is not None else None
        order = Order(
            order_number=generate_po_number(db), user_id=user.id,
            supplier_id=supplier_id,
            notes=notes_template.format(count=len(group)),
        )
        db.add(order)
        db.flush()
        for item in items:
            db.execute(OrderItem.__table__.insert().values(order_id=order.id, **item))
        order.total_amount = total
        db.commit()
        o = get_or_404(Order, order.id, db, options=[
            joinedload(Order.items), joinedload(Order.supplier), joinedload(Order.user)
        ])
        supplier_tag = f" for {supplier.name}" if supplier else ""
        log_activity(db, user.id, user.username, "create", "order", order.id,
                     f"Auto-reorder '{o.order_number}'{supplier_tag} for {len(group)} product(s) ({currency}{total:,.2f})")
        db.commit()
        orders.append(o)
    return orders


def _has_active_location(db: Session, product_id: int) -> bool:
    try:
        require_active_location(db, db.get(Product, product_id))
        return True
    except HTTPException:
        return False


@router.get("")
def list_orders(
    search: str = Query(""),
    status: str | None = None,
    supplier_id: int | None = None,
    created_after: str = Query(""),
    created_before: str = Query(""),
    expected_after: str = Query(""),
    expected_before: str = Query(""),
    received_after: str = Query(""),
    received_before: str = Query(""),
    total_min: str = Query(""),
    total_max: str = Query(""),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=MAX_PAGE_SIZE),
    db: Session = Depends(get_db),
):
    q = db.query(Order).options(
        joinedload(Order.items).joinedload(OrderItem.product).joinedload(Product.images), joinedload(Order.supplier), joinedload(Order.user)
    )
    if search:
        q = q.filter(Order.order_number.ilike(f"%{search}%"))
    if status:
        if status not in ORDER_STATUSES:
            raise HTTPException(status_code=400, detail=f"Invalid order status '{status}'")
        q = q.filter(Order.status == status)
    if supplier_id:
        q = q.filter(Order.supplier_id == supplier_id)
    q = apply_date_range(q, Order.created_at, created_after, created_before, "created_at")
    q = apply_date_range(q, Order.expected_arrival, expected_after, expected_before, "expected_arrival")
    q = apply_date_range(q, Order.received_at, received_after, received_before, "received_at")
    q = apply_numeric_range(q, Order.total_amount, total_min, total_max, "total_amount")
    total = q.count()
    items = q.order_by(Order.created_at.desc()).offset(skip).limit(limit).all()
    return {"items": [OrderOut.model_validate(o) for o in items], "total": total, "page": (skip // limit) + 1, "pages": max(ceil(total / limit), 1)}


@router.patch("/bulk-edit")
def bulk_edit_orders(data: OrderBulkEdit, db: Session = Depends(get_db), user=Depends(require_permission("orders.bulk"))):
    orders = db.query(Order).filter(Order.id.in_(data.ids)).all()
    if not orders:
        raise HTTPException(status_code=404, detail="No orders found")
    updates = data.model_dump(exclude_unset=True)
    updates.pop("ids", None)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    status = updates.get("status")
    if status is not None:
        if status not in ORDER_STATUSES:
            raise HTTPException(status_code=400, detail=f"Invalid order status '{status}'")
        if status == "received":
            raise HTTPException(status_code=400, detail="Cannot bulk-change orders to 'received'; receive each order individually to handle serial numbers")
    if status is not None:
        for o in orders:
            if status != o.status and status not in ORDER_TRANSITIONS.get(o.status, ()):
                raise HTTPException(status_code=400, detail=f"Cannot change order status from '{o.status}' to '{status}'")
    for o in orders:
        for k, v in updates.items():
            if k in ALLOWED_ORDER_BULK_FIELDS:
                setattr(o, k, v)
    db.commit()
    log_activity(db, user.id, user.username, "update", "order", None,
                 f"Bulk-edited {len(orders)} order(s): {', '.join(f'{k}={v}' for k, v in updates.items())}")
    db.commit()
    broadcast_change("order", "updated")
    return {"updated": len(orders), "fields": [k for k in updates if k in ALLOWED_ORDER_BULK_FIELDS]}


@router.get("/{order_id}", response_model=OrderOut)
def get_order(order_id: int, db: Session = Depends(get_db)):
    return get_or_404(Order, order_id, db, options=[
        joinedload(Order.items).joinedload(OrderItem.product).joinedload(Product.images), joinedload(Order.supplier), joinedload(Order.user)
    ])


@router.get("/{order_id}/pdf")
def order_pdf(order_id: int, db: Session = Depends(get_db)):
    o = get_or_404(Order, order_id, db, options=[
        joinedload(Order.items).joinedload(OrderItem.product).joinedload(Product.images),
        joinedload(Order.supplier), joinedload(Order.user),
    ])
    s = db.query(Settings).first()
    base_dir = Path(__file__).resolve().parent.parent

    store_name = (s.store_name if s else None) or "My Store"
    currency = (s.currency_symbol if s else "$") or "$"
    store_lines = [store_name] + [ln for ln in (
        (s.address if s else None),
        (s.phone if s else None),
        (s.email if s else None),
    ) if ln]

    c, buf = new_canvas(f"Purchase Order {o.order_number}")
    meta = [
        ("Order #:", o.order_number),
        ("Date:", o.created_at.strftime("%b %d, %Y")),
        ("Status:", o.status),
        ("Created by:", o.username or "\u2014"),
    ]
    body_y = draw_banner_header(c, "PURCHASE ORDER", meta, store_lines, logo_url=(s.logo_url if s else ""), base_dir=base_dir)

    supplier_lines = [o.supplier_name or "\u2014"]
    if o.supplier:
        if o.supplier.contact_person:
            supplier_lines.append(f"Contact: {o.supplier.contact_person}")
        if o.supplier.phone:
            supplier_lines.append(f"Phone: {o.supplier.phone}")
        if o.supplier.address:
            supplier_lines.append(f"Address: {o.supplier.address}")
    info_y = draw_info_block(c, MARGIN, body_y, "Supplier", supplier_lines)

    headers = ["Item", "SKU", "Price", "Qty", "Amount"]
    aligns = ["l", "l", "r", "r", "r"]
    col_widths = [210.0, 82.0, 70.0, 44.0, 90.0]
    rows = []
    for item in o.items:
        name = item.product_name or f"Product #{item.product_id}"
        sku = item.product.sku if item.product else ""
        rows.append([
            (name[:42] + "\u2026") if len(name) > 42 else name,
            sku,
            money(currency, item.unit_price),
            str(item.quantity),
            money(currency, float(item.unit_price) * item.quantity),
        ])

    y = draw_item_table(
        c, MARGIN, info_y, headers, aligns, col_widths, rows,
        on_page_break=lambda c: draw_banner_header(c, "PURCHASE ORDER", meta, store_lines, logo_url=(s.logo_url if s else ""), base_dir=base_dir),
    )

    y = draw_totals(c, BODY_RIGHT, y, [], "Total", money(currency, o.total_amount))

    if o.notes:
        draw_notes(c, MARGIN, y, o.notes)
        y -= 18

    draw_signoff(c, y, "Thank you for your order!")
    draw_page_footer(c, 1, tax_id=(s.tax_id if s else ""))
    return Response(render_pdf(c, buf), media_type="application/pdf", headers={
        "Content-Disposition": f"inline; filename={o.order_number}.pdf"
    })


def generate_po_number(db: Session) -> str:
    return next_document_number(db, "purchase_order", "PO-")


def _validate_order_items(db: Session, items) -> float:
    seen: set[int] = set()
    total = 0.0
    product_ids = list({item_data.product_id for item_data in items})
    products = {p.id: p for p in db.query(Product).filter(Product.id.in_(product_ids)).all()}
    parents_with_variants = {
        pid for (pid,) in db.query(Product.parent_id)
        .filter(Product.parent_id.in_(product_ids), Product.is_active == True, Product.parent_id.isnot(None))
        .distinct().all()
    }
    for item_data in items:
        product = products.get(item_data.product_id)
        if not product:
            raise HTTPException(status_code=404, detail=f"Product {item_data.product_id} not found")
        if not product.is_variant and product.id in parents_with_variants:
            raise HTTPException(status_code=400, detail=f"'{product.display_name}' has variants - order a specific variant")
        if item_data.product_id in seen:
            raise HTTPException(status_code=400, detail=f"'{product.display_name}' appears more than once in this order - merge the duplicate lines")
        seen.add(item_data.product_id)
        require_active_location(db, product)
        total += item_data.quantity * item_data.unit_price
    return total


@router.post("", response_model=OrderOut, status_code=201)
def create_order(data: OrderCreate, db: Session = Depends(get_db), user=Depends(require_permission("orders.create"))):
    if data.supplier_id is not None and db.get(Supplier, data.supplier_id) is None:
        raise HTTPException(status_code=400, detail=f"Supplier {data.supplier_id} not found")
    total = _validate_order_items(db, data.items)
    s = db.query(Settings).first()
    currency = (s.currency_symbol if s else "$") or "$"
    order = Order(order_number=generate_po_number(db), user_id=user.id, **data.model_dump(exclude={"items"}))
    db.add(order)
    db.flush()
    for item_data in data.items:
        db.execute(OrderItem.__table__.insert().values(order_id=order.id, **item_data.model_dump()))
    order.total_amount = total
    db.commit()
    o = get_or_404(Order, order.id, db, options=[
        joinedload(Order.items), joinedload(Order.supplier), joinedload(Order.user)
    ])
    log_activity(db, user.id, user.username, "create", "order", order.id, f"Created order '{o.order_number}' ({currency}{total:,.2f})")
    db.commit()
    broadcast_change("order", "created")
    return o


@router.put("/{order_id}", response_model=OrderOut)
def update_order(order_id: int, data: OrderUpdate, db: Session = Depends(get_db), user=Depends(require_permission("orders.update"))):
    o = get_or_404(Order, order_id, db, options=[
        joinedload(Order.items), joinedload(Order.supplier), joinedload(Order.user)
    ])
    prev_status = o.status
    updates = data.model_fields_set

    if "supplier_id" in updates:
        new_supplier_id = data.supplier_id
        if new_supplier_id is not None and db.get(Supplier, new_supplier_id) is None:
            raise HTTPException(status_code=400, detail=f"Supplier {new_supplier_id} not found")
        o.supplier_id = new_supplier_id
    if "notes" in updates:
        o.notes = data.notes
    if "expected_arrival" in updates:
        o.expected_arrival = data.expected_arrival
    if "items" in updates:
        if o.status != "pending":
            raise HTTPException(status_code=400, detail="Order items can only be changed while the order is pending")
        total = _validate_order_items(db, data.items)
        db.execute(OrderItem.__table__.delete().where(OrderItem.__table__.c.order_id == order_id))
        for item_data in data.items:
            db.execute(OrderItem.__table__.insert().values(order_id=o.id, **item_data.model_dump()))
        o.total_amount = total
    status = data.status if "status" in updates else None
    if status is not None:
        if status not in ORDER_STATUSES:
            raise HTTPException(status_code=400, detail=f"Invalid order status '{status}'")
        if status != prev_status and status not in ORDER_TRANSITIONS.get(prev_status, ()):
            raise HTTPException(status_code=400, detail=f"Cannot change order status from '{prev_status}' to '{status}'")
        o.status = status

    received_now = status == "received" and prev_status != "received"
    if received_now:
        o.received_at = datetime.now(timezone.utc)
        o = get_or_404(Order, order_id, db, options=[
            joinedload(Order.items).joinedload(OrderItem.product).joinedload(Product.images),
            joinedload(Order.supplier), joinedload(Order.user)
        ])
        serials_by_product = data.serial_numbers or {}
        receive_locations = data.receive_locations or {}
        lot_numbers = data.lot_numbers or {}
        expiry_dates = data.expiry_dates or {}
        lpn_ids = data.lpn_ids or {}
        movements_by_location: dict[int, list[StockMovement]] = {}
        try:
            for item in o.items:
                product = item.product
                if not product:
                    continue
                loc_id = receive_locations.get(product.id)
                if loc_id is not None:
                    loc = db.get(Location, loc_id)
                    if loc is None:
                        raise HTTPException(status_code=400, detail=f"Receive location for '{product.display_name}' does not exist")
                    if not loc.is_active:
                        raise HTTPException(status_code=400, detail=f"Receive location '{loc.path}' for '{product.display_name}' is inactive")
                else:
                    loc_id = require_active_location(db, product)

                # Optional LPN: must exist, be active, and (if it already has a
                # home) sit at the receive location. An unplaced LPN is adopted
                # by the receive location, mirroring the LPN load flow.
                lpn_id = lpn_ids.get(product.id)
                if lpn_id is not None:
                    lpn = get_or_404(LPN, lpn_id, db)
                    if lpn.status != "active":
                        raise HTTPException(status_code=400, detail=f"LPN '{lpn.lpn_number}' is {lpn.status}")
                    if lpn.location_id is not None and lpn.location_id != loc_id:
                        raise HTTPException(
                            status_code=400,
                            detail=f"LPN '{lpn.lpn_number}' is at '{lpn.location_name}' - receive into that location or pick another LPN",
                        )
                    if lpn.location_id is None:
                        lpn.location_id = loc_id
                        db.flush()

                # Optional lot: reuse an existing lot for the product or create
                # one, carrying the supplier and any expiry date provided.
                lot = None
                lot_number = (lot_numbers.get(product.id) or "").strip()
                if lot_number:
                    lot = db.query(Lot).filter(
                        Lot.product_id == product.id, Lot.lot_number == lot_number
                    ).first()
                    if lot is None:
                        lot = Lot(
                            product_id=product.id,
                            lot_number=lot_number,
                            expiry_date=_parse_expiry_date(expiry_dates.get(product.id)),
                            supplier_id=o.supplier_id,
                        )
                        db.add(lot)
                        db.flush()
                    else:
                        expiry = _parse_expiry_date(expiry_dates.get(product.id))
                        if expiry is not None and lot.expiry_date is None:
                            lot.expiry_date = expiry
                lot_id = lot.id if lot else None

                if product.is_serialized:
                    serials = [s.strip() for s in serials_by_product.get(product.id, []) if s and s.strip()]
                    if not serials:
                        raise inventory.InventoryError(
                            f"'{product.display_name}' is serialized - enter {item.quantity} serial number(s) to receive"
                        )
                    if len(serials) != item.quantity:
                        raise inventory.InventoryError(
                            f"'{product.display_name}' requires exactly {item.quantity} serial number(s), got {len(serials)}"
                        )
                    seen: set[str] = set()
                    for sn in serials:
                        if sn in seen:
                            raise inventory.InventoryError(f"Duplicate serial number '{sn}' in this order")
                        seen.add(sn)
                        existing = db.query(SerialNumber).filter(
                            SerialNumber.product_id == product.id, SerialNumber.serial_number == sn
                        ).first()
                        if existing:
                            raise inventory.InventoryError(f"Serial number '{sn}' is already registered for '{product.display_name}'")
                    for sn in serials:
                        serial = SerialNumber(
                            product_id=product.id, serial_number=sn,
                            lot_id=lot_id, location_id=loc_id, lpn_id=lpn_id,
                        )
                        db.add(serial)
                        db.flush()
                        movement = inventory.post_journal_entry(
                            db, product_id=product.id, user_id=user.id,
                            quantity_change=1, movement_type="in",
                            serial_id=serial.id, lot_id=lot_id, lpn_id=lpn_id,
                            to_location_id=loc_id,
                            reference_type="purchase_order",
                            reference=o.order_number,
                        )
                        movements_by_location.setdefault(loc_id, []).append(movement)
                else:
                    if serials_by_product.get(product.id):
                        raise inventory.InventoryError(
                            f"'{product.display_name}' is not serialized - remove its serial numbers"
                        )
                    movement = inventory.post_journal_entry(
                        db, product_id=product.id, user_id=user.id,
                        quantity_change=item.quantity, movement_type="in",
                        lot_id=lot_id, lpn_id=lpn_id,
                        to_location_id=loc_id,
                        reference_type="purchase_order",
                        reference=o.order_number,
                    )
                    movements_by_location.setdefault(loc_id, []).append(movement)
        except inventory.InventoryError as exc:
            db.rollback()
            raise HTTPException(status_code=400, detail=str(exc))

        # Receiving directly into a quarantine-typed area blocks the lot/serials
        # from selling, matching the LPN move/load/unload flows.
        for loc_id, movements in movements_by_location.items():
            inventory.auto_quarantine(db, db.get(Location, loc_id), movements)

    db.commit()
    db.refresh(o)

    if received_now:
        notify_admins(db, f"Order {o.order_number} received",
                      f"{len(o.items)} item(s) added to stock",
                      type="success", link="/orders", exclude_user_id=user.id)
        db.commit()
        db.refresh(o)

    order_number = o.order_number
    if status and status != prev_status:
        log_activity(db, user.id, user.username, "update", "order", order_id,
                     f"Order '{order_number}' status changed to '{status}'")
        db.commit()
    broadcast_change("order", "updated")
    return o


@router.delete("/{order_id}")
def delete_order(order_id: int, db: Session = Depends(get_db), user=Depends(require_permission("orders.delete"))):
    o = get_or_404(Order, order_id, db)
    if o.status == "received":
        raise HTTPException(status_code=400, detail="Received orders cannot be deleted - stock was already added to inventory")
    if o.status == "pending":
        movements = db.query(StockMovement).filter(
            StockMovement.reference_type == "purchase_order",
            StockMovement.reference == o.order_number,
        ).all()
        for m in movements:
            inventory.post_journal_entry(
                db, product_id=m.product_id, user_id=user.id,
                quantity_change=-m.quantity_change, movement_type="adjustment",
                from_location_id=m.to_location_id, to_location_id=m.from_location_id,
                lot_id=m.lot_id, lpn_id=m.lpn_id, serial_id=m.serial_id,
                reference_type="order_cancellation",
                reference=f"Reversal of {o.order_number}",
                notes=f"Stock reversed on order '{o.order_number}' deletion",
            )
    order_number = o.order_number
    db.execute(OrderItem.__table__.delete().where(OrderItem.__table__.c.order_id == order_id))
    db.delete(o)
    db.commit()
    log_activity(db, user.id, user.username, "delete", "order", order_id, f"Deleted order '{order_number}'")
    db.commit()
    broadcast_change("order", "deleted")
