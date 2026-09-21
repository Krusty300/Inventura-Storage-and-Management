"""Customer portal API: a scoped, read-mostly surface for customer logins.

Customers authenticate as ``User`` rows with ``role="customer"`` linked to a
``Customer`` via ``users.customer_id``. Like suppliers, they hold none of the
internal staff permissions; every query here is scoped to the linked customer:
customer A can only ever see (and re-order from) customer A's own history.

The customer portal exposes four things for now:
* their profile, profile image, and a short sales summary (``/me``, ``/summary``,
  ``POST/DELETE /profile/image``)
* the store catalog with prices resolved for this customer (``/products``),
  which flows through ``pricing.resolve_price`` so group price lists (and
  eventually personal lists) apply automatically
* their own sales history and invoicing (``/sales``)
"""

from math import ceil
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field, field_validator, model_validator
import re
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.constants import MAX_PAGE_SIZE
from app.database import get_db
from app.models.customer import Customer
from app.models.product import Product
from app.models.sale import Sale, SaleItem
from app.models.settings import Settings
from app.models.user import User
from app.routers.sales import _qc_blockers, generate_invoice_number, get_currency_defaults, get_tax_rate, sale_pdf
from app.schemas.customer import CustomerOut
from app.schemas.sale import SaleOut
from app.schemas.user import UserOut
from app.services import inventory
from app.services.auth import get_current_user, hash_password, verify_password
from app.services.filters import apply_date_range
from app.services.notify import notify_admins, notify_low_stock
from app.services.password_policy import validate_password
from app.services.payment_methods import resolve_payment_details
from app.services.pricing import resolve_price
from app.utils import detect_image_ext, get_or_404, log_activity, broadcast_change

router = APIRouter(prefix="/api/customer", tags=["customer portal"])

UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads"
ALLOWED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
JPEG_EXTENSIONS = {".jpg", ".jpeg"}
MAX_IMAGE_SIZE = 5 * 1024 * 1024

# A customer's invoices that still need payment / are live.
ACTIVE_SALE_STATUSES = ("completed", "pending")


class CustomerProfileUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None

    @field_validator("email")
    @classmethod
    def _validate_email(cls, v: Optional[str]) -> Optional[str]:
        v = (v or "").strip()
        if v and not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", v):
            raise ValueError("Invalid email address")
        return v


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class CheckoutItemCreate(BaseModel):
    product_id: int
    quantity: int = Field(gt=0)


class CheckoutRequest(BaseModel):
    items: list[CheckoutItemCreate]
    payment_method: str = "cash"
    payment_provider: Optional[str] = None
    payment_reference: Optional[str] = None

    @model_validator(mode="after")
    def _validate_items_not_empty(self):
        if not self.items:
            raise ValueError("Checkout must contain at least one item")
        return self


class PricingRequest(BaseModel):
    items: list[CheckoutItemCreate]

    @model_validator(mode="after")
    def _validate_items_not_empty(self):
        if not self.items:
            raise ValueError("Cart is empty")
        return self


class PricingItemOut(BaseModel):
    product_id: int
    unit_price: float
    line_total: float


class PricingResponse(BaseModel):
    items: list[PricingItemOut]
    subtotal: float
    tax_rate: float
    tax_amount: float
    total: float


class CatalogProduct(BaseModel):
    id: int
    sku: str
    name: str
    description: str
    category_name: str = ""
    unit_price: float
    price: float
    image_url: str = ""
    in_stock: bool

    class Config:
        from_attributes = True


