from io import StringIO
import csv
from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload
from app.constants import MAX_PAGE_SIZE_PICKER
from app.database import get_db
from app.models.order import Order
from app.models.product import Product
from app.models.stock_line import StockLine
from app.models.supplier import Supplier
from app.routers.products import _effective_location
from app.schemas.product import ProductOut
from app.schemas.supplier import (
    SupplierBulkEdit, SupplierCreate, SupplierImportResult, SupplierListItem, SupplierOut,
    SupplierStats, SupplierUpdate,
)
from app.services.auth import require_permission
from app.services.soft_delete import register, soft_delete
from app.utils import get_or_404, log_activity, broadcast_change

router = APIRouter(prefix="/api/suppliers", tags=["suppliers"], dependencies=[Depends(require_permission("suppliers.view"))])


def _purge_supplier(db: Session, s: Supplier, user) -> None:
    has_products = db.query(Product).filter(Product.supplier_id == s.id).first() is not None
    if has_products:
        raise HTTPException(status_code=400, detail="Cannot permanently delete a supplier that has products")
    has_orders = db.query(Order).filter(Order.supplier_id == s.id).first() is not None
    if has_orders:
        raise HTTPException(status_code=400, detail="Cannot permanently delete a supplier with order history")
    db.delete(s)


register("supplier", Supplier, lambda s: s.name, _purge_supplier)


def _find_duplicate(db: Session, name: str, email: str, exclude_id: int | None = None) -> Supplier | None:
    conds = []
    if name.strip():
        conds.append(Supplier.name == name.strip())
    if email.strip():
        conds.append(Supplier.email == email.strip())
    if not conds:
        return None
    q = db.query(Supplier).filter(Supplier.is_active == True, or_(*conds))  # noqa: E712
    if exclude_id:
        q = q.filter(Supplier.id != exclude_id)
    return q.first()
def _stats_query(db: Session):
    return (
        db.query(
            Order.supplier_id.label("supplier_id"),
            func.count(Order.id).label("total_orders"),
            func.coalesce(func.sum(Order.total_amount), 0).label("total_spent"),
            func.max(Order.created_at).label("last_order_at"),
        )
        .filter(Order.status == "received", Order.supplier_id.isnot(None))
        .group_by(Order.supplier_id)
        .subquery()
    )


def _product_count_query(db: Session):
    return (
        db.query(
            Product.supplier_id.label("supplier_id"),
            func.count(Product.id).label("product_count"),
        )
        .filter(Product.supplier_id.isnot(None), Product.parent_id.is_(None))
        .group_by(Product.supplier_id)
        .subquery()
    )


def _serialize_with_stats(s: Supplier, total_orders, total_spent, last_order_at, product_count) -> SupplierListItem:
    total_orders = total_orders or 0
    total_spent = float(total_spent or 0)
    return SupplierListItem(
        **SupplierOut.model_validate(s).model_dump(),
        total_orders=total_orders,
        total_spent=total_spent,
        avg_order_value=round(total_spent / total_orders, 2) if total_orders else 0.0,
        last_order_at=last_order_at,
        product_count=product_count or 0,
    )


