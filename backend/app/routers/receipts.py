from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session, joinedload

from app.constants import MAX_PAGE_SIZE
from app.database import get_db
from app.models.location import Location
from app.models.lot import Lot
from app.models.lpn import LPN
from app.models.product import Product
from app.models.receipt import Receipt, ReceiptItem
from app.models.serial_number import SerialNumber
from app.models.settings import Settings
from app.models.supplier import Supplier
from app.schemas.receipt import ReceiptCreate, ReceiptOut
from app.services import inventory
from app.services.auth import get_current_user, require_permission
from app.services.notify import notify_low_stock
from app.services.sequences import next_document_number
from app.services.pdf_helpers import (
    BODY_RIGHT, MARGIN, draw_header, draw_info_block, draw_item_table,
    draw_notes, draw_signoff, draw_totals, new_canvas, render_pdf,
)
from app.utils import get_or_404, log_activity, broadcast_change, require_active_location

router = APIRouter(prefix="/api/receipts", tags=["receipts"], dependencies=[Depends(get_current_user)])


def _load_receipt(db: Session, receipt_id: int) -> Receipt:
    return get_or_404(Receipt, receipt_id, db, options=[
        joinedload(Receipt.items).joinedload(ReceiptItem.product),
        joinedload(Receipt.supplier), joinedload(Receipt.user),
    ])


