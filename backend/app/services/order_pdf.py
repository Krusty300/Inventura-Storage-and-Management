"""Purchase-order PDF rendering shared by the internal orders API and the
supplier portal so both produce byte-identical documents."""

from pathlib import Path

from fastapi import Response
from sqlalchemy.orm import Session, joinedload

from app.models.order import Order, OrderItem
from app.models.product import Product
from app.models.settings import Settings
from app.services.pdf_helpers import (
    BODY_RIGHT, MARGIN, money, draw_banner_header, draw_info_block, draw_item_table,
    draw_notes, draw_page_footer, draw_signoff, draw_totals, new_canvas, render_pdf,
)


def load_order_for_pdf(db: Session, order_id: int) -> Order:
    from app.utils import get_or_404
    return get_or_404(Order, order_id, db, options=[
        joinedload(Order.items).joinedload(OrderItem.product).joinedload(Product.images),
        joinedload(Order.supplier), joinedload(Order.user), joinedload(Order.approver),
    ])


def render_order_pdf(db: Session, o: Order) -> Response:
    """Render a PO PDF for the given (already loaded) order."""
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