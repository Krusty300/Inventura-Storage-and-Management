from math import ceil
from datetime import datetime, timedelta, timezone
from pathlib import Path
import io

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.constants import MAX_PAGE_SIZE, currency_symbol as symbol_for
from app.database import get_db
from app.models.customer import Customer
from app.models.location import Location
from app.models.product import Product
from app.models.sale import Sale, SaleItem
from app.models.sales_channel import SalesChannel
from app.models.settings import Settings
from app.models.quality_check import QualityCheck
from app.models.shipment import Shipment
from app.models.serial_number import SerialNumber
from app.models.stock_movement import StockMovement
from app.schemas.sale import RefundRequest, SaleBulkEdit, SaleCreate, SaleOut
from app.services import inventory
from app.services.auth import require_permission
from app.services.notify import notify_admins, notify_low_stock
from app.services.payment_methods import resolve_payment_details, validate_payment
from app.services.pricing import apply_promotion, resolve_price, validate_promotion, PromoError
from app.services.sequences import next_document_number
from app.services.pdf_helpers import (
    ACCENT, BODY_CENTER, BODY_RIGHT, FONT, MARGIN, MUTED, PAGE_H,
    draw_banner_header, draw_info_block, draw_item_table,
    draw_notes, draw_page_footer, draw_signoff, draw_totals,
    draw_watermark, new_canvas, render_pdf,
)
from app.utils import get_or_404, log_activity, broadcast_change

router = APIRouter(prefix="/api/sales", tags=["sales"], dependencies=[Depends(require_permission("sales.view"))])


def generate_invoice_number(db: Session) -> str:
    return next_document_number(db, "invoice", "INV-")


def get_tax_rate(db: Session) -> float:
    s = db.query(Settings).first()
    return float(s.tax_rate) if s else 0.0


def get_currency_defaults(db: Session) -> tuple[str, str]:
    s = db.query(Settings).first()
    if s and s.currency_code:
        return s.currency_code, s.currency_symbol or symbol_for(s.currency_code)
    return "USD", "$"


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


