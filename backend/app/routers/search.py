from fastapi import APIRouter, Depends, Query
from sqlalchemy import String, cast
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    ASN,
    BOM,
    Category,
    Customer,
    CycleCount,
    Location,
    Lot,
    LPN,
    Order,
    Product,
    QualityCheck,
    Receipt,
    Sale,
    SalesChannel,
    SerialNumber,
    Shipment,
    Supplier,
    User,
    WorkOrder,
)
from app.services.auth import get_current_user

router = APIRouter(prefix="/api/search", tags=["search"], dependencies=[Depends(get_current_user)])


def _search_products(db: Session, like: str, limit: int):
    rows = (
        db.query(Product)
        .filter(Product.parent_id.is_(None), Product.is_deleted == False)  # noqa: E712
        .filter(
            Product.name.ilike(like) | Product.sku.ilike(like) |
            Product.barcode.ilike(like) | Product.description.ilike(like) |
            Product.variants.any(
                Product.name.ilike(like) | Product.sku.ilike(like) |
                Product.barcode.ilike(like) | cast(Product.attributes, String).ilike(like)
            )
        )
        .order_by(Product.name)
        .limit(limit)
        .all()
    )
    out = []
    for p in rows:
        subtitle = f"SKU: {p.sku}"
        if p.category_name:
            subtitle += f" · {p.category_name}"
        if p.is_serialized:
            subtitle += " · Serialized"
        out.append({"type": "product", "id": p.id, "label": p.display_name, "subtitle": subtitle, "route": "/products"})
    return out


def _search_lots(db: Session, like: str, limit: int):
    rows = db.query(Lot).filter(Lot.lot_number.ilike(like)).order_by(Lot.lot_number).limit(limit).all()
    return [
        {"type": "lot", "id": l.id, "label": l.lot_number, "subtitle": l.product_name or "—", "route": "/lots"}
        for l in rows
    ]


def _search_serials(db: Session, like: str, limit: int):
    rows = db.query(SerialNumber).filter(SerialNumber.serial_number.ilike(like)).order_by(SerialNumber.serial_number).limit(limit).all()
    return [
        {
            "type": "serial",
            "id": s.id,
            "label": s.serial_number,
            "subtitle": (s.product_name or "—") + (f" · {s.status}" if s.status else ""),
            "route": "/serial-numbers",
        }
        for s in rows
    ]


def _search_lpns(db: Session, like: str, limit: int):
    rows = db.query(LPN).filter(LPN.lpn_number.ilike(like), LPN.is_deleted == False).order_by(LPN.lpn_number).limit(limit).all()
    return [
        {"type": "lpn", "id": l.id, "label": l.lpn_number, "subtitle": l.location_name or "Unlocated", "route": "/lpns"}
        for l in rows
    ]


def _search_locations(db: Session, like: str, limit: int):
    rows = db.query(Location).filter(Location.name.ilike(like) | Location.code.ilike(like), Location.is_deleted == False).order_by(Location.name).limit(limit).all()
    return [
        {"type": "location", "id": l.id, "label": l.name, "subtitle": l.code or l.location_type or "", "route": "/locations"}
        for l in rows
    ]


def _search_categories(db: Session, like: str, limit: int):
    rows = db.query(Category).filter(Category.name.ilike(like), Category.is_deleted == False).order_by(Category.name).limit(limit).all()
    return [
        {"type": "category", "id": c.id, "label": c.name, "subtitle": c.description or "", "route": "/categories"}
        for c in rows
    ]


def _search_customers(db: Session, like: str, limit: int):
    rows = (
        db.query(Customer)
        .filter(Customer.name.ilike(like) | Customer.email.ilike(like) | Customer.phone.ilike(like), Customer.is_deleted == False)  # noqa: E712
        .order_by(Customer.name)
        .limit(limit)
        .all()
    )
    return [
        {"type": "customer", "id": c.id, "label": c.name, "subtitle": c.email or c.phone or c.customer_type, "route": "/customers"}
        for c in rows
    ]


def _search_suppliers(db: Session, like: str, limit: int):
    rows = (
        db.query(Supplier)
        .filter(
            Supplier.name.ilike(like) | Supplier.email.ilike(like) |
            Supplier.phone.ilike(like) | Supplier.contact_person.ilike(like),
            Supplier.is_deleted == False,  # noqa: E712
        )
        .order_by(Supplier.name)
        .limit(limit)
        .all()
    )
    return [
        {"type": "supplier", "id": s.id, "label": s.name, "subtitle": s.contact_person or s.email or s.phone, "route": "/suppliers"}
        for s in rows
    ]


def _search_users(db: Session, like: str, limit: int):
    rows = db.query(User).filter(User.username.ilike(like) | User.email.ilike(like), User.is_deleted == False).order_by(User.username).limit(limit).all()
    return [
        {"type": "user", "id": u.id, "label": u.username, "subtitle": f"{u.email} · {u.role}", "route": "/users"}
        for u in rows
    ]


