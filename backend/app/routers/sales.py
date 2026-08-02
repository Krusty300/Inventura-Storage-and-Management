from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models.product import Product
from app.models.sale import Sale, SaleItem
from app.models.settings import Settings
from app.schemas.sale import SaleCreate, SaleOut
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


@router.get("")
def list_sales(
    search: str = Query(""),
    customer_id: int | None = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
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
    return {"items": [SaleOut.model_validate(s) for s in items], "total": total, "page": (skip // limit) + 1, "pages": max(ceil(total / limit), 1)}


@router.get("/stats")
def sales_stats(db: Session = Depends(get_db)):
    total_sales = db.query(Sale).filter(Sale.status == "completed").count()
    total_revenue = sum(
        float(s.total_amount) for s in db.query(Sale).filter(Sale.status == "completed").all()
    )
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
    return load_sale(db, sale_id)


@router.post("", response_model=SaleOut, status_code=201)
def create_sale(data: SaleCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    if not data.items:
        raise HTTPException(status_code=400, detail="Sale must contain at least one item")

    qty_needed: dict[int, int] = {}
    for item_data in data.items:
        qty_needed[item_data.product_id] = qty_needed.get(item_data.product_id, 0) + item_data.quantity

    products = {}
    for item_data in data.items:
        product = db.query(Product).filter(Product.id == item_data.product_id).first()
        if not product or not product.is_active:
            raise HTTPException(status_code=404, detail=f"Product {item_data.product_id} not found")
        if not product.is_variant and db.query(Product).filter(Product.parent_id == product.id, Product.is_active == True).first():
            raise HTTPException(status_code=400, detail=f"'{product.display_name}' has variants - select a specific variant")
        if product.is_serialized:
            raise HTTPException(status_code=400, detail=f"'{product.display_name}' is serialized - not supported at checkout")
        try:
            inventory.allocate_lots(db, product_id=product.id, quantity=qty_needed[item_data.product_id])
        except inventory.InventoryError:
            raise HTTPException(status_code=400, detail=f"Insufficient stock for '{product.display_name}'")
        products[item_data.product_id] = product

    subtotal = sum(i.quantity * i.unit_price for i in data.items)
    tax_rate = get_tax_rate(db)
    tax_amount = subtotal * tax_rate / 100

    sale = Sale(
        invoice_number=generate_invoice_number(db),
        customer_id=data.customer_id,
        user_id=user.id,
        subtotal=subtotal,
        tax_amount=tax_amount,
        total_amount=subtotal + tax_amount,
        payment_method=data.payment_method,
        notes=data.notes,
    )
    db.add(sale)
    db.flush()

    for item_data in data.items:
        product = products[item_data.product_id]
        db.add(SaleItem(sale_id=sale.id, product_id=product.id, quantity=item_data.quantity, unit_price=item_data.unit_price))
        allocation = inventory.allocate_lots(db, product_id=product.id, quantity=item_data.quantity)
        for lot_id, take in allocation:
            inventory.post_journal_entry(
                db, product_id=product.id, user_id=user.id,
                quantity_change=-take, movement_type="out",
                lot_id=lot_id,
                reference_type="sale", reference=sale.invoice_number,
                notes=f"Sale to {data.customer_id and 'customer' or 'walk-in customer'}",
            )

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
    return sale


@router.put("/{sale_id}/refund", response_model=SaleOut)
def refund_sale(sale_id: int, db: Session = Depends(get_db), user=Depends(require_permission("sales.refund"))):
    sale = load_sale(db, sale_id)
    if sale.status == "refunded":
        raise HTTPException(status_code=400, detail="Sale is already refunded")
    if sale.status != "completed":
        raise HTTPException(status_code=400, detail="Only completed sales can be refunded")

    for item in sale.items:
        product = item.product
        if product:
            inventory.post_journal_entry(
                db, product_id=product.id, user_id=user.id,
                quantity_change=item.quantity, movement_type="return",
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
    return sale


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
    y = draw_totals(c, BODY_RIGHT, y, [
        ("Subtotal", f"{currency}{float(sale.subtotal):.2f}"),
        (f"Tax ({tax_rate}%)", f"{currency}{float(sale.tax_amount):.2f}"),
    ], "Total", f"{currency}{float(sale.total_amount):.2f}")

    if sale.notes:
        draw_notes(c, MARGIN, y, sale.notes)
        y -= 18

    draw_signoff(c, y, "Thank you for your business!")
    return Response(render_pdf(c, buf), media_type="application/pdf", headers={
        "Content-Disposition": f"inline; filename={sale.invoice_number}.pdf"
    })