def _restore_stock_for_sale(db: Session, sale: Sale, *, reason: str, invoice_override: str | None = None) -> None:
    """Reverse all stock movements for a sale.  ``reason`` is used in
    ``reference_type`` / ``notes`` fields (e.g. 'Cancellation', 'Refund').
    ``invoice_override`` replaces the invoice number in the reference when
    the original reference needs to differ (e.g. for shipment-sourced sales).
    """
    ref = invoice_override or sale.invoice_number
    shipment = db.query(Shipment).filter(Shipment.sale_id == sale.id).first()
    for item in sale.items:
        product = item.product
        if not product:
            continue
        if product.is_serialized:
            if shipment is None:
                continue
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
                    db, product_id=product.id, user_id=sale.user_id,
                    quantity_change=1, movement_type=inventory.SALE_RETURN,
                    serial_id=serial_id,
                    to_location_id=original_location.get(serial_id),
                    reference_type="sale_return",
                    reference=f"{reason} {ref}",
                    notes=f"Sale {reason.lower()} — stock restored",
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
                db, product_id=product.id, user_id=sale.user_id,
                quantity_change=take, movement_type="return",
                from_location_id=m.from_location_id,
                lot_id=m.lot_id, lpn_id=m.lpn_id,
                reference_type="sale_return",
                reference=f"{reason} {ref}",
                notes=f"Sale {reason.lower()} — stock restored",
            )
            restored += take
        if restored < item.quantity:
            inventory.post_journal_entry(
                db, product_id=product.id, user_id=sale.user_id,
                quantity_change=item.quantity - restored, movement_type="return",
                reference_type="sale_return",
                reference=f"{reason} {ref}",
                notes=f"Sale {reason.lower()} — stock restored",
            )


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
    channel_id: int | None = None,
    payment_method: str | None = Query(None),
    status: str | None = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=MAX_PAGE_SIZE),
    db: Session = Depends(get_db),
):
    q = db.query(Sale).options(
        joinedload(Sale.items), joinedload(Sale.customer), joinedload(Sale.user), joinedload(Sale.channel)
    )
    if search:
        q = q.filter(Sale.invoice_number.ilike(f"%{search}%"))
    if customer_id:
        q = q.filter(Sale.customer_id == customer_id)
    if channel_id:
        q = q.filter(Sale.channel_id == channel_id)
    if payment_method:
        q = q.filter(Sale.payment_method == payment_method)
    if status:
        q = q.filter(Sale.status == status)
    total = q.count()
    items = q.order_by(Sale.created_at.desc()).offset(skip).limit(limit).all()
    outs = _apply_sale_locations_batch(db, [SaleOut.model_validate(s) for s in items])
    return {"items": outs, "total": total, "page": (skip // limit) + 1, "pages": max(ceil(total / limit), 1)}


_VALID_STATUS_TRANSITIONS = {
    "pending": {"completed", "cancelled"},
    "completed": {"refunded"},
}

@router.patch("/bulk-edit")
def bulk_edit_sales(data: SaleBulkEdit, db: Session = Depends(get_db), user=Depends(require_permission("sales.bulk"))):
    sales = db.query(Sale).filter(Sale.id.in_(data.ids)).all()
    if not sales:
        raise HTTPException(status_code=404, detail="No sales found")
    updates = data.model_dump(exclude_unset=True)
    updates.pop("ids", None)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    new_status = updates.get("status")
    for s in sales:
        if new_status and s.status not in _VALID_STATUS_TRANSITIONS:
            raise HTTPException(status_code=400, detail=f"Cannot change status of sale '{s.invoice_number}' from '{s.status}'")
        if new_status and new_status not in _VALID_STATUS_TRANSITIONS.get(s.status, set()):
            raise HTTPException(status_code=400, detail=f"Invalid transition '{s.status}' → '{new_status}' for sale '{s.invoice_number}'")
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
def create_sale(data: SaleCreate, db: Session = Depends(get_db), user=Depends(require_permission("sales.create"))):
    if not data.items:
        raise HTTPException(status_code=400, detail="Sale must contain at least one item")
    if data.customer_id is not None:
        customer = db.get(Customer, data.customer_id)
        if customer is None:
            raise HTTPException(status_code=400, detail=f"Customer {data.customer_id} not found")
    if data.channel_id is not None:
        channel = db.get(SalesChannel, data.channel_id)
        if channel is None:
            raise HTTPException(status_code=400, detail=f"Sales channel {data.channel_id} not found")

    subtotal = 0
    total_qty = 0
    resolved_prices: dict[int, float] = {}
    for item_data in data.items:
        if item_data.unit_price and item_data.unit_price > 0:
            price = item_data.unit_price
        else:
            price = resolve_price(db, item_data.product_id, data.customer_id, item_data.quantity)
        resolved_prices[item_data.product_id] = price
        subtotal += item_data.quantity * price
        total_qty += item_data.quantity
    discount_amount = float(data.discount_amount or 0)
    promo_discount = 0.0
    promo_code = None
    if data.promo_code and data.promo_code.strip():
        try:
            promo, promo_discount = validate_promotion(db, data.promo_code.strip(), subtotal, total_qty)
            promo_code = promo.code
        except PromoError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
    if discount_amount > subtotal:
        raise HTTPException(status_code=400, detail="Discount cannot exceed the sale subtotal")
    if discount_amount + promo_discount > subtotal:
        raise HTTPException(status_code=400, detail="Total discounts cannot exceed the sale subtotal")

    try:
        default_currency, default_symbol = get_currency_defaults(db)
        payment = resolve_payment_details(
            data.payment_method,
            data.payment_provider,
            data.payment_provider_amount,
            data.currency,
            data.currency_symbol,
            default_currency=default_currency,
            default_symbol=default_symbol,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

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
        products[item_data.product_id] = product

    taxable = subtotal - discount_amount - promo_discount
    tax_rate = get_tax_rate(db)
    tax_amount = taxable * tax_rate / 100

    is_mobile = data.payment_method == "mobile_money"
    sale = Sale(
        invoice_number=generate_invoice_number(db),
        customer_id=data.customer_id,
        user_id=user.id,
        channel_id=data.channel_id,
        subtotal=subtotal,
        discount_amount=discount_amount,
        tax_amount=tax_amount,
        total_amount=taxable + tax_amount,
        status="pending" if is_mobile else "completed",
        payment_method=data.payment_method,
        payment_provider=payment["provider"],
        payment_reference=(data.payment_reference or "").strip() or None,
        payment_phone=(data.payment_phone or "").strip() or None,
        payment_provider_amount=payment["payment_provider_amount"],
        currency=payment["currency"],
        currency_symbol=payment["currency_symbol"],
        payment_status="pending" if is_mobile else None,
        promo_code=promo_code,
        promo_discount=promo_discount,
        notes=data.notes,
    )
    db.add(sale)
    db.flush()

    try:
        for item_data in data.items:
            product = products[item_data.product_id]
            db.add(SaleItem(sale_id=sale.id, product_id=product.id, quantity=item_data.quantity, unit_price=resolved_prices[item_data.product_id]))
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
    if promo_code:
        from app.models.promotion import Promotion as PromoModel
        promo_obj = db.query(PromoModel).filter(PromoModel.code == promo_code).first()
        if promo_obj:
            apply_promotion(db, promo_obj)
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
def refund_sale(sale_id: int, data: RefundRequest | None = None, db: Session = Depends(get_db), user=Depends(require_permission("sales.refund"))):
    sale = load_sale(db, sale_id)
    if sale.status == "refunded":
        raise HTTPException(status_code=400, detail="Sale is already refunded")
    if sale.status == "cancelled":
        raise HTTPException(status_code=400, detail="Cannot refund a cancelled sale — use delete instead")
    if sale.status == "pending" and sale.payment_status != "failed":
        raise HTTPException(status_code=400, detail="Can only refund pending sales with failed payment — cancel the sale instead")
    if sale.status not in ("completed", "pending"):
        raise HTTPException(status_code=400, detail=f"Cannot refund a sale with status '{sale.status}'")

    refund_method = (data.refund_method or sale.payment_method).strip() if data else (sale.payment_method or "cash").strip()
    refund_provider = data.refund_provider if data else None
    if refund_provider is None and refund_method == "mobile_money":
        refund_provider = sale.payment_provider
    try:
        validate_payment(refund_method, refund_provider)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    _restore_stock_for_sale(db, sale, reason="Refund")

    sale.status = "refunded"
    sale.refund_status = "completed" if refund_method == "cash" else "pending"
    sale.refunded_at = datetime.now(timezone.utc)
    sale.refund_method = refund_method
    sale.refund_provider = refund_provider
    sale.payment_status = "completed" if sale.payment_status == "completed" else "cancelled"
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


@router.put("/{sale_id}/checkout-id")
def update_checkout_id(sale_id: int, checkout_request_id: str = "", db: Session = Depends(get_db), user=Depends(require_permission("sales.create"))):
    sale = load_sale(db, sale_id)
    sale.payment_checkout_request_id = checkout_request_id or None
    db.commit()
    return {"ok": True}


@router.post("/{sale_id}/cancel", response_model=SaleOut)
def cancel_sale(sale_id: int, db: Session = Depends(get_db), user=Depends(require_permission("sales.refund"))):
    sale = load_sale(db, sale_id)
    if sale.status == "cancelled":
        raise HTTPException(status_code=400, detail="Sale is already cancelled")
    if sale.status not in ("pending", "completed"):
        raise HTTPException(status_code=400, detail=f"Cannot cancel a sale with status '{sale.status}'")

    _restore_stock_for_sale(db, sale, reason="Cancellation")

    sale.status = "cancelled"
    sale.payment_status = "cancelled"
    db.commit()
    db.refresh(sale)
    log_activity(db, user.id, user.username, "update", "sale", sale.id,
                 f"Cancelled sale '{sale.invoice_number}' — stock restored")
    notify_admins(db, f"Sale {sale.invoice_number} cancelled",
                  f"${float(sale.total_amount):.2f} returned to stock", type="warning", link="/sales")
    db.commit()
    broadcast_change("sale", "updated")
    broadcast_change("stock_movement", "created")
    broadcast_change("product", "updated")
    return _apply_sale_locations(db, SaleOut.model_validate(sale))


@router.delete("/{sale_id}", status_code=204)
def delete_sale(sale_id: int, db: Session = Depends(get_db), user=Depends(require_permission("sales.refund"))):
    sale = load_sale(db, sale_id)
    if sale.status not in ("pending", "cancelled"):
        raise HTTPException(status_code=400, detail=f"Cannot delete a sale with status '{sale.status}' — cancel it first")

    if sale.status == "pending":
        _restore_stock_for_sale(db, sale, reason="Deletion")

    log_activity(db, user.id, user.username, "delete", "sale", sale.id,
                 f"Deleted sale '{sale.invoice_number}'" + (" — stock restored" if sale.status == "pending" else ""))
    db.delete(sale)
    db.commit()
    broadcast_change("sale", "deleted")
    broadcast_change("stock_movement", "created")
    broadcast_change("product", "updated")


@router.post("/cleanup-expired", response_model=dict)
def cleanup_expired_pending_sales(db: Session = Depends(get_db)):
    """Auto-cancel pending sales older than 10 minutes with failed or null
    payment status.  Returns the number of cancelled sales."""
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=10)
    stale = db.query(Sale).options(
        joinedload(Sale.items).joinedload(SaleItem.product),
    ).filter(
        Sale.status == "pending",
        Sale.created_at < cutoff,
        (Sale.payment_status.in_(["failed", "pending"])) | (Sale.payment_status.is_(None)),
    ).all()
    count = 0
    for sale in stale:
        _restore_stock_for_sale(db, sale, reason="Auto-cancel")
        sale.status = "cancelled"
        sale.payment_status = "cancelled"
        log_activity(db, 0, "system", "update", "sale", sale.id,
                     f"Auto-cancelled expired pending sale '{sale.invoice_number}'")
        count += 1
    if count:
        db.commit()
        broadcast_change("sale", "updated")
        broadcast_change("stock_movement", "created")
        broadcast_change("product", "updated")
    return {"cancelled": count}


@router.put("/{sale_id}/refund/complete", response_model=SaleOut)
def complete_sale_refund(sale_id: int, db: Session = Depends(get_db), user=Depends(require_permission("sales.refund"))):
    sale = load_sale(db, sale_id)
    if sale.status != "refunded":
        raise HTTPException(status_code=400, detail="Only refunded sales can be marked complete")
    if sale.refund_status == "completed":
        raise HTTPException(status_code=400, detail="Refund is already completed")
    sale.refund_status = "completed"
    db.commit()
    db.refresh(sale)
    log_activity(db, user.id, user.username, "update", "sale", sale.id,
                 f"Marked refund for '{sale.invoice_number}' complete ({sale.refund_method} / {sale.refund_provider or 'n/a'})")
    db.commit()
    broadcast_change("sale", "updated")
    return _apply_sale_locations(db, SaleOut.model_validate(sale))


@router.get("/{sale_id}/pdf")
def sale_pdf(sale_id: int, db: Session = Depends(get_db)):
    sale = load_sale(db, sale_id)
    s = db.query(Settings).first()
    base_dir = Path(__file__).resolve().parent.parent

    store_name = (s.store_name if s else None) or "My Store"
    currency = sale.currency_symbol or (s.currency_symbol if s else "$") or "$"
    store_lines = [store_name] + [ln for ln in (
        (s.address if s else None),
        (s.phone if s else None),
        (s.email if s else None),
    ) if ln]

    c, buf = new_canvas(f"Invoice {sale.invoice_number}")

    if sale.status == "cancelled":
        draw_watermark(c, "CANCELLED", "cancelled")
    elif sale.refund_status == "completed":
        draw_watermark(c, "REFUNDED", "refunded")
    elif sale.payment_status == "pending":
        draw_watermark(c, "PENDING PAYMENT", "pending")

    meta = [
        ("Invoice #:", sale.invoice_number),
        ("Date:", sale.created_at.strftime("%b %d, %Y")),
        ("Status:", sale.status.replace("_", " ").title()),
    ]
    if s and s.payment_terms:
        meta.append(("Terms:", s.payment_terms))

    body_y = draw_banner_header(
        c, "INVOICE", meta, store_lines,
        logo_url=(s.logo_url if s else ""),
        base_dir=base_dir,
    )

    mid_x = BODY_RIGHT / 2 + 10
    bill_lines = [sale.customer_name or "Walk-in"]
    if sale.customer and sale.customer.phone:
        bill_lines.append(f"Phone: {sale.customer.phone}")
    if sale.customer and sale.customer.email:
        bill_lines.append(f"Email: {sale.customer.email}")
    if sale.customer and sale.customer.address:
        bill_lines.append(sale.customer.address)
    bill_y = draw_info_block(c, MARGIN, body_y, "Bill To", bill_lines)

    pay_lines = [sale.payment_method.replace("_", " ").title()]
    if sale.payment_method == "mobile_money" and sale.payment_provider:
        pay_lines[0] = sale.payment_provider
    if sale.payment_reference:
        pay_lines.append(f"Ref: {sale.payment_reference}")
    if sale.payment_phone:
        pay_lines.append(f"Phone: {sale.payment_phone}")
    pay_y = draw_info_block(c, mid_x, body_y, "Payment", pay_lines)

    info_y = min(bill_y, pay_y)

    loc_map = _movement_location_map(db, [sale.invoice_number]).get(sale.invoice_number, {})
    headers = ["Item", "Location", "Unit Price", "Qty", "Amount"]
    aligns = ["l", "l", "r", "r", "r"]
    col_widths = [210.0, 100.0, 70.0, 38.0, 88.0]
    rows = []
    for item in sale.items:
        name = item.product_name or f"Product #{item.product_id}"
        locs = loc_map.get(item.product_id, [])
        rows.append([
            (name[:44] + "\u2026") if len(name) > 44 else name,
            (", ".join(locs)[:22] + "\u2026") if len(", ".join(locs)) > 22 else (", ".join(locs) or "\u2014"),
            f"{currency}{float(item.unit_price):.2f}",
            str(item.quantity),
            f"{currency}{float(item.unit_price) * item.quantity:.2f}",
        ])

    y = draw_item_table(
        c, MARGIN, info_y, headers, aligns, col_widths, rows,
        on_page_break=lambda c: draw_banner_header(
            c, "INVOICE", meta, store_lines,
            logo_url=(s.logo_url if s else ""),
            base_dir=base_dir,
        ),
    )

    tax_rate = s.tax_rate if s else 0
    totals = [
        ("Subtotal", f"{currency}{float(sale.subtotal):.2f}"),
    ]
    if sale.discount_amount:
        totals.append(("Discount", f"-{currency}{float(sale.discount_amount):.2f}"))
    if sale.promo_discount:
        totals.append((f"Promo ({sale.promo_code})", f"-{currency}{float(sale.promo_discount):.2f}"))
    totals.append((f"Tax ({tax_rate}%)", f"{currency}{float(sale.tax_amount):.2f}"))
    y = draw_totals(c, BODY_RIGHT, y, totals, "Total", f"{currency}{float(sale.total_amount):.2f}")

    if sale.payment_method == "mobile_money" and sale.payment_provider:
        c.setFont(FONT, 9)
        c.setFillColor(MUTED)
        c.drawString(MARGIN, y, f"Paid via {sale.payment_provider}" + (f" - Ref: {sale.payment_reference}" if sale.payment_reference else ""))
        y -= 14

    if sale.refund_status:
        c.setFont(FONT, 9)
        c.setFillColor(ACCENT)
        refund_label = f"Refund: {sale.refund_status.replace('_', ' ').title()}"
        if sale.refund_method:
            refund_label += f" ({sale.refund_method.replace('_', ' ').title()})"
        c.drawString(MARGIN, y, refund_label)
        y -= 14

    if sale.notes:
        draw_notes(c, MARGIN, y, sale.notes)
        y -= 18

    footer_parts = []
    if s and s.bank_details:
        footer_parts.append(s.bank_details[:160])
    if s and s.footer_note:
        footer_parts.append(s.footer_note[:160])
    draw_signoff(c, y, "Thank you for your business!")

    draw_page_footer(c, 1, tax_id=(s.tax_id if s else ""), footer_note=(s.footer_note if s else ""))

    return Response(render_pdf(c, buf), media_type="application/pdf", headers={
        "Content-Disposition": f"inline; filename={sale.invoice_number}.pdf"
    })


@router.post("/bulk-pdf")
def bulk_sales_pdf(ids: list[int], db: Session = Depends(get_db)):
    from PyPDF2 import PdfReader, PdfWriter

    if not ids:
        raise HTTPException(400, "No sale IDs provided")
    if len(ids) > 100:
        raise HTTPException(400, "Cannot combine more than 100 invoices")

    writer = PdfWriter()
    base_dir = Path(__file__).resolve().parent.parent
    sales = db.query(Sale).filter(Sale.id.in_(ids)).order_by(Sale.id).all()

    for sale in sales:
        s = db.query(Settings).first()
        store_name = (s.store_name if s else None) or "My Store"
        currency = sale.currency_symbol or (s.currency_symbol if s else "$") or "$"
        store_lines = [store_name] + [ln for ln in (
            (s.address if s else None),
            (s.phone if s else None),
            (s.email if s else None),
        ) if ln]

        c, buf = new_canvas(f"Invoice {sale.invoice_number}")

        if sale.status == "cancelled":
            draw_watermark(c, "CANCELLED", "cancelled")
        elif sale.refund_status == "completed":
            draw_watermark(c, "REFUNDED", "refunded")
        elif sale.payment_status == "pending":
            draw_watermark(c, "PENDING PAYMENT", "pending")

        meta = [
            ("Invoice #:", sale.invoice_number),
            ("Date:", sale.created_at.strftime("%b %d, %Y")),
            ("Status:", sale.status.replace("_", " ").title()),
        ]
        if s and s.payment_terms:
            meta.append(("Terms:", s.payment_terms))

        body_y = draw_banner_header(
            c, "INVOICE", meta, store_lines,
            logo_url=(s.logo_url if s else ""),
            base_dir=base_dir,
        )

        mid_x = BODY_RIGHT / 2 + 10
        bill_lines = [sale.customer_name or "Walk-in"]
        if sale.customer and sale.customer.phone:
            bill_lines.append(f"Phone: {sale.customer.phone}")
        if sale.customer and sale.customer.email:
            bill_lines.append(f"Email: {sale.customer.email}")
        if sale.customer and sale.customer.address:
            bill_lines.append(sale.customer.address)
        bill_y = draw_info_block(c, MARGIN, body_y, "Bill To", bill_lines)

        pay_lines = [sale.payment_method.replace("_", " ").title()]
        if sale.payment_method == "mobile_money" and sale.payment_provider:
            pay_lines[0] = sale.payment_provider
        if sale.payment_reference:
            pay_lines.append(f"Ref: {sale.payment_reference}")
        if sale.payment_phone:
            pay_lines.append(f"Phone: {sale.payment_phone}")
        pay_y = draw_info_block(c, mid_x, body_y, "Payment", pay_lines)

        info_y = min(bill_y, pay_y)

        loc_map = _movement_location_map(db, [sale.invoice_number]).get(sale.invoice_number, {})
        headers = ["Item", "Location", "Unit Price", "Qty", "Amount"]
        aligns = ["l", "l", "r", "r", "r"]
        col_widths = [210.0, 100.0, 70.0, 38.0, 88.0]
        rows = []
        for item in sale.items:
            name = item.product_name or f"Product #{item.product_id}"
            locs = loc_map.get(item.product_id, [])
            rows.append([
                (name[:44] + "\u2026") if len(name) > 44 else name,
                (", ".join(locs)[:22] + "\u2026") if len(", ".join(locs)) > 22 else (", ".join(locs) or "\u2014"),
                f"{currency}{float(item.unit_price):.2f}",
                str(item.quantity),
                f"{currency}{float(item.unit_price) * item.quantity:.2f}",
            ])

        y = draw_item_table(c, MARGIN, info_y - 12, headers, aligns, col_widths, rows)

        subtotal = float(sale.subtotal)
        tax = float(sale.tax_amount)
        total = float(sale.total_amount)
        tax_rate = s.tax_rate if s else 0
        totals = [
            ("Subtotal", f"{currency}{subtotal:.2f}"),
        ]
        if sale.discount_amount:
            totals.append(("Discount", f"-{currency}{float(sale.discount_amount):.2f}"))
        if sale.promo_discount:
            totals.append((f"Promo ({sale.promo_code})", f"-{currency}{float(sale.promo_discount):.2f}"))
        totals.append((f"Tax ({tax_rate}%)", f"{currency}{tax:.2f}"))
        y = draw_totals(c, BODY_RIGHT, y, totals, "Total", f"{currency}{total:.2f}")

        if sale.notes:
            draw_notes(c, MARGIN, y, sale.notes)
            y -= 18

        draw_signoff(c, y, "Thank you for your business!")
        draw_page_footer(c, 1, tax_id=(s.tax_id if s else ""), footer_note=(s.footer_note if s else ""))

        pdf_bytes = render_pdf(c, buf)
        reader = PdfReader(io.BytesIO(pdf_bytes))
        for page in reader.pages:
            writer.add_page(page)

    out_buf = io.BytesIO()
    writer.write(out_buf)
    out_buf.seek(0)

    combined = out_buf.getvalue()
    return Response(combined, media_type="application/pdf", headers={
        "Content-Disposition": "inline; filename=invoices_combined.pdf"
    })