def _search_receipts(db: Session, like: str, limit: int):
    rows = (
        db.query(Receipt)
        .filter(Receipt.receipt_number.ilike(like) | Receipt.reference.ilike(like))
        .order_by(Receipt.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {"type": "receipt", "id": r.id, "label": r.receipt_number, "subtitle": r.supplier_name or "—", "route": "/receiving"}
        for r in rows
    ]


def _search_asns(db: Session, like: str, limit: int):
    rows = db.query(ASN).filter(ASN.asn_number.ilike(like)).order_by(ASN.created_at.desc()).limit(limit).all()
    return [
        {"type": "asn", "id": a.id, "label": a.asn_number, "subtitle": a.supplier_name or "—", "route": "/asns"}
        for a in rows
    ]


def _search_orders(db: Session, like: str, limit: int):
    rows = db.query(Order).filter(Order.order_number.ilike(like)).order_by(Order.created_at.desc()).limit(limit).all()
    return [
        {
            "type": "order",
            "id": o.id,
            "label": o.order_number,
            "subtitle": (o.supplier_name or "—") + (f" · {o.status}" if o.status else ""),
            "route": "/orders",
        }
        for o in rows
    ]


def _search_sales(db: Session, like: str, limit: int):
    rows = db.query(Sale).filter(Sale.invoice_number.ilike(like)).order_by(Sale.created_at.desc()).limit(limit).all()
    return [
        {"type": "sale", "id": s.id, "label": s.invoice_number, "subtitle": s.customer_name, "route": "/sales"}
        for s in rows
    ]


def _search_shipments(db: Session, like: str, limit: int):
    rows = (
        db.query(Shipment)
        .filter(
            Shipment.shipment_number.ilike(like) | Shipment.tracking_number.ilike(like) | Shipment.carrier.ilike(like)
        )
        .order_by(Shipment.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "type": "shipment",
            "id": s.id,
            "label": s.shipment_number,
            "subtitle": (s.customer_name or "—") + (f" · {s.status}" if s.status else ""),
            "route": "/shipments",
        }
        for s in rows
    ]


def _search_work_orders(db: Session, like: str, limit: int):
    rows = db.query(WorkOrder).filter(WorkOrder.wo_number.ilike(like)).order_by(WorkOrder.created_at.desc()).limit(limit).all()
    return [
        {
            "type": "work_order",
            "id": w.id,
            "label": w.wo_number,
            "subtitle": (w.product_name or "—") + (f" · {w.status}" if w.status else ""),
            "route": "/work-orders",
        }
        for w in rows
    ]


def _search_cycle_counts(db: Session, like: str, limit: int):
    rows = db.query(CycleCount).filter(CycleCount.cc_number.ilike(like)).order_by(CycleCount.created_at.desc()).limit(limit).all()
    return [
        {
            "type": "cycle_count",
            "id": c.id,
            "label": c.cc_number,
            "subtitle": (c.location_name or "All") + (f" · {c.status}" if c.status else ""),
            "route": "/cycle-counts",
        }
        for c in rows
    ]


def _search_quality_checks(db: Session, like: str, limit: int):
    rows = db.query(QualityCheck).filter(QualityCheck.qc_number.ilike(like), QualityCheck.is_deleted == False).order_by(QualityCheck.created_at.desc()).limit(limit).all()
    return [
        {
            "type": "quality_check",
            "id": q.id,
            "label": q.qc_number,
            "subtitle": (q.product_name or "—") + (f" · {q.result}" if q.result else ""),
            "route": "/quality-checks",
        }
        for q in rows
    ]


def _search_boms(db: Session, like: str, limit: int):
    rows = db.query(BOM).filter(BOM.name.ilike(like), BOM.is_deleted == False).order_by(BOM.name).limit(limit).all()
    return [
        {"type": "bom", "id": b.id, "label": b.name or b.product_name, "subtitle": b.product_name, "route": "/boms"}
        for b in rows
    ]


def _search_sales_channels(db: Session, like: str, limit: int):
    rows = db.query(SalesChannel).filter(SalesChannel.name.ilike(like), SalesChannel.is_deleted == False).order_by(SalesChannel.name).limit(limit).all()
    return [
        {"type": "sales_channel", "id": c.id, "label": c.name, "subtitle": c.type, "route": "/sales-channels"}
        for c in rows
    ]


PROVIDERS = [
    (_search_products, "products.view"),
    (_search_lots, "lots.view"),
    (_search_serials, "serial_numbers.view"),
    (_search_lpns, "lpns.view"),
    (_search_locations, "locations.view"),
    (_search_categories, "categories.view"),
    (_search_customers, "customers.view"),
    (_search_suppliers, "suppliers.view"),
    (_search_users, "users.view"),
    (_search_receipts, "receipts.view"),
    (_search_asns, "asns.view"),
    (_search_orders, "orders.view"),
    (_search_sales, "sales.view"),
    (_search_shipments, "shipments.view"),
    (_search_work_orders, "work_orders.view"),
    (_search_cycle_counts, "cycle_counts.view"),
    (_search_quality_checks, "quality_checks.view"),
    (_search_boms, "bom.view"),
    (_search_sales_channels, "sales.view"),
]


@router.get("")
def global_search(
    q: str = Query("", max_length=100),
    per_type: int = Query(5, ge=1, le=20),
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from app.services.permissions import has_permission

    query = q.strip()
    if not query:
        return {"query": q, "total": 0, "results": []}
    like = f"%{query}%"
    results = []
    for provider, perm in PROVIDERS:
        if not has_permission(user.role, perm):
            continue
        results.extend(provider(db, like, per_type))
    return {"query": query, "total": len(results), "results": results}
