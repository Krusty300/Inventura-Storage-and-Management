from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session, joinedload
from app.database import get_db
from app.models.order import Order, OrderItem
from app.models.product import Product
from app.models.serial_number import SerialNumber
from app.models.settings import Settings
from app.schemas.order import OrderCreate, OrderOut, OrderUpdate
from app.services import inventory
from app.services.auth import get_current_user, require_permission
from app.services.notify import notify_admins
from app.services.sequences import next_document_number
from app.services.pdf_helpers import (
    BODY_RIGHT, MARGIN, draw_header, draw_info_block, draw_item_table,
    draw_notes, draw_signoff, draw_totals, new_canvas, render_pdf,
)
from app.utils import get_or_404, log_activity, broadcast_change

router = APIRouter(prefix="/api/orders", tags=["orders"], dependencies=[Depends(get_current_user)])


ORDER_STATUSES = ("pending", "received", "cancelled")
ORDER_TRANSITIONS = {
    "pending": ("received", "cancelled"),
    "received": (),
    "cancelled": (),
}


@router.post("/auto-reorder", response_model=OrderOut)
def auto_reorder(db: Session = Depends(get_db), user=Depends(get_current_user)):
    low_stock = db.query(Product).filter(
        Product.is_active == True, Product.quantity <= Product.reorder_level,
        Product.reorder_level > 0,
        Product.id.notin_(Product.variant_parent_id_subquery()),
    ).all()
    if not low_stock:
        raise HTTPException(status_code=400, detail="No low-stock products found")
    items = []
    total = 0.0
    for p in low_stock:
        qty = max(p.reorder_level * 2 - p.quantity, 1)
        price = float(p.cost_price) if p.cost_price else 0.0
        items.append({"product_id": p.id, "quantity": qty, "unit_price": price})
        total += qty * price
    order = Order(
        order_number=generate_po_number(db), user_id=user.id,
        notes=f"Auto-generated reorder for {len(low_stock)} low-stock product(s)",
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
    log_activity(db, user.id, user.username, "create", "order", order.id,
                 f"Auto-reorder '{o.order_number}' for {len(low_stock)} product(s) (${total:.2f})")
    db.commit()
    broadcast_change("order", "created")
    return o


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


@router.post("", response_model=OrderOut, status_code=201)
def create_order(data: OrderCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    for item_data in data.items:
        product = db.query(Product).filter(Product.id == item_data.product_id).first()
        if not product:
            raise HTTPException(status_code=404, detail=f"Product {item_data.product_id} not found")
        if not product.is_variant and db.query(Product).filter(Product.parent_id == product.id, Product.is_active == True).first():
            raise HTTPException(status_code=400, detail=f"'{product.display_name}' has variants - order a specific variant")
    order = Order(order_number=generate_po_number(db), user_id=user.id, **data.model_dump(exclude={"items"}))
    db.add(order)
    db.flush()
    total = 0.0
    for item_data in data.items:
        total += item_data.quantity * item_data.unit_price
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

    if data.notes is not None:
        o.notes = data.notes
    if data.supplier_id is not None:
        o.supplier_id = data.supplier_id
    if data.items is not None:
        if o.status != "pending":
            raise HTTPException(status_code=400, detail="Order items can only be changed while the order is pending")
        db.execute(OrderItem.__table__.delete().where(OrderItem.__table__.c.order_id == order_id))
        total = 0.0
        for item_data in data.items:
            product = db.query(Product).filter(Product.id == item_data.product_id).first()
            if not product:
                raise HTTPException(status_code=404, detail=f"Product {item_data.product_id} not found")
            if not product.is_variant and db.query(Product).filter(Product.parent_id == product.id, Product.is_active == True).first():
                raise HTTPException(status_code=400, detail=f"'{product.display_name}' has variants - order a specific variant")
            total += item_data.quantity * item_data.unit_price
            db.execute(OrderItem.__table__.insert().values(order_id=o.id, **item_data.model_dump()))
        o.total_amount = total
    if data.status:
        if data.status not in ORDER_STATUSES:
            raise HTTPException(status_code=400, detail=f"Invalid order status '{data.status}'")
        if data.status != prev_status and data.status not in ORDER_TRANSITIONS.get(prev_status, ()):
            raise HTTPException(status_code=400, detail=f"Cannot change order status from '{prev_status}' to '{data.status}'")
        o.status = data.status

    received_now = data.status == "received" and prev_status != "received"
    if received_now:
        o = get_or_404(Order, order_id, db, options=[
            joinedload(Order.items).joinedload(OrderItem.product),
            joinedload(Order.supplier), joinedload(Order.user)
        ])
        serials_by_product = data.serial_numbers or {}
        try:
            for item in o.items:
                product = item.product
                if not product:
                    continue
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
                        serial = SerialNumber(product_id=product.id, serial_number=sn)
                        db.add(serial)
                        db.flush()
                        inventory.post_journal_entry(
                            db, product_id=product.id, user_id=o.user_id,
                            quantity_change=1, movement_type="in",
                            serial_id=serial.id,
                            reference_type="purchase_order",
                            reference=f"Order {o.order_number}",
                        )
                else:
                    if serials_by_product.get(product.id):
                        raise inventory.InventoryError(
                            f"'{product.display_name}' is not serialized - remove its serial numbers"
                        )
                    inventory.post_journal_entry(
                        db, product_id=product.id, user_id=o.user_id,
                        quantity_change=item.quantity, movement_type="in",
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
    if data.status and data.status != prev_status:
        log_activity(db, user.id, user.username, "update", "order", order_id,
                     f"Order '{order_number}' status changed to '{data.status}'")
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