@router.get("")
def list_suppliers(
    search: str = Query(""),
    include_inactive: bool = False,
    category_id: int | None = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=MAX_PAGE_SIZE_PICKER),
    db: Session = Depends(get_db),
):
    stats = _stats_query(db)
    counts = _product_count_query(db)
    q = db.query(
        Supplier, stats.c.total_orders, stats.c.total_spent, stats.c.last_order_at,
        counts.c.product_count,
    ).outerjoin(stats, stats.c.supplier_id == Supplier.id).outerjoin(counts, counts.c.supplier_id == Supplier.id).filter(Supplier.is_deleted == False)  # noqa: E712
    if not include_inactive:
        q = q.filter(Supplier.is_active == True)  # noqa: E712
    if search:
        like = f"%{search}%"
        q = q.filter(Supplier.name.ilike(like) | Supplier.contact_person.ilike(like) | Supplier.email.ilike(like))
    if category_id:
        q = q.filter(
            Supplier.id.in_(
                select(Product.supplier_id)
                .where(Product.supplier_id.isnot(None), Product.category_id == category_id)
            )
        )
    total = q.count()
    rows = q.order_by(Supplier.name).offset(skip).limit(limit).all()
    items = [_serialize_with_stats(s, to, ts, lo, pc) for s, to, ts, lo, pc in rows]
    return {"items": items, "total": total, "page": (skip // limit) + 1, "pages": max(ceil(total / limit), 1)}


@router.patch("/bulk-edit")
def bulk_edit_suppliers(data: SupplierBulkEdit, db: Session = Depends(get_db), user=Depends(require_permission("suppliers.bulk"))):
    suppliers = db.query(Supplier).filter(Supplier.id.in_(data.ids)).all()
    if not suppliers:
        raise HTTPException(status_code=404, detail="No suppliers found")
    updates = data.model_dump(exclude_unset=True)
    updates.pop("ids", None)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    if "email" in updates and updates["email"].strip():
        dup = db.query(Supplier).filter(
            Supplier.is_active == True,  # noqa: E712
            Supplier.email == updates["email"].strip(),
            Supplier.id.notin_(data.ids),
        ).first()
        if dup:
            raise HTTPException(status_code=400, detail="Duplicate supplier: another supplier already uses the same email")
    for s in suppliers:
        for k, v in updates.items():
            setattr(s, k, v)
    db.commit()
    log_activity(db, user.id, user.username, "update", "supplier", None,
                 f"Bulk-edited {len(suppliers)} supplier(s): {', '.join(f'{k}={v}' for k, v in updates.items())}")
    db.commit()
    broadcast_change("supplier", "updated")
    return {"updated": len(suppliers), "fields": list(updates.keys())}


@router.post("/import", response_model=SupplierImportResult)
def import_suppliers_csv(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user=Depends(require_permission("suppliers.import")),
):
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a CSV")
    content = file.file.read().decode("utf-8-sig")
    reader = csv.DictReader(StringIO(content))
    result = SupplierImportResult()
    seen = set()
    for row_idx, row in enumerate(reader, start=2):
        name = (row.get("name") or "").strip()
        if not name:
            result.errors.append(f"Row {row_idx}: missing required field 'name'")
            continue
        email = (row.get("email") or "").strip()
        key = (name.lower(), email.lower())
        if key in seen:
            result.skipped += 1
            continue
        if _find_duplicate(db, name, email):
            result.skipped += 1
            continue
        db.add(Supplier(
            name=name,
            contact_person=(row.get("contact_person") or "").strip(),
            email=email,
            phone=(row.get("phone") or "").strip(),
            address=(row.get("address") or "").strip(),
            notes=(row.get("notes") or "").strip(),
        ))
        seen.add(key)
        log_activity(db, user.id, user.username, "create", "supplier", None, f"Imported supplier '{name}'")
        result.created += 1
    db.commit()
    if result.created:
        broadcast_change("supplier", "created")
    return result


@router.get("/{supplier_id}/stats", response_model=SupplierStats)
def supplier_stats(supplier_id: int, db: Session = Depends(get_db)):
    get_or_404(Supplier, supplier_id, db)
    row = db.query(
        func.count(Order.id),
        func.coalesce(func.sum(Order.total_amount), 0),
        func.max(Order.created_at),
    ).filter(Order.supplier_id == supplier_id, Order.status == "received").first()
    total_orders = row[0] or 0
    total_spent = float(row[1] or 0)
    product_count = db.query(func.count(Product.id)).filter(
        Product.supplier_id == supplier_id, Product.parent_id.is_(None)
    ).scalar() or 0
    return SupplierStats(
        total_orders=total_orders,
        total_spent=total_spent,
        avg_order_value=round(total_spent / total_orders, 2) if total_orders else 0.0,
        last_order_at=row[2],
        product_count=product_count,
    )


@router.get("/{supplier_id}/products")
def supplier_products(
    supplier_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    get_or_404(Supplier, supplier_id, db)
    options = [
        joinedload(Product.category),
        joinedload(Product.supplier),
        joinedload(Product.default_location),
        joinedload(Product.stock_lines).joinedload(StockLine.location),
        joinedload(Product.variants).joinedload(Product.stock_lines).joinedload(StockLine.location),
    ]
    q = db.query(Product).options(*options).filter(Product.parent_id.is_(None))
    q = q.filter((Product.supplier_id == supplier_id) | Product.variants.any(Product.supplier_id == supplier_id))
    total = q.count()
    items = q.order_by(Product.name).offset(skip).limit(limit).all()
    results = []
    for p in items:
        out = ProductOut.model_validate(p)
        out.location = _effective_location(p)
        if p.variants and out.variants:
            for v_orm, v_out in zip(p.variants, out.variants):
                v_out.location = _effective_location(v_orm)
        results.append(out)
    return {"items": results, "total": total, "page": (skip // limit) + 1, "pages": max(ceil(total / limit), 1)}


@router.post("/{supplier_id}/restore", response_model=SupplierOut)
def restore_supplier(supplier_id: int, db: Session = Depends(get_db), user=Depends(require_permission("suppliers.update"))):
    s = get_or_404(Supplier, supplier_id, db, include_deleted=True)
    s.is_active = True
    s.is_deleted = False
    s.deleted_at = None
    db.commit()
    db.refresh(s)
    log_activity(db, user.id, user.username, "update", "supplier", s.id, f"Restored supplier '{s.name}'")
    db.commit()
    broadcast_change("supplier", "updated")
    return s


@router.get("/{supplier_id}", response_model=SupplierOut)
def get_supplier(supplier_id: int, include_inactive: bool = False, db: Session = Depends(get_db)):
    return get_or_404(Supplier, supplier_id, db, include_deleted=include_inactive)


@router.post("", response_model=SupplierOut, status_code=201)
def create_supplier(data: SupplierCreate, db: Session = Depends(get_db), user=Depends(require_permission("suppliers.create"))):
    dup = _find_duplicate(db, data.name, data.email)
    if dup:
        raise HTTPException(status_code=400, detail=f"Duplicate supplier: '{dup.name}' already uses the same name or email")
    s = Supplier(**data.model_dump())
    db.add(s)
    db.commit()
    db.refresh(s)
    log_activity(db, user.id, user.username, "create", "supplier", s.id, f"Created supplier '{s.name}'")
    db.commit()
    broadcast_change("supplier", "created")
    return s


@router.put("/{supplier_id}", response_model=SupplierOut)
def update_supplier(supplier_id: int, data: SupplierUpdate, db: Session = Depends(get_db), user=Depends(require_permission("suppliers.update"))):
    s = get_or_404(Supplier, supplier_id, db)
    updates = data.model_dump(exclude_unset=True)
    dup = _find_duplicate(
        db,
        updates.get("name", s.name),
        updates.get("email", s.email),
        exclude_id=s.id,
    )
    if dup:
        raise HTTPException(status_code=400, detail=f"Duplicate supplier: '{dup.name}' already uses the same name or email")
    for k, v in updates.items():
        setattr(s, k, v)
    db.commit()
    db.refresh(s)
    log_activity(db, user.id, user.username, "update", "supplier", s.id, f"Updated supplier '{s.name}'")
    db.commit()
    broadcast_change("supplier", "updated")
    return s


@router.delete("/{supplier_id}")
def delete_supplier(supplier_id: int, db: Session = Depends(get_db), user=Depends(require_permission("suppliers.delete"))):
    s = get_or_404(Supplier, supplier_id, db)
    soft_delete(db, s, user, "supplier")
    return {"ok": True}
