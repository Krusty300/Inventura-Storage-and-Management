"""Supplier portal API: a scoped, read-mostly surface for supplier logins.

Suppliers authenticate as ``User`` rows with ``role="supplier"`` linked to a
``Supplier`` via ``users.supplier_id``. They hold none of the internal staff
permissions, so every query here is additionally scoped to the linked supplier:
supplier A can only ever see (and move) supplier A's purchase orders.

The supplier owns exactly two transitions in the PO pipeline -- acknowledging
an approved PO and marking an acknowledged PO in transit; the buyer team
handles receive via the internal orders API.
"""

from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.constants import MAX_PAGE_SIZE
from app.database import get_db
from app.models.asn import ASN, ASNItem
from app.models.order import Order, OrderItem
from app.models.product import Product
from app.models.receipt import Receipt, ReceiptItem
from app.models.settings import Settings
from app.models.supplier import Supplier
from app.models.user import User
from app.routers.asn import asn_pdf as render_asn_pdf
from app.routers.receipts import receipt_pdf as render_receipt_pdf
from app.schemas.asn import ASNOut
from app.schemas.order import OrderOut
from app.schemas.receipt import ReceiptOut
from app.schemas.supplier import SupplierOut
from app.schemas.user import UserOut
from app.services.auth import get_current_user
from app.services.filters import apply_date_range
from app.services.notify import notify_admins
from app.services.order_pdf import render_order_pdf
from app.services.sequences import next_document_number
from app.utils import broadcast_change, get_or_404, log_activity

router = APIRouter(prefix="/api/portal", tags=["portal"])

# Internal planning states (pending/submitted) stay hidden from suppliers.
PORTAL_VISIBLE_STATUSES = ("approved", "acknowledged", "in_transit", "received", "cancelled")
OPEN_STATUSES = ("approved", "acknowledged", "in_transit")

# The states a supplier may move a PO into, per current order status.
PORTAL_TRANSITIONS = {
    "approved": ("acknowledged",),
    "acknowledged": ("in_transit",),
}


class PortalStatusUpdate(BaseModel):
    status: str


def _order_options():
    return [
        joinedload(Order.items).joinedload(OrderItem.product).joinedload(Product.images),
        joinedload(Order.supplier), joinedload(Order.user), joinedload(Order.approver),
    ]


