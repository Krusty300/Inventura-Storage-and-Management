from io import StringIO
import csv
from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy import func, or_
from sqlalchemy.orm import Session
from app.constants import MAX_PAGE_SIZE_LOOKUP
from app.database import get_db
from app.models.customer import Customer
from app.models.customer_group import CustomerGroup
from app.models.product import Product
from app.models.sale import Sale, SaleItem
from app.schemas.customer import (
    CustomerBulkEdit, CustomerCreate, CustomerImportResult, CustomerListItem, CustomerOut,
    CustomerStats, CustomerUpdate, FrequentProduct,
)
from app.services.auth import require_permission
from app.utils import get_or_404, log_activity, broadcast_change

router = APIRouter(prefix="/api/customers", tags=["customers"], dependencies=[Depends(require_permission("customers.view"))])


def _find_duplicate(db: Session, name: str, phone: str, email: str, exclude_id: int | None = None) -> Customer | None:
    conds = []
    if name.strip():
        conds.append(Customer.name == name.strip())
    if phone.strip():
        conds.append(Customer.phone == phone.strip())
    if email.strip():
        conds.append(Customer.email == email.strip())
    if not conds:
        return None
    q = db.query(Customer).filter(Customer.is_active == True, or_(*conds))  # noqa: E712
    if exclude_id:
        q = q.filter(Customer.id != exclude_id)
    return q.first()


def _stats_query(db: Session):
    return (
        db.query(
            Sale.customer_id.label("customer_id"),
            func.count(Sale.id).label("total_sales"),
            func.coalesce(func.sum(Sale.total_amount), 0).label("total_spent"),
            func.max(Sale.created_at).label("last_purchase_at"),
        )
        .filter(Sale.status == "completed")
        .group_by(Sale.customer_id)
        .subquery()
    )


def _serialize_with_stats(c: Customer, total_sales, total_spent, last_purchase_at) -> CustomerListItem:
    total_sales = total_sales or 0
    total_spent = float(total_spent or 0)
    return CustomerListItem(
        **CustomerOut.model_validate(c).model_dump(),
        total_sales=total_sales,
        total_spent=total_spent,
        avg_order_value=round(total_spent / total_sales, 2) if total_sales else 0.0,
        last_purchase_at=last_purchase_at,
    )


