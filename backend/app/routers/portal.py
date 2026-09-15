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
from app.models.order import Order, OrderItem
from app.models.product import Product
from app.models.settings import Settings
from app.models.supplier import Supplier
from app.models.user import User
from app.schemas.order import OrderOut
from app.schemas.supplier import SupplierOut
from app.schemas.user import UserOut
from app.services.auth import get_current_user
from app.services.filters import apply_date_range
from app.services.notify import notify_admins
from app.services.order_pdf import load_order_for_pdf, render_order_pdf
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
    return {
        "status_counts": status_counts,
        "total_orders": total_orders,
        "open_orders": open_orders,
        "open_value": round(open_value, 2),
        "recent_orders": [OrderOut.model_validate(o) for o in recent],
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
    db.commit()
    broadcast_change("order", "updated")
    return o


@router.get("/orders/{order_id}/pdf")
def portal_order_pdf(
    order_id: int,
    db: Session = Depends(get_db),
    supplier: Supplier = Depends(require_supplier),
):
    o = _get_portal_order(db, supplier, order_id)
    return render_order_pdf(db, o)