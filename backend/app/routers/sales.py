from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.constants import MAX_PAGE_SIZE
from app.database import get_db
from app.models.customer import Customer
from app.models.location import Location
from app.models.product import Product
from app.models.sale import Sale, SaleItem
from app.models.settings import Settings
from app.models.quality_check import QualityCheck
from app.models.shipment import Shipment
from app.models.serial_number import SerialNumber
from app.models.stock_movement import StockMovement
from app.schemas.sale import SaleBulkEdit, SaleCreate, SaleOut
from app.services import inventory
from app.services.auth import get_current_user, require_permission
from app.services.notify import notify_admins, notify_low_stock
from app.services.sequences import next_document_number
from app.services.pdf_helpers import (
    BODY_RIGHT, MARGIN, draw_header, draw_info_block, draw_item_table,
    draw_notes, draw_signoff, draw_totals, new_canvas, render_pdf,
)
from app.utils import get_or_404, log_activity, broadcast_change

router = APIRouter(prefix="/api/sales", tags=["sales"], dependencies=[Depends(get_current_user)])


def generate_invoice_number(db: Session) -> str:
    return next_document_number(db, "invoice", "INV-")


def get_tax_rate(db: Session) -> float:
    s = db.query(Settings).first()
    return float(s.tax_rate) if s else 0.0


def load_sale(db: Session, sale_id: int) -> Sale:
    return get_or_404(Sale, sale_id, db, options=[
        joinedload(Sale.items).joinedload(SaleItem.product),
        joinedload(Sale.customer), joinedload(Sale.user),
    ])


def _pending_qc_blockers(db: Session, product_id: int, location_id: int | None) -> list[QualityCheck]:
    """Return pending quality checks that block selling ``product_id``.

    A pending check blocks when it is not scoped to a location (product- or
    lot-wide) or when it covers the location the sale item is drawn from.
    """
    pending = db.query(QualityCheck).filter(
        QualityCheck.product_id == product_id,
        QualityCheck.result == "pending",
    ).all()
    blockers = []
    for qc in pending:
        if qc.location_id is None:
            blockers.append(qc)
        elif location_id is None or qc.location_id == location_id:
            blockers.append(qc)
    return blockers


def _movement_location_map(db: Session, invoices: list[str]) -> dict[str, dict[int, list[str]]]:
    """Map invoice number -> {product_id -> sorted location paths} for sale movements.

    Direct checkout sales are fulfilled from the stock locations recorded on the
    sale's "out" movements. Invoices generated from a shipment never post their
    own movements, so their source locations come from the shipment's transfer-out
    (pick) legs, matched through the shipment -> invoice link. This lets the sales
    list, detail, and invoice surface the source location without an extra column.
    """
    result: dict[str, dict[int, list[str]]] = {}
    invoice_by_shipment = dict(
        db.query(Sale.invoice_number, Shipment.shipment_number)
        .join(Shipment, Shipment.sale_id == Sale.id)
        .filter(Sale.invoice_number.in_(invoices))
        .all()
    )
    sale_movements = (
        db.query(StockMovement)
        .filter(
            StockMovement.reference_type == "sale",
            StockMovement.reference.in_(invoices),
            StockMovement.from_location_id.isnot(None),
        )
        .all()
    )
    shipment_movements: list[StockMovement] = []
    if invoice_by_shipment:
        shipment_movements = (
            db.query(StockMovement)
            .filter(
                StockMovement.reference_type == "shipment",
                StockMovement.reference.in_(set(invoice_by_shipment.values())),
                StockMovement.movement_type == inventory.TRANSFER_OUT,
                StockMovement.from_location_id.isnot(None),
            )
            .all()
        )
    shipment_to_invoice = {num: inv for inv, num in invoice_by_shipment.items()}
    movements = sale_movements + shipment_movements
    loc_ids = {m.from_location_id for m in movements}
    paths: dict[int, str] = {}
    if loc_ids:
        paths = {loc.id: loc.path for loc in db.query(Location).filter(Location.id.in_(loc_ids)).all()}
    for m in movements:
        path = paths.get(m.from_location_id)
        if not path:
            continue
        ref = shipment_to_invoice.get(m.reference, m.reference)
        per_product = result.setdefault(ref, {})
        per_product.setdefault(m.product_id, [])
        if path not in per_product[m.product_id]:
            per_product[m.product_id].append(path)
    for per_product in result.values():
        for paths_list in per_product.values():
            paths_list.sort()
    return result


def _apply_sale_locations(db: Session, out: SaleOut) -> SaleOut:
    per_product = _movement_location_map(db, [out.invoice_number]).get(out.invoice_number, {})
    sale_locations: set[str] = set()
    for item in out.items:
        item_locs = per_product.get(item.product_id, [])
        item.locations = item_locs
        item.location = ", ".join(item_locs)
        sale_locations.update(item_locs)
    out.locations = sorted(sale_locations)
    return out


