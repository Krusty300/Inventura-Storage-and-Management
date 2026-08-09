from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session, joinedload
from app.database import get_db
from app.models.location import Location
from app.models.order import Order, OrderItem
from app.models.product import Product
from app.models.serial_number import SerialNumber
from app.models.settings import Settings
from app.models.supplier import Supplier
from app.schemas.order import OrderBulkEdit, OrderCreate, OrderOut, OrderUpdate
from app.services import forecasting, inventory
from app.services.auth import get_current_user, require_permission
from app.services.notify import notify_admins
from app.services.sequences import next_document_number
from app.services.pdf_helpers import (
    BODY_RIGHT, MARGIN, draw_header, draw_info_block, draw_item_table,
    draw_notes, draw_signoff, draw_totals, new_canvas, render_pdf,
)
from app.utils import get_or_404, log_activity, broadcast_change, require_active_location

router = APIRouter(prefix="/api/orders", tags=["orders"], dependencies=[Depends(get_current_user)])


ORDER_STATUSES = ("pending", "received", "cancelled")
ORDER_TRANSITIONS = {
    "pending": ("received", "cancelled"),
    "received": (),
    "cancelled": (),
}


@router.post("/auto-reorder", response_model=list[OrderOut])
def auto_reorder(
    service_level: float = Query(0.95, gt=0.5, lt=1.0),
    days: int = Query(90, ge=7, le=365),
    lead_time_days: int | None = Query(None, ge=1),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
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
    orders: list[Order] = []
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
            notes=f"Auto-generated reorder for {len(group)} product(s) based on forecast demand",
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
                     f"Auto-reorder '{o.order_number}'{supplier_tag} for {len(group)} product(s) (${total:.2f})")
        db.commit()
        orders.append(o)
    broadcast_change("order", "created")
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
    supplier_id: int | None = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    db: Session = Depends(get_db),
):
    q = db.query(Order).options(
        joinedload(Order.items), joinedload(Order.supplier), joinedload(Order.user)
    )
    if search:
        q = q.filter(Order.order_number.ilike(f"%{search}%"))
    if supplier_id:
        q = q.filter(Order.supplier_id == supplier_id)
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
            setattr(o, k, v)
    db.commit()
    log_activity(db, user.id, user.username, "update", "order", None,
                 f"Bulk-edited {len(orders)} order(s): {', '.join(f'{k}={v}' for k, v in updates.items())}")
    db.commit()
    broadcast_change("order", "updated")
    return {"updated": len(orders), "fields": list(updates.keys())}


@router.get("/{order_id}", response_model=OrderOut)
def get_order(order_id: int, db: Session = Depends(get_db)):
    return get_or_404(Order, order_id, db, options=[
        joinedload(Order.items), joinedload(Order.supplier), joinedload(Order.user)
    ])


@router.get("/{order_id}/pdf")
def order_pdf(order_id: int, db: Session = Depends(get_db)):
    o = get_or_404(Order, order_id, db, options=[
        joinedload(Order.items).joinedload(OrderItem.product),
        joinedload(Order.supplier), joinedload(Order.user),
    ])
    s = db.query(Settings).first()

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
    body_y = draw_header(c, "PURCHASE ORDER", meta, store_lines)

    supplier_lines = [o.supplier_name or "\u2014"]
    if o.supplier:
        if o.supplier.contact_person:
            supplier_lines.append(f"Contact: {o.supplier.contact_person}")
        if o.supplier.phone:
            supplier_lines.append(f"Phone: {o.supplier.phone}")
        if o.supplier.address:
            supplier_lines.append(f"Address: {o.supplier.address}")
    info_y = draw_info_block(c, MARGIN, body_y, "Supplier", supplier_lines)

    headers = ["Item", "Price", "Qty", "Amount"]
    aligns = ["l", "r", "r", "r"]
    col_widths = [292.0, 84.0, 44.0, 84.0]
    rows = []
    for item in o.items:
        name = item.product_name or f"Product #{item.product_id}"
        rows.append([
            (name[:60] + "\u2026") if len(name) > 60 else name,
            f"{currency}{float(item.unit_price):.2f}",
            str(item.quantity),
            f"{currency}{float(item.unit_price) * item.quantity:.2f}",
        ])

    y = draw_item_table(
        c, MARGIN, info_y, headers, aligns, col_widths, rows,
        on_page_break=lambda c: draw_header(c, "PURCHASE ORDER", meta, store_lines),
    )

    y = draw_totals(c, BODY_RIGHT, y, [], "Total", f"{currency}{float(o.total_amount):.2f}")

    if o.notes:
        draw_notes(c, MARGIN, y, o.notes)
        y -= 18

    draw_signoff(c, y, "Thank you for your order!")
    return Response(render_pdf(c, buf), media_type="application/pdf", headers={
        "Content-Disposition": f"inline; filename={o.order_number}.pdf"
    })