def require_supplier(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Supplier:
    """Resolve the linked supplier for a supplier account, or 403."""
    if user.role != "supplier":
        raise HTTPException(status_code=403, detail="Supplier portal access requires a supplier account")
    if user.supplier_id is None:
        raise HTTPException(status_code=403, detail="Supplier account is not linked to a supplier")
    supplier = db.get(Supplier, user.supplier_id)
    if supplier is None or supplier.is_deleted or not supplier.is_active:
        raise HTTPException(status_code=403, detail="Linked supplier is unavailable")
    return supplier


def _get_portal_order(db: Session, supplier: Supplier, order_id: int) -> Order:
    """Load an order the supplier may see, else 404 (existence is hidden)."""
    o = get_or_404(Order, order_id, db, options=_order_options())
    if o.supplier_id != supplier.id or o.status not in PORTAL_VISIBLE_STATUSES:
        raise HTTPException(status_code=404, detail="Order not found")
    return o


ASN_VISIBLE_STATUSES = ("pending", "received", "cancelled")


def _asn_options():
    return [
        joinedload(ASN.items).joinedload(ASNItem.product),
        joinedload(ASN.items).joinedload(ASNItem.location),
        joinedload(ASN.supplier), joinedload(ASN.order), joinedload(ASN.user),
    ]


def _receipt_options():
    return [
        joinedload(Receipt.items).joinedload(ReceiptItem.product),
        joinedload(Receipt.items).joinedload(ReceiptItem.lot),
        joinedload(Receipt.items).joinedload(ReceiptItem.location),
        joinedload(Receipt.supplier), joinedload(Receipt.user),
    ]


def _get_portal_asn(db: Session, supplier: Supplier, asn_id: int) -> ASN:
    """Load an ASN the supplier may see, else 404 (existence is hidden)."""
    a = get_or_404(ASN, asn_id, db, options=_asn_options())
    if a.supplier_id != supplier.id:
        raise HTTPException(status_code=404, detail="ASN not found")
    return a


def _get_portal_receipt(db: Session, supplier: Supplier, receipt_id: int) -> Receipt:
    """Load a receipt the supplier may see, else 404 (existence is hidden)."""
    r = get_or_404(Receipt, receipt_id, db, options=_receipt_options())
    if r.supplier_id != supplier.id:
        raise HTTPException(status_code=404, detail="Receipt not found")
    return r


@router.get("/me")
def portal_me(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    supplier: Supplier = Depends(require_supplier),
):
    s = db.query(Settings).first()
    return {
        "user": UserOut.model_validate(user),
        "supplier": SupplierOut.model_validate(supplier),
        "store_name": (s.store_name if s else None) or "My Store",
        "currency_symbol": (s.currency_symbol if s else "$") or "$",
    }


@router.get("/summary")
def portal_summary(
    db: Session = Depends(get_db),
    supplier: Supplier = Depends(require_supplier),
):
    rows = (
        db.query(Order.status, func.count(Order.id), func.coalesce(func.sum(Order.total_amount), 0))
        .filter(
            Order.supplier_id == supplier.id,
            Order.status.in_(PORTAL_VISIBLE_STATUSES),
        )
        .group_by(Order.status)
        .all()
    )
    status_counts = {st: 0 for st in PORTAL_VISIBLE_STATUSES}
    open_value = 0.0
    for status, count, total in rows:
        status_counts[status] = int(count)
        if status in OPEN_STATUSES:
            open_value += float(total)
    recent = (
        db.query(Order)
        .filter(Order.supplier_id == supplier.id, Order.status.in_(PORTAL_VISIBLE_STATUSES))
        .order_by(Order.created_at.desc())
        .limit(5)
        .all()
    )
    total_orders = sum(status_counts.values())
    open_orders = sum(status_counts[st] for st in OPEN_STATUSES)

    asn_rows = (
        db.query(ASN.status, func.count(ASN.id))
        .filter(ASN.supplier_id == supplier.id)
        .group_by(ASN.status)
        .all()
    )
    asn_counts = {st: 0 for st in ASN_VISIBLE_STATUSES}
    for st, count in asn_rows:
        if st in asn_counts:
            asn_counts[st] = int(count)
    recent_asns = (
        db.query(ASN)
        .filter(ASN.supplier_id == supplier.id)
        .order_by(ASN.created_at.desc())
        .limit(5)
        .all()
    )
    receipt_count = (
        db.query(func.count(Receipt.id))
        .filter(Receipt.supplier_id == supplier.id)
        .scalar()
        or 0
    )
    recent_receipts = (
        db.query(Receipt)
        .filter(Receipt.supplier_id == supplier.id)
        .order_by(Receipt.created_at.desc())
        .limit(5)
        .all()
    )
    return {
        "status_counts": status_counts,
        "total_orders": total_orders,
        "open_orders": open_orders,
        "open_value": round(open_value, 2),
        "recent_orders": [OrderOut.model_validate(o) for o in recent],
        "asn_counts": asn_counts,
        "total_asns": sum(asn_counts.values()),
        "receipt_count": receipt_count,
        "recent_asns": [ASNOut.model_validate(a) for a in recent_asns],
        "recent_receipts": [ReceiptOut.model_validate(r) for r in recent_receipts],
    }


@router.get("/orders")
def portal_orders(
    search: str = Query(""),
    status: str | None = None,
    created_after: str = Query(""),
    created_before: str = Query(""),
    expected_after: str = Query(""),
    expected_before: str = Query(""),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=MAX_PAGE_SIZE),
    db: Session = Depends(get_db),
    supplier: Supplier = Depends(require_supplier),
):
    q = db.query(Order).options(*_order_options()).filter(
        Order.supplier_id == supplier.id,
        Order.status.in_(PORTAL_VISIBLE_STATUSES),
    )
    if status:
        if status not in PORTAL_VISIBLE_STATUSES:
            raise HTTPException(status_code=400, detail=f"Invalid order status '{status}'")
        q = q.filter(Order.status == status)
    if search:
        q = q.filter(Order.order_number.ilike(f"%{search}%"))
    q = apply_date_range(q, Order.created_at, created_after, created_before, "created_at")
    q = apply_date_range(q, Order.expected_arrival, expected_after, expected_before, "expected_arrival")
    total = q.count()
    items = q.order_by(Order.created_at.desc()).offset(skip).limit(limit).all()
    return {
        "items": [OrderOut.model_validate(o) for o in items],
        "total": total,
        "page": (skip // limit) + 1,
        "pages": max(ceil(total / limit), 1),
    }


@router.get("/orders/{order_id}", response_model=OrderOut)
def portal_order_detail(
    order_id: int,
    db: Session = Depends(get_db),
    supplier: Supplier = Depends(require_supplier),
):
    return _get_portal_order(db, supplier, order_id)


@router.patch("/orders/{order_id}", response_model=OrderOut)
def portal_update_status(
    order_id: int,
    data: PortalStatusUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    supplier: Supplier = Depends(require_supplier),
):
    o = _get_portal_order(db, supplier, order_id)
    if data.status not in PORTAL_TRANSITIONS.get(o.status, ()):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot change order status from '{o.status}' to '{data.status}'",
        )
    o.status = data.status
    db.flush()

    # Shipment is on the way: raise an ASN so receiving has a plan to work
    # against. Idempotent -- an order never gets more than one auto-ASN.
    asn_created = None
    if data.status == "in_transit":
        existing = db.query(ASN).filter(ASN.order_id == o.id).first()
        if existing is None:
            asn = ASN(
                asn_number=next_document_number(db, "asn", "ASN-"),
                supplier_id=o.supplier_id,
                order_id=o.id,
                user_id=user.id,
                status="pending",
                expected_arrival=o.expected_arrival.date() if o.expected_arrival else None,
                notes=f"Auto-created from purchase order {o.order_number}",
            )
            db.add(asn)
            db.flush()
            for item in o.items:
                remaining = item.quantity - item.received_qty
                if remaining > 0:
                    db.add(ASNItem(
                        asn_id=asn.id,
                        product_id=item.product_id,
                        expected_qty=remaining,
                        unit_cost=float(item.unit_price),
                        location_id=item.product.location_id if item.product else None,
                    ))
            asn_created = asn

    db.commit()
    db.refresh(o)
    log_activity(db, user.id, user.username, "update", "order", o.id,
                 f"Supplier '{supplier.name}' marked '{o.order_number}' as {o.status}")
    notify_admins(
        db, f"PO {o.order_number} {o.status}",
        f"Supplier '{supplier.name}' marked order #{o.order_number} as {o.status}.",
        type="info",
        link="/orders",
        exclude_user_id=user.id,
    )
    if asn_created is not None:
        log_activity(db, user.id, user.username, "create", "asn", asn_created.id,
                     f"Auto-created ASN '{asn_created.asn_number}' for '{o.order_number}'")
        notify_admins(
            db, f"ASN {asn_created.asn_number} awaiting receiving",
            f"Shipment for PO {o.order_number} is in transit. An ASN was raised automatically.",
            type="info",
            link="/asns",
            exclude_user_id=user.id,
        )
    db.commit()
    broadcast_change("order", "updated")
    broadcast_change("asn", "created")
    return o