@router.get("")
def list_receipts(
    search: str = Query(""),
    supplier_id: int | None = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=MAX_PAGE_SIZE),
    db: Session = Depends(get_db),
):
    q = db.query(Receipt).options(
        joinedload(Receipt.items), joinedload(Receipt.supplier), joinedload(Receipt.user)
    )
    if search:
        like = f"%{search}%"
        q = q.filter(Receipt.receipt_number.ilike(like) | Receipt.reference.ilike(like))
    if supplier_id:
        q = q.filter(Receipt.supplier_id == supplier_id)
    total = q.count()
    items = q.order_by(Receipt.created_at.desc()).offset(skip).limit(limit).all()
    return {"items": [ReceiptOut.model_validate(r) for r in items], "total": total,
            "page": (skip // limit) + 1, "pages": max(ceil(total / limit), 1)}


@router.get("/{receipt_id}", response_model=ReceiptOut)
def get_receipt(receipt_id: int, db: Session = Depends(get_db)):
    return _load_receipt(db, receipt_id)


@router.get("/{receipt_id}/pdf")
def receipt_pdf(receipt_id: int, db: Session = Depends(get_db)):
    r = _load_receipt(db, receipt_id)
    s = db.query(Settings).first()

    store_name = (s.store_name if s else None) or "My Store"
    currency = (s.currency_symbol if s else "$") or "$"
    store_lines = [store_name] + [ln for ln in (
        (s.address if s else None),
        (s.phone if s else None),
        (s.email if s else None),
    ) if ln]

    c, buf = new_canvas(f"Goods Receipt {r.receipt_number}")
    meta = [
        ("Receipt #:", r.receipt_number),
        ("Date:", r.created_at.strftime("%b %d, %Y")),
        ("Received by:", r.username or "\u2014"),
    ]
    body_y = draw_header(c, "GOODS RECEIPT", meta, store_lines)

    supplier_lines = [r.supplier_name or "\u2014"]
    if r.supplier:
        if r.supplier.contact_person:
            supplier_lines.append(f"Contact: {r.supplier.contact_person}")
        if r.supplier.phone:
            supplier_lines.append(f"Phone: {r.supplier.phone}")
        if r.supplier.address:
            supplier_lines.append(f"Address: {r.supplier.address}")
    info_y = draw_info_block(c, MARGIN, body_y, "Supplier", supplier_lines)
    if r.reference:
        draw_info_block(c, BODY_RIGHT - 240, body_y, "Reference", [r.reference])

    headers = ["Item", "Lot", "Location", "Qty", "Unit Cost", "Amount"]
    aligns = ["l", "l", "l", "r", "r", "r"]
    col_widths = [150.0, 90.0, 84.0, 40.0, 70.0, 70.0]
    rows = []
    for item in r.items:
        name = item.product_name or f"Product #{item.product_id}"
        rows.append([
            (name[:34] + "\u2026") if len(name) > 34 else name,
            item.lot_number or "\u2014",
            item.location_name or "\u2014",
            str(item.quantity),
            f"{currency}{float(item.unit_cost):.2f}",
            f"{currency}{float(item.unit_cost) * item.quantity:.2f}",
        ])

    y = draw_item_table(
        c, MARGIN, info_y, headers, aligns, col_widths, rows,
        on_page_break=lambda c: draw_header(c, "GOODS RECEIPT", meta, store_lines),
    )

    y = draw_totals(c, BODY_RIGHT, y, [], "Total Cost", f"{currency}{float(r.total_cost):.2f}")

    if r.notes:
        draw_notes(c, MARGIN, y, r.notes)
        y -= 18

    draw_signoff(c, y, "Received into stock")
    return Response(render_pdf(c, buf), media_type="application/pdf", headers={
        "Content-Disposition": f"inline; filename={r.receipt_number}.pdf"
    })


@router.post("", response_model=ReceiptOut, status_code=201)
def create_receipt(data: ReceiptCreate, db: Session = Depends(get_db), user=Depends(require_permission("receipts.create"))):
    if data.supplier_id is not None:
        get_or_404(Supplier, data.supplier_id, db)

    receipt = Receipt(
        receipt_number=next_document_number(db, "receipt", "RCP-"),
        supplier_id=data.supplier_id,
        user_id=user.id,
        reference=data.reference,
        notes=data.notes,
    )
    db.add(receipt)
    db.flush()

    total_quantity = 0
    total_cost = 0.0
    try:
        for item in data.items:
            product = get_or_404(Product, item.product_id, db)
            if not product.is_active:
                raise HTTPException(status_code=400, detail=f"'{product.display_name}' is inactive")
            if not product.is_variant and db.query(Product).filter(Product.parent_id == product.id, Product.is_active == True).first():
                raise HTTPException(status_code=400, detail=f"'{product.display_name}' has variants - receive stock on a specific variant")
            if item.location_id is not None:
                item_loc = get_or_404(Location, item.location_id, db)
                if not item_loc.is_active:
                    raise HTTPException(status_code=400, detail=f"Location '{item_loc.path}' is inactive")
            require_active_location(db, product)
            if item.lpn_id is not None:
                get_or_404(LPN, item.lpn_id, db)

            lot = None
            if item.lot_number:
                lot = db.query(Lot).filter(
                    Lot.product_id == product.id, Lot.lot_number == item.lot_number
                ).first()
                if lot is None:
                    lot = Lot(
                        product_id=product.id,
                        lot_number=item.lot_number,
                        expiry_date=item.expiry_date,
                        supplier_id=data.supplier_id,
                    )
                    db.add(lot)
                    db.flush()
                elif item.expiry_date is not None and lot.expiry_date is None:
                    lot.expiry_date = item.expiry_date

            if product.is_serialized:
                if not item.serial_numbers:
                    raise HTTPException(status_code=400, detail=f"'{product.display_name}' is serialized - serial numbers are required")
                seen: set[str] = set()
                for sn in item.serial_numbers:
                    if sn in seen:
                        raise HTTPException(status_code=400, detail=f"Duplicate serial number '{sn}' in this receipt")
                    seen.add(sn)
                    existing = db.query(SerialNumber).filter(
                        SerialNumber.product_id == product.id, SerialNumber.serial_number == sn
                    ).first()
                    if existing:
                        raise HTTPException(status_code=400, detail=f"Serial number '{sn}' is already registered for '{product.display_name}'")
                for sn in item.serial_numbers:
                    serial = SerialNumber(
                        product_id=product.id,
                        serial_number=sn,
                        lot_id=lot.id if lot else None,
                        location_id=item.location_id or product.location_id,
                        lpn_id=item.lpn_id,
                    )
                    db.add(serial)
                    db.flush()
                    inventory.post_journal_entry(
                        db, product_id=product.id, user_id=user.id,
                        quantity_change=1, movement_type=inventory.RECEIVE,
                        to_location_id=item.location_id or product.location_id,
                        lot_id=lot.id if lot else None,
                        serial_id=serial.id,
                        lpn_id=item.lpn_id,
                        reference_type="receipt", reference=receipt.receipt_number,
                        notes=data.notes,
                    )
                quantity = item.quantity
            else:
                if item.serial_numbers:
                    raise HTTPException(status_code=400, detail=f"'{product.display_name}' is not serialized - remove serial numbers")
                inventory.post_journal_entry(
                    db, product_id=product.id, user_id=user.id,
                    quantity_change=item.quantity, movement_type=inventory.RECEIVE,
                    to_location_id=item.location_id or product.location_id,
                    lot_id=lot.id if lot else None,
                    lpn_id=item.lpn_id,
                    reference_type="receipt", reference=receipt.receipt_number,
                    notes=data.notes,
                )
                quantity = item.quantity

            db.add(ReceiptItem(
                receipt_id=receipt.id,
                product_id=product.id,
                quantity=quantity,
                unit_cost=item.unit_cost,
                lot_id=lot.id if lot else None,
                location_id=item.location_id or product.location_id,
            ))
            total_quantity += quantity
            total_cost += quantity * item.unit_cost
    except inventory.InventoryError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

    receipt.total_quantity = total_quantity
    receipt.total_cost = total_cost
    db.commit()
    receipt = _load_receipt(db, receipt.id)
    log_activity(db, user.id, user.username, "create", "receipt", receipt.id,
                 f"Receipt '{receipt.receipt_number}' for {receipt.total_quantity} unit(s)")
    for item in receipt.items:
        if item.product:
            notify_low_stock(db, item.product)
    db.commit()
    broadcast_change("receipt", "created")
    broadcast_change("stock_movement", "created")
    return receipt