def generate_po_number(db: Session) -> str:
    return next_document_number(db, "purchase_order", "PO-")


def _validate_order_items(db: Session, items) -> float:
    seen: set[int] = set()
    total = 0.0
    for item_data in items:
        product = db.query(Product).filter(Product.id == item_data.product_id).first()
        if not product:
            raise HTTPException(status_code=404, detail=f"Product {item_data.product_id} not found")
        if not product.is_variant and db.query(Product).filter(Product.parent_id == product.id, Product.is_active == True).first():
            raise HTTPException(status_code=400, detail=f"'{product.display_name}' has variants - order a specific variant")
        if item_data.product_id in seen:
            raise HTTPException(status_code=400, detail=f"'{product.display_name}' appears more than once in this order - merge the duplicate lines")
        seen.add(item_data.product_id)
        require_active_location(db, product)
        total += item_data.quantity * item_data.unit_price
    return total


@router.post("", response_model=OrderOut, status_code=201)
def create_order(data: OrderCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    if data.supplier_id is not None and db.get(Supplier, data.supplier_id) is None:
        raise HTTPException(status_code=400, detail=f"Supplier {data.supplier_id} not found")
    total = _validate_order_items(db, data.items)
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
    log_activity(db, user.id, user.username, "create", "order", order.id, f"Created order '{order.order_number}' (${total:.2f})")
    db.commit()
    broadcast_change("order", "created")
    return o


@router.put("/{order_id}", response_model=OrderOut)
def update_order(order_id: int, data: OrderUpdate, db: Session = Depends(get_db), user=Depends(get_current_user)):
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
        o = get_or_404(Order, order_id, db, options=[
            joinedload(Order.items).joinedload(OrderItem.product),
            joinedload(Order.supplier), joinedload(Order.user)
        ])
        serials_by_product = data.serial_numbers or {}
        receive_locations = data.receive_locations or {}
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
                        serial = SerialNumber(product_id=product.id, serial_number=sn, location_id=loc_id)
                        db.add(serial)
                        db.flush()
                        inventory.post_journal_entry(
                            db, product_id=product.id, user_id=user.id,
                            quantity_change=1, movement_type="in",
                            serial_id=serial.id,
                            to_location_id=loc_id,
                            reference_type="purchase_order",
                            reference=f"Order {o.order_number}",
                        )
                else:
                    if serials_by_product.get(product.id):
                        raise inventory.InventoryError(
                            f"'{product.display_name}' is not serialized - remove its serial numbers"
                        )
                    inventory.post_journal_entry(
                        db, product_id=product.id, user_id=user.id,
                        quantity_change=item.quantity, movement_type="in",
                        to_location_id=loc_id,
                        reference_type="purchase_order",
                        reference=f"Order {o.order_number}",
                    )
        except inventory.InventoryError as exc:
            db.rollback()
            raise HTTPException(status_code=400, detail=str(exc))

    db.commit()
    db.refresh(o)

    if received_now:
        notify_admins(db, f"Order {o.order_number} received",
                      f"{len(o.items)} item(s) added to stock",
                      type="success", link="/orders")
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
    order_number = o.order_number
    db.execute(OrderItem.__table__.delete().where(OrderItem.__table__.c.order_id == order_id))
    db.delete(o)
    db.commit()
    log_activity(db, user.id, user.username, "delete", "order", order_id, f"Deleted order '{order_number}'")
    db.commit()
    broadcast_change("order", "deleted")