@router.get("/orders/{order_id}/pdf")
def portal_order_pdf(
    order_id: int,
    db: Session = Depends(get_db),
    supplier: Supplier = Depends(require_supplier),
):
    o = _get_portal_order(db, supplier, order_id)
    return render_order_pdf(db, o)


@router.get("/asns")
def portal_asns(
    search: str = Query(""),
    status: str | None = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=MAX_PAGE_SIZE),
    db: Session = Depends(get_db),
    supplier: Supplier = Depends(require_supplier),
):
    q = db.query(ASN).options(*_asn_options()).filter(ASN.supplier_id == supplier.id)
    if status:
        if status not in ASN_VISIBLE_STATUSES:
            raise HTTPException(status_code=400, detail=f"Invalid ASN status '{status}'")
        q = q.filter(ASN.status == status)
    if search:
        like = f"%{search}%"
        q = q.filter(
            ASN.asn_number.ilike(like)
            | ASN.notes.ilike(like)
            | ASN.order.has(Order.order_number.ilike(like))
        )
    total = q.count()
    items = q.order_by(ASN.created_at.desc()).offset(skip).limit(limit).all()
    return {
        "items": [ASNOut.model_validate(a) for a in items],
        "total": total,
        "page": (skip // limit) + 1,
        "pages": max(ceil(total / limit), 1),
    }


@router.get("/asns/{asn_id}", response_model=ASNOut)
def portal_asn_detail(
    asn_id: int,
    db: Session = Depends(get_db),
    supplier: Supplier = Depends(require_supplier),
):
    return _get_portal_asn(db, supplier, asn_id)


@router.get("/asns/{asn_id}/pdf")
def portal_asn_pdf(
    asn_id: int,
    db: Session = Depends(get_db),
    supplier: Supplier = Depends(require_supplier),
):
    a = _get_portal_asn(db, supplier, asn_id)
    return render_asn_pdf(a.id, db)


@router.get("/receipts")
def portal_receipts(
    search: str = Query(""),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=MAX_PAGE_SIZE),
    db: Session = Depends(get_db),
    supplier: Supplier = Depends(require_supplier),
):
    q = db.query(Receipt).options(*_receipt_options()).filter(Receipt.supplier_id == supplier.id)
    if search:
        like = f"%{search}%"
        q = q.filter(
            Receipt.receipt_number.ilike(like)
            | Receipt.reference.ilike(like)
            | Receipt.notes.ilike(like)
        )
    total = q.count()
    items = q.order_by(Receipt.created_at.desc()).offset(skip).limit(limit).all()
    return {
        "items": [ReceiptOut.model_validate(r) for r in items],
        "total": total,
        "page": (skip // limit) + 1,
        "pages": max(ceil(total / limit), 1),
    }


@router.get("/receipts/{receipt_id}", response_model=ReceiptOut)
def portal_receipt_detail(
    receipt_id: int,
    db: Session = Depends(get_db),
    supplier: Supplier = Depends(require_supplier),
):
    return _get_portal_receipt(db, supplier, receipt_id)


@router.get("/receipts/{receipt_id}/pdf")
def portal_receipt_pdf(
    receipt_id: int,
    db: Session = Depends(get_db),
    supplier: Supplier = Depends(require_supplier),
):
    r = _get_portal_receipt(db, supplier, receipt_id)
    return render_receipt_pdf(r.id, db)