@router.get("")
def list_customers(
    search: str = Query(""),
    customer_type: str = Query(""),
    group_id: int | None = Query(None),
    include_inactive: bool = False,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=MAX_PAGE_SIZE_LOOKUP),
    db: Session = Depends(get_db),
):
    stats = _stats_query(db)
    q = db.query(
        Customer, stats.c.total_sales, stats.c.total_spent, stats.c.last_purchase_at
    ).outerjoin(stats, stats.c.customer_id == Customer.id)
    if not include_inactive:
        q = q.filter(Customer.is_active == True)  # noqa: E712
    if search:
        like = f"%{search}%"
        q = q.filter(Customer.name.ilike(like) | Customer.phone.ilike(like) | Customer.email.ilike(like) | Customer.address.ilike(like))
    if customer_type:
        q = q.filter(Customer.customer_type == customer_type)
    if group_id is not None:
        q = q.filter(Customer.group_id == group_id)
    total = q.count()
    rows = q.order_by(Customer.name).offset(skip).limit(limit).all()
    items = [_serialize_with_stats(c, ts, tp, lp) for c, ts, tp, lp in rows]
    return {"items": items, "total": total, "page": (skip // limit) + 1, "pages": max(ceil(total / limit), 1)}


@router.patch("/bulk-edit")
def bulk_edit_customers(data: CustomerBulkEdit, db: Session = Depends(get_db), user=Depends(require_permission("customers.bulk"))):
    customers = db.query(Customer).filter(Customer.id.in_(data.ids)).all()
    if not customers:
        raise HTTPException(status_code=404, detail="No customers found")
    updates = data.model_dump(exclude_unset=True)
    updates.pop("ids", None)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    if "customer_type" in updates and updates["customer_type"] not in ("frequent", "walk-in"):
        raise HTTPException(status_code=400, detail="Invalid customer type")
    if "email" in updates and updates["email"].strip():
        dup = db.query(Customer).filter(
            Customer.is_active == True,  # noqa: E712
            Customer.email == updates["email"].strip(),
            Customer.id.notin_(data.ids),
        ).first()
        if dup:
            raise HTTPException(status_code=400, detail="Duplicate customer: another customer already uses the same email")
    for c in customers:
        for k, v in updates.items():
            setattr(c, k, v)
    db.commit()
    log_activity(db, user.id, user.username, "update", "customer", None,
                 f"Bulk-edited {len(customers)} customer(s): {', '.join(f'{k}={v}' for k, v in updates.items())}")
    db.commit()
    broadcast_change("customer", "updated")
    return {"updated": len(customers), "fields": list(updates.keys())}


@router.post("/import", response_model=CustomerImportResult)
def import_customers_csv(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user=Depends(require_permission("customers.import")),
):
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a CSV")
    content = file.file.read().decode("utf-8-sig")
    reader = csv.DictReader(StringIO(content))
    result = CustomerImportResult()
    seen = set()
    for row_idx, row in enumerate(reader, start=2):
        name = (row.get("name") or "").strip()
        if not name:
            result.errors.append(f"Row {row_idx}: missing required field 'name'")
            continue
        email = (row.get("email") or "").strip()
        phone = (row.get("phone") or "").strip()
        ctype = (row.get("customer_type") or "").strip() or "walk-in"
        if ctype not in ("frequent", "walk-in"):
            result.errors.append(f"Row {row_idx} ({name}): invalid customer_type '{ctype}'")
            continue
        key = (name.lower(), phone.lower(), email.lower())
        if key in seen:
            result.skipped += 1
            continue
        if _find_duplicate(db, name, phone, email):
            result.skipped += 1
            continue
        group_id = None
        group_name_raw = (row.get("group_name") or "").strip()
        if group_name_raw:
            grp = db.query(CustomerGroup).filter(CustomerGroup.name == group_name_raw).first()
            if grp:
                group_id = grp.id
            else:
                result.errors.append(f"Row {row_idx} ({name}): customer group '{group_name_raw}' not found")
                continue
        db.add(Customer(
            name=name,
            phone=phone,
            email=email,
            address=(row.get("address") or "").strip(),
            customer_type=ctype,
            group_id=group_id,
            notes=(row.get("notes") or "").strip(),
        ))
        seen.add(key)
        log_activity(db, user.id, user.username, "create", "customer", None, f"Imported customer '{name}'")
        result.created += 1
    db.commit()
    if result.created:
        broadcast_change("customer", "created")
    return result


@router.get("/{customer_id}/stats", response_model=CustomerStats)
def customer_stats(customer_id: int, db: Session = Depends(get_db)):
    get_or_404(Customer, customer_id, db)
    row = db.query(
        func.count(Sale.id),
        func.coalesce(func.sum(Sale.total_amount), 0),
        func.max(Sale.created_at),
    ).filter(Sale.customer_id == customer_id, Sale.status == "completed").first()
    total_sales = row[0] or 0
    total_spent = float(row[1] or 0)
    return CustomerStats(
        total_sales=total_sales,
        total_spent=total_spent,
        avg_order_value=round(total_spent / total_sales, 2) if total_sales else 0.0,
        last_purchase_at=row[2],
    )


@router.get("/{customer_id}/frequent-products", response_model=list[FrequentProduct])
def customer_frequent_products(
    customer_id: int,
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
):
    """Top products this customer buys most often, across all completed sales,
    ranked by number of orders containing the product then total quantity."""
    get_or_404(Customer, customer_id, db)
    rows = (
        db.query(
            Product.id.label("product_id"),
            Product.name.label("product_name"),
            Product.sku.label("sku"),
            func.count(func.distinct(SaleItem.sale_id)).label("order_count"),
            func.coalesce(func.sum(SaleItem.quantity), 0).label("total_quantity"),
        )
        .join(SaleItem, SaleItem.product_id == Product.id)
        .join(Sale, Sale.id == SaleItem.sale_id)
        .filter(Sale.customer_id == customer_id, Sale.status == "completed")
        .group_by(Product.id, Product.name, Product.sku)
        .order_by(func.count(func.distinct(SaleItem.sale_id)).desc(), func.sum(SaleItem.quantity).desc())
        .limit(limit)
        .all()
    )
    return [
        FrequentProduct(
            product_id=r.product_id,
            product_name=r.product_name,
            sku=r.sku or "",
            order_count=int(r.order_count or 0),
            total_quantity=int(r.total_quantity or 0),
        )
        for r in rows
    ]


@router.post("/{customer_id}/restore", response_model=CustomerOut)
def restore_customer(customer_id: int, db: Session = Depends(get_db), user=Depends(require_permission("customers.update"))):
    c = get_or_404(Customer, customer_id, db)
    c.is_active = True
    db.commit()
    db.refresh(c)
    log_activity(db, user.id, user.username, "update", "customer", c.id, f"Restored customer '{c.name}'")
    db.commit()
    broadcast_change("customer", "updated")
    return c


@router.get("/{customer_id}", response_model=CustomerOut)
def get_customer(customer_id: int, db: Session = Depends(get_db)):
    return get_or_404(Customer, customer_id, db)


@router.post("", response_model=CustomerOut, status_code=201)
def create_customer(data: CustomerCreate, db: Session = Depends(get_db), user=Depends(require_permission("customers.create"))):
    if _find_duplicate(db, data.name, data.phone, data.email):
        raise HTTPException(status_code=400, detail="Duplicate customer: a customer with the same name, phone, or email already exists")
    c = Customer(**data.model_dump())
    db.add(c)
    db.commit()
    db.refresh(c)
    log_activity(db, user.id, user.username, "create", "customer", c.id, f"Created customer '{c.name}'")
    db.commit()
    broadcast_change("customer", "created")
    return c


@router.put("/{customer_id}", response_model=CustomerOut)
def update_customer(customer_id: int, data: CustomerUpdate, db: Session = Depends(get_db), user=Depends(require_permission("customers.update"))):
    c = get_or_404(Customer, customer_id, db)
    updates = data.model_dump(exclude_unset=True)
    if _find_duplicate(
        db,
        updates.get("name", c.name),
        updates.get("phone", c.phone),
        updates.get("email", c.email),
        exclude_id=c.id,
    ):
        raise HTTPException(status_code=400, detail="Duplicate customer: another customer already uses the same name, phone, or email")
    for k, v in updates.items():
        setattr(c, k, v)
    db.commit()
    db.refresh(c)
    log_activity(db, user.id, user.username, "update", "customer", c.id, f"Updated customer '{c.name}'")
    db.commit()
    broadcast_change("customer", "updated")
    return c


@router.delete("/{customer_id}")
def delete_customer(customer_id: int, db: Session = Depends(get_db), user=Depends(require_permission("customers.delete"))):
    c = get_or_404(Customer, customer_id, db)
    name = c.name
    c.is_active = False
    db.commit()
    log_activity(db, user.id, user.username, "delete", "customer", customer_id, f"Deleted customer '{name}'")
    db.commit()
    broadcast_change("customer", "deleted")
    return {"ok": True}