def _apply_sale_locations_batch(db: Session, outs: list[SaleOut]) -> list[SaleOut]:
    if not outs:
        return outs
    loc_map = _movement_location_map(db, [o.invoice_number for o in outs])
    for out in outs:
        per_product = loc_map.get(out.invoice_number, {})
        sale_locations: set[str] = set()
        for item in out.items:
            item_locs = per_product.get(item.product_id, [])
            item.locations = item_locs
            item.location = ", ".join(item_locs)
            sale_locations.update(item_locs)
        out.locations = sorted(sale_locations)
    return outs


@router.get("")
def list_sales(
    search: str = Query(""),
    customer_id: int | None = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=MAX_PAGE_SIZE),
    db: Session = Depends(get_db),
):
    q = db.query(Sale).options(
        joinedload(Sale.items), joinedload(Sale.customer), joinedload(Sale.user)
    )
    if search:
        q = q.filter(Sale.invoice_number.ilike(f"%{search}%"))
    if customer_id:
        q = q.filter(Sale.customer_id == customer_id)
    total = q.count()
    items = q.order_by(Sale.created_at.desc()).offset(skip).limit(limit).all()
    outs = _apply_sale_locations_batch(db, [SaleOut.model_validate(s) for s in items])
    return {"items": outs, "total": total, "page": (skip // limit) + 1, "pages": max(ceil(total / limit), 1)}


@router.patch("/bulk-edit")
def bulk_edit_sales(data: SaleBulkEdit, db: Session = Depends(get_db), user=Depends(require_permission("sales.bulk"))):
    sales = db.query(Sale).filter(Sale.id.in_(data.ids)).all()
    if not sales:
        raise HTTPException(status_code=404, detail="No sales found")
    updates = data.model_dump(exclude_unset=True)
    updates.pop("ids", None)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    for s in sales:
        for k, v in updates.items():
            setattr(s, k, v)
    db.commit()
    log_activity(db, user.id, user.username, "update", "sale", None,
                 f"Bulk-edited {len(sales)} sale(s): {', '.join(f'{k}={v}' for k, v in updates.items())}")
    db.commit()
    broadcast_change("sale", "updated")
    return {"updated": len(sales), "fields": list(updates.keys())}


@router.get("/stats")
def sales_stats(db: Session = Depends(get_db)):
    total_sales = db.query(Sale).filter(Sale.status == "completed").count()
    total_revenue = db.query(func.coalesce(func.sum(Sale.total_amount), 0.0)).filter(
        Sale.status == "completed"
    ).scalar()
    recent = (
        db.query(Sale).options(joinedload(Sale.customer))
        .filter(Sale.status == "completed")
        .order_by(Sale.created_at.desc())
        .limit(10)
        .all()
    )
    return {
        "total_sales": total_sales,
        "total_revenue": total_revenue,
        "recent_sales": [
            {"id": s.id, "invoice_number": s.invoice_number, "customer_name": s.customer_name,
             "total_amount": float(s.total_amount), "created_at": s.created_at.isoformat()}
            for s in recent
        ],
    }


@router.get("/{sale_id}", response_model=SaleOut)
def get_sale(sale_id: int, db: Session = Depends(get_db)):
    return _apply_sale_locations(db, SaleOut.model_validate(load_sale(db, sale_id)))


@router.post("", response_model=SaleOut, status_code=201)
def create_sale(data: SaleCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    if not data.items:
        raise HTTPException(status_code=400, detail="Sale must contain at least one item")
    if data.customer_id is not None:
        customer = db.get(Customer, data.customer_id)
        if customer is None:
            raise HTTPException(status_code=400, detail=f"Customer {data.customer_id} not found")

    subtotal = sum(i.quantity * i.unit_price for i in data.items)
    discount_amount = float(data.discount_amount or 0)
    if discount_amount > subtotal:
        raise HTTPException(status_code=400, detail="Discount cannot exceed the sale subtotal")

    qty_needed: dict[tuple[int, int | None], int] = {}
    for item_data in data.items:
        key = (item_data.product_id, item_data.location_id)
        qty_needed[key] = qty_needed.get(key, 0) + item_data.quantity

    products = {}
    for item_data in data.items:
        product = db.query(Product).filter(Product.id == item_data.product_id).first()
        if not product or not product.is_active:
            raise HTTPException(status_code=404, detail=f"Product {item_data.product_id} not found")
        if not product.is_variant and db.query(Product).filter(Product.parent_id == product.id, Product.is_active == True).first():
            raise HTTPException(status_code=400, detail=f"'{product.display_name}' has variants - select a specific variant")
        if product.is_serialized:
            raise HTTPException(status_code=400, detail=f"'{product.display_name}' is serialized - not supported at checkout")
        if item_data.location_id is not None:
            loc = db.get(Location, item_data.location_id)
            if loc is None:
                raise HTTPException(status_code=400, detail=f"Location {item_data.location_id} not found")
            if not loc.is_active:
                raise HTTPException(status_code=400, detail=f"Location '{loc.path}' is inactive")
        blockers = _pending_qc_blockers(db, product.id, item_data.location_id)
        if blockers:
            qc_nums = ", ".join(qc.qc_number for qc in blockers)
            raise HTTPException(
                status_code=400,
                detail=f"'{product.display_name}' has pending quality check(s) {qc_nums} - "
                "complete or cancel them before selling",
            )
        try:
            inventory.allocate_lots(
                db, product_id=product.id, quantity=qty_needed[(item_data.product_id, item_data.location_id)],
                location_id=item_data.location_id,
            )
        except inventory.InventoryError:
            raise HTTPException(status_code=400, detail=f"Insufficient stock for '{product.display_name}'")
        products[item_data.product_id] = product

    taxable = subtotal - discount_amount
    tax_rate = get_tax_rate(db)
    tax_amount = taxable * tax_rate / 100

    sale = Sale(
        invoice_number=generate_invoice_number(db),
        customer_id=data.customer_id,
        user_id=user.id,
        subtotal=subtotal,
        discount_amount=discount_amount,
        tax_amount=tax_amount,
        total_amount=taxable + tax_amount,
        payment_method=data.payment_method,
        notes=data.notes,
    )
    db.add(sale)
    db.flush()

    try:
        for item_data in data.items:
            product = products[item_data.product_id]
            db.add(SaleItem(sale_id=sale.id, product_id=product.id, quantity=item_data.quantity, unit_price=item_data.unit_price))
            allocation = inventory.allocate_lots(
                db, product_id=product.id, quantity=item_data.quantity,
                location_id=item_data.location_id,
            )
            for lot_id, take, location_id, lpn_id in allocation:
                inventory.post_journal_entry(
                    db, product_id=product.id, user_id=user.id,
                    quantity_change=-take, movement_type="out",
                    lot_id=lot_id,
                    from_location_id=location_id,
                    lpn_id=lpn_id,
                    reference_type="sale", reference=sale.invoice_number,
                    notes=f"Sale to {data.customer_id and 'customer' or 'walk-in customer'}",
                )
    except inventory.InventoryError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Insufficient stock - stock levels changed while processing the sale")

    db.commit()
    sale = load_sale(db, sale.id)
    log_activity(db, user.id, user.username, "create", "sale", sale.id,
                 f"Sale '{sale.invoice_number}' for ${float(sale.total_amount):.2f}")
    notify_admins(db, f"New sale {sale.invoice_number}",
                  f"{sale.customer_name or 'Walk-in'} · ${float(sale.total_amount):.2f}",
                  type="success", link="/sales")
    for item in sale.items:
        if item.product:
            notify_low_stock(db, item.product)
    db.commit()
    broadcast_change("sale", "created")
    broadcast_change("stock_movement", "created")
    return _apply_sale_locations(db, SaleOut.model_validate(sale))


@router.put("/{sale_id}/refund", response_model=SaleOut)
def refund_sale(sale_id: int, db: Session = Depends(get_db), user=Depends(require_permission("sales.refund"))):
    sale = load_sale(db, sale_id)
    if sale.status == "refunded":
        raise HTTPException(status_code=400, detail="Sale is already refunded")
    if sale.status != "completed":
        raise HTTPException(status_code=400, detail="Only completed sales can be refunded")

    shipment = db.query(Shipment).filter(Shipment.sale_id == sale.id).first()
    for item in sale.items:
        product = item.product
        if not product:
            continue
        if product.is_serialized:
            if shipment is None:
                raise HTTPException(status_code=400, detail="Cannot refund serialized items: no linked shipment found")
            serial_ids = [
                m.serial_id for m in db.query(StockMovement).filter(
                    StockMovement.product_id == product.id,
                    StockMovement.serial_id.isnot(None),
                    StockMovement.reference_type == "shipment",
                    StockMovement.reference == shipment.shipment_number,
                    StockMovement.quantity_change < 0,
                ).all()
            ]
            pick_legs = db.query(StockMovement).filter(
                StockMovement.product_id == product.id,
                StockMovement.serial_id.isnot(None),
                StockMovement.reference_type == "shipment",
                StockMovement.reference == shipment.shipment_number,
                StockMovement.movement_type == inventory.TRANSFER_OUT,
            ).all()
            original_location = {m.serial_id: m.from_location_id for m in pick_legs}
            for serial_id in serial_ids:
                inventory.post_journal_entry(
                    db, product_id=product.id, user_id=user.id,
                    quantity_change=1, movement_type=inventory.SALE_RETURN,
                    serial_id=serial_id,
                    to_location_id=original_location.get(serial_id),
                    reference_type="sale_return",
                    reference=f"Refund {sale.invoice_number}",
                    notes="Sale refund",
                )
                serial = db.get(SerialNumber, serial_id)
                if serial is not None:
                    inventory.sync_serialized_lot_status(db, serial.lot_id)
            continue
        originals = db.query(StockMovement).filter(
            StockMovement.reference_type == "sale",
            StockMovement.reference == sale.invoice_number,
            StockMovement.product_id == product.id,
            StockMovement.quantity_change < 0,
        ).order_by(StockMovement.id).all()
        restored = 0
        for m in originals:
            if restored >= item.quantity:
                break
            take = min(-m.quantity_change, item.quantity - restored)
            if take <= 0:
                continue
            inventory.post_journal_entry(
                db, product_id=product.id, user_id=user.id,
                quantity_change=take, movement_type="return",
                from_location_id=m.from_location_id,
                lot_id=m.lot_id, lpn_id=m.lpn_id,
                reference_type="sale_return",
                reference=f"Refund {sale.invoice_number}",
                notes="Sale refund",
            )
            restored += take
        if restored < item.quantity:
            inventory.post_journal_entry(
                db, product_id=product.id, user_id=user.id,
                quantity_change=item.quantity - restored, movement_type="return",
                reference_type="sale_return",
                reference=f"Refund {sale.invoice_number}",
                notes="Sale refund",
            )

    sale.status = "refunded"
    db.commit()
    db.refresh(sale)
    log_activity(db, user.id, user.username, "update", "sale", sale.id,
                 f"Refunded sale '{sale.invoice_number}'")
    notify_admins(db, f"Refund {sale.invoice_number}",
                  f"${float(sale.total_amount):.2f} returned to stock", type="info", link="/sales")
    db.commit()
    broadcast_change("sale", "updated")
    broadcast_change("stock_movement", "created")
    broadcast_change("product", "updated")
    return _apply_sale_locations(db, SaleOut.model_validate(sale))


@router.get("/{sale_id}/pdf")
def sale_pdf(sale_id: int, db: Session = Depends(get_db)):
    sale = load_sale(db, sale_id)
    s = db.query(Settings).first()

    store_name = (s.store_name if s else None) or "My Store"
    currency = (s.currency_symbol if s else "$") or "$"
    store_lines = [store_name] + [ln for ln in (
        (s.address if s else None),
        (s.phone if s else None),
        (s.email if s else None),
    ) if ln]

    c, buf = new_canvas(f"Invoice {sale.invoice_number}")
    meta = [
        ("Invoice #:", sale.invoice_number),
        ("Date:", sale.created_at.strftime("%b %d, %Y")),
        ("Cashier:", sale.username or "\u2014"),
        ("Payment:", sale.payment_method),
    ]
    body_y = draw_header(c, "INVOICE", meta, store_lines)

    bill_lines = [sale.customer_name]
    if sale.customer and sale.customer.phone:
        bill_lines.append(f"Phone: {sale.customer.phone}")
    info_y = draw_info_block(c, MARGIN, body_y, "Bill To", bill_lines)

    headers = ["Item", "Price", "Qty", "Amount"]
    aligns = ["l", "r", "r", "r"]
    col_widths = [292.0, 84.0, 44.0, 84.0]
    rows = []
    for item in sale.items:
        name = item.product_name or f"Product #{item.product_id}"
        rows.append([
            (name[:60] + "\u2026") if len(name) > 60 else name,
            f"{currency}{float(item.unit_price):.2f}",
            str(item.quantity),
            f"{currency}{float(item.unit_price) * item.quantity:.2f}",
        ])

    y = draw_item_table(
        c, MARGIN, info_y, headers, aligns, col_widths, rows,
        on_page_break=lambda c: draw_header(c, "INVOICE", meta, store_lines),
    )

    tax_rate = s.tax_rate if s else 0
    totals = [
        ("Subtotal", f"{currency}{float(sale.subtotal):.2f}"),
    ]
    if sale.discount_amount:
        totals.append(("Discount", f"-{currency}{float(sale.discount_amount):.2f}"))
    totals.append((f"Tax ({tax_rate}%)", f"{currency}{float(sale.tax_amount):.2f}"))
    y = draw_totals(c, BODY_RIGHT, y, totals, "Total", f"{currency}{float(sale.total_amount):.2f}")

    if sale.notes:
        draw_notes(c, MARGIN, y, sale.notes)
        y -= 18

    draw_signoff(c, y, "Thank you for your business!")
    return Response(render_pdf(c, buf), media_type="application/pdf", headers={
        "Content-Disposition": f"inline; filename={sale.invoice_number}.pdf"
    })