def require_customer(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Customer:
    """Resolve the linked customer for a customer account, or 403."""
    if user.role != "customer":
        raise HTTPException(status_code=403, detail="Customer portal access requires a customer account")
    if user.customer_id is None:
        raise HTTPException(status_code=403, detail="Customer account is not linked to a customer")
    customer = db.get(Customer, user.customer_id)
    if customer is None or customer.is_deleted or not customer.is_active:
        raise HTTPException(status_code=403, detail="Linked customer is unavailable")
    return customer


def _get_portal_sale(db: Session, customer: Customer, sale_id: int) -> Sale:
    """Load a sale the customer may see, else 404 (existence is hidden)."""
    s = get_or_404(Sale, sale_id, db, options=[joinedload(Sale.items)])
    if s.customer_id != customer.id:
        raise HTTPException(status_code=404, detail="Sale not found")
    return s


@router.get("/me")
def customer_me(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    customer: Customer = Depends(require_customer),
):
    s = db.query(Settings).first()
    default_currency, default_symbol = get_currency_defaults(db)
    return {
        "user": UserOut.model_validate(user),
        "customer": CustomerOut.model_validate(customer),
        "store_name": (s.store_name if s else None) or "My Store",
        "currency_code": default_currency,
        "currency_symbol": default_symbol,
        "logo_url": (s.logo_url if s else None) or "",
        "tax_rate": float(s.tax_rate) if s else 0.0,
        "date_format": (s.date_format if s else None) or "YYYY-MM-DD",
        "default_items_per_page": int((s.default_items_per_page if s else 25) or 25),
    }


@router.get("/summary")
def customer_summary(
    db: Session = Depends(get_db),
    customer: Customer = Depends(require_customer),
):
    rows = (
        db.query(Sale.status, func.count(Sale.id), func.coalesce(func.sum(Sale.total_amount), 0))
        .filter(Sale.customer_id == customer.id)
        .group_by(Sale.status)
        .all()
    )
    status_counts = {st: 0 for st in ("pending", "completed", "cancelled", "refunded")}
    total_spent = 0.0
    for status, count, total in rows:
        status_counts[status] = int(count)
        if status in ("completed", "pending"):
            total_spent += float(total)
    recent = (
        db.query(Sale).options(joinedload(Sale.items))
        .filter(Sale.customer_id == customer.id)
        .order_by(Sale.created_at.desc())
        .limit(5)
        .all()
    )
    total_sales = sum(status_counts.values())
    return {
        "status_counts": status_counts,
        "total_sales": total_sales,
        "total_spent": round(total_spent, 2),
        "recent_sales": [SaleOut.model_validate(s) for s in recent],
    }


@router.get("/products")
def customer_catalog(
    search: str = Query(""),
    category_id: int | None = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=MAX_PAGE_SIZE),
    db: Session = Depends(get_db),
    customer: Customer = Depends(require_customer),
):
    q = db.query(Product).options(joinedload(Product.images)).filter(
        Product.parent_id.is_(None),
        Product.is_deleted == False,  # noqa: E712
        Product.is_active == True,  # noqa: E712
    )
    if search:
        like = f"%{search}%"
        q = q.filter(Product.name.ilike(like) | Product.sku.ilike(like) | Product.barcode.ilike(like))
    if category_id is not None:
        q = q.filter(Product.category_id == category_id)
    total = q.count()
    products = q.order_by(Product.name).offset(skip).limit(limit).all()
    items = []
    for p in products:
        price = resolve_price(db, p.id, customer_id=customer.id)
        items.append(CatalogProduct(
            id=p.id,
            sku=p.sku,
            name=p.display_name,
            description=p.description,
            category_name=p.category_name,
            unit_price=float(p.unit_price),
            price=price,
            image_url=p.image_url or (p.images[0].url if p.images else ""),
            in_stock=p.total_quantity > 0,
        ))
    return {
        "items": items,
        "total": total,
        "page": (skip // limit) + 1,
        "pages": max(ceil(total / limit), 1),
    }


@router.get("/products/{product_id}", response_model=CatalogProduct)
def customer_catalog_detail(
    product_id: int,
    db: Session = Depends(get_db),
    customer: Customer = Depends(require_customer),
):
    p = get_or_404(Product, product_id, db, options=[joinedload(Product.images)])
    if p.parent_id is not None or not p.is_active or p.is_deleted:
        raise HTTPException(status_code=404, detail="Product not found")
    price = resolve_price(db, p.id, customer_id=customer.id)
    return CatalogProduct(
        id=p.id,
        sku=p.sku,
        name=p.display_name,
        description=p.description,
        category_name=p.category_name,
        unit_price=float(p.unit_price),
        price=price,
        image_url=p.image_url or (p.images[0].url if p.images else ""),
        in_stock=p.total_quantity > 0,
    )


@router.post("/pricing", response_model=PricingResponse)
def customer_pricing(
    data: PricingRequest,
    db: Session = Depends(get_db),
    customer: Customer = Depends(require_customer),
):
    """Resolve live unit prices for the cart at the current quantities.

    Mirrors the checkout validation (variant/serialized/QC guards and
    ``resolve_price`` with quantity for tier pricing) so the cart summary shows
    exactly what the invoice will total before the order is placed.
    """
    product_ids = list({item.product_id for item in data.items})
    products = {p.id: p for p in db.query(Product).filter(Product.id.in_(product_ids)).all()}
    parents_with_variants = {
        pid for (pid,) in db.query(Product.parent_id)
        .filter(Product.parent_id.in_(product_ids), Product.is_active == True, Product.parent_id.isnot(None))  # noqa: E712
        .distinct().all()
    }
    lines = []
    subtotal = 0.0
    for item in data.items:
        product = products.get(item.product_id)
        if product is None or product.is_deleted or not product.is_active:
            raise HTTPException(status_code=404, detail=f"Product {item.product_id} not found")
        if not product.is_variant and product.id in parents_with_variants:
            raise HTTPException(status_code=400, detail=f"'{product.display_name}' has variants - select a specific variant")
        if product.is_serialized:
            raise HTTPException(status_code=400, detail=f"'{product.display_name}' is serialized - not available for online checkout")
        blockers = _qc_blockers(db, product.id, None)
        if blockers:
            raise HTTPException(status_code=400, detail=f"'{product.display_name}' is not available for purchase right now")
        price = resolve_price(db, product.id, customer_id=customer.id, qty=item.quantity)
        line_total = item.quantity * price
        subtotal += line_total
        lines.append(PricingItemOut(product_id=item.product_id, unit_price=price, line_total=line_total))
    tax_rate = get_tax_rate(db)
    tax_amount = subtotal * tax_rate / 100
    return PricingResponse(
        items=lines,
        subtotal=round(subtotal, 2),
        tax_rate=tax_rate,
        tax_amount=round(tax_amount, 2),
        total=round(subtotal + tax_amount, 2),
    )


@router.post("/checkout", response_model=SaleOut, status_code=201)
def customer_checkout(
    data: CheckoutRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    customer: Customer = Depends(require_customer),
):
    """Place an order straight from the cart.

    Prices are always re-resolved server-side through ``resolve_price`` for this
    customer; the client never supplies ``unit_price``. Stock, quality checks,
    and serialization rules mirror the staff sale path, and the sale lands as
    ``completed`` (cash/card/transfer only for now).
    """
    if data.payment_method not in ("cash", "card", "transfer"):
        raise HTTPException(
            status_code=400,
            detail="Mobile money checkout is not available yet - choose cash, card, or bank transfer",
        )
    try:
        default_currency, default_symbol = get_currency_defaults(db)
        payment = resolve_payment_details(
            data.payment_method, data.payment_provider, None, None, None,
            default_currency=default_currency, default_symbol=default_symbol,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    product_ids = list({item.product_id for item in data.items})
    products = {p.id: p for p in db.query(Product).filter(Product.id.in_(product_ids)).all()}
    parents_with_variants = {
        pid for (pid,) in db.query(Product.parent_id)
        .filter(Product.parent_id.in_(product_ids), Product.is_active == True, Product.parent_id.isnot(None))  # noqa: E712
        .distinct().all()
    }
    subtotal = 0.0
    resolved: dict[int, float] = {}
    for item in data.items:
        product = products.get(item.product_id)
        if product is None or product.is_deleted or not product.is_active:
            raise HTTPException(status_code=404, detail=f"Product {item.product_id} not found")
        if not product.is_variant and product.id in parents_with_variants:
            raise HTTPException(status_code=400, detail=f"'{product.display_name}' has variants - select a specific variant")
        if product.is_serialized:
            raise HTTPException(status_code=400, detail=f"'{product.display_name}' is serialized - not available for online checkout")
        blockers = _qc_blockers(db, product.id, None)
        if blockers:
            raise HTTPException(status_code=400, detail=f"'{product.display_name}' is not available for purchase right now")
        price = resolve_price(db, product.id, customer_id=customer.id, qty=item.quantity)
        resolved[product.id] = price
        subtotal += item.quantity * price

    tax_rate = get_tax_rate(db)
    tax_amount = subtotal * tax_rate / 100
    sale = Sale(
        invoice_number=generate_invoice_number(db),
        customer_id=customer.id,
        user_id=user.id,
        channel_id=None,
        subtotal=subtotal,
        discount_amount=0.0,
        tax_amount=tax_amount,
        total_amount=subtotal + tax_amount,
        status="completed",
        payment_method=data.payment_method,
        payment_provider=payment["provider"],
        payment_reference=(data.payment_reference or "").strip() or None,
        payment_phone=None,
        payment_provider_amount=None,
        currency=payment["currency"],
        currency_symbol=payment["currency_symbol"],
        payment_status=None,
    )
    db.add(sale)
    db.flush()

    try:
        for item in data.items:
            product = products[item.product_id]
            db.add(SaleItem(sale_id=sale.id, product_id=product.id, quantity=item.quantity, unit_price=resolved[product.id]))
            allocation = inventory.allocate_lots(db, product_id=product.id, quantity=item.quantity, location_id=None)
            for lot_id, take, location_id, lpn_id in allocation:
                inventory.post_journal_entry(
                    db, product_id=product.id, user_id=user.id,
                    quantity_change=-take, movement_type=inventory.SALE,
                    lot_id=lot_id, from_location_id=location_id, lpn_id=lpn_id,
                    reference_type="sale", reference=sale.invoice_number,
                    notes=f"Portal checkout for {customer.name}",
                )
    except inventory.InventoryError:
        db.rollback()
        raise HTTPException(status_code=400, detail="One or more items are out of stock - update quantities and try again")

    db.commit()
    sale = get_or_404(Sale, sale.id, db, options=[joinedload(Sale.items)])
    s = db.query(Settings).first()
    currency = (s.currency_symbol if s else "$") or "$"
    log_activity(db, user.id, user.username, "create", "sale", sale.id,
                 f"Portal checkout '{sale.invoice_number}' for {currency}{float(sale.total_amount):.2f}")
    notify_admins(db, f"New portal order {sale.invoice_number}",
                  f"{customer.name} · {currency}{float(sale.total_amount):.2f}",
                  type="success", link="/sales", exclude_user_id=user.id)
    for item in sale.items:
        if item.product:
            notify_low_stock(db, item.product)
    db.commit()
    broadcast_change("sale", "created")
    broadcast_change("stock_movement", "created")
    return SaleOut.model_validate(sale)


@router.get("/sales")
def customer_sales(
    search: str = Query(""),
    status: str | None = None,
    created_after: str = Query(""),
    created_before: str = Query(""),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=MAX_PAGE_SIZE),
    db: Session = Depends(get_db),
    customer: Customer = Depends(require_customer),
):
    valid_statuses = ("pending", "completed", "cancelled", "refunded")
    q = db.query(Sale).filter(Sale.customer_id == customer.id)
    if status:
        if status not in valid_statuses:
            raise HTTPException(status_code=400, detail=f"Invalid sale status '{status}'")
        q = q.filter(Sale.status == status)
    if search:
        q = q.filter(Sale.invoice_number.ilike(f"%{search}%"))
    q = apply_date_range(q, Sale.created_at, created_after, created_before, "created_at")
    total = q.count()
    items = q.order_by(Sale.created_at.desc()).offset(skip).limit(limit).all()
    return {
        "items": [SaleOut.model_validate(s) for s in items],
        "total": total,
        "page": (skip // limit) + 1,
        "pages": max(ceil(total / limit), 1),
    }


@router.get("/sales/{sale_id}", response_model=SaleOut)
def customer_sale_detail(
    sale_id: int,
    db: Session = Depends(get_db),
    customer: Customer = Depends(require_customer),
):
    return _get_portal_sale(db, customer, sale_id)


@router.get("/sales/{sale_id}/pdf")
def customer_sale_pdf(
    sale_id: int,
    db: Session = Depends(get_db),
    customer: Customer = Depends(require_customer),
):
    s = _get_portal_sale(db, customer, sale_id)
    return sale_pdf(sale_id, db)


@router.patch("/profile", response_model=CustomerOut)
def customer_update_profile(
    data: CustomerProfileUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    customer: Customer = Depends(require_customer),
):
    updates = data.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No changes to apply")
    if "name" in updates and not (updates["name"] or "").strip():
        raise HTTPException(status_code=400, detail="Customer name cannot be empty")
    for key, value in updates.items():
        setattr(customer, key, value)
    db.commit()
    db.refresh(customer)
    log_activity(db, user.id, user.username, "update", "customer", customer.id,
                 f"Customer '{customer.name}' updated their profile")
    db.commit()
    broadcast_change("customer", "updated")
    return customer


def _delete_uploaded_image(image_url: str) -> None:
    if not image_url:
        return
    path = UPLOAD_DIR / Path(image_url).name
    try:
        if path.exists():
            path.unlink()
    except Exception:
        pass


@router.post("/profile/image")
def customer_upload_profile_image(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    customer: Customer = Depends(require_customer),
):
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")
    content = file.file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(content) > MAX_IMAGE_SIZE:
        raise HTTPException(status_code=400, detail="File too large (max 5 MB)")
    detected = detect_image_ext(content)
    if detected is None:
        raise HTTPException(status_code=400, detail="File content is not a supported image")
    matches = detected in JPEG_EXTENSIONS if ext in JPEG_EXTENSIONS else detected == ext
    if not matches:
        raise HTTPException(status_code=400, detail=f"File content does not match its extension ({ext})")
    _delete_uploaded_image(customer.image_url)
    UPLOAD_DIR.mkdir(exist_ok=True)
    filename = f"customer_{customer.id}_{uuid4().hex}{detected}"
    filepath = UPLOAD_DIR / filename
    with open(filepath, "wb") as f:
        f.write(content)
    customer.image_url = f"/uploads/{filename}"
    db.commit()
    db.refresh(customer)
    log_activity(db, user.id, user.username, "update", "customer", customer.id,
                 f"Customer '{customer.name}' uploaded their profile image")
    db.commit()
    broadcast_change("customer", "updated")
    return {"image_url": customer.image_url}


@router.delete("/profile/image")
def customer_remove_profile_image(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    customer: Customer = Depends(require_customer),
):
    _delete_uploaded_image(customer.image_url)
    customer.image_url = ""
    db.commit()
    db.refresh(customer)
    log_activity(db, user.id, user.username, "update", "customer", customer.id,
                 f"Customer '{customer.name}' removed their profile image")
    db.commit()
    broadcast_change("customer", "updated")
    return {"image_url": customer.image_url}


@router.post("/change-password")
def customer_change_password(
    data: ChangePasswordRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    customer: Customer = Depends(require_customer),
):
    if not verify_password(data.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    password_error = validate_password(data.new_password)
    if password_error:
        raise HTTPException(status_code=400, detail=password_error)
    user.password_hash = hash_password(data.new_password)
    db.commit()
    log_activity(db, user.id, user.username, "update", "user", user.id,
                 "Customer changed their portal password")
    db.commit()
    return {"ok": True}