from datetime import date, datetime, timedelta, timezone
from io import StringIO
import csv

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models.product import Product
from app.models.category import Category
from app.models.supplier import Supplier
from app.models.stock_movement import StockMovement
from app.models.order import Order, OrderItem
from app.models.sale import Sale, SaleItem
from app.models.lot import Lot
from app.models.asn import ASN, ASNItem
from app.models.cycle_count import CycleCount, CycleCountItem
from app.models.stock_line import StockLine
from app.models.customer import Customer
from app.models.settings import Settings
from app.services.auth import get_current_user
from app.services.inventory import SHIP, TRANSFER_OUT, quarantined_qty_by_product, quarantined_qty_subquery
from app.services.pdf_helpers import (
    MARGIN,
    draw_header,
    draw_info_block,
    draw_item_table,
    draw_signoff,
    new_canvas,
    render_pdf,
)

router = APIRouter(prefix="/api/reports", tags=["reports"], dependencies=[Depends(get_current_user)])


def parse_range(start_date: str | None, end_date: str | None) -> tuple[datetime | None, datetime | None]:
    start = None
    end = None
    try:
        if start_date:
            start = datetime.fromisoformat(start_date)
        if end_date:
            end = datetime.fromisoformat(end_date).replace(hour=23, minute=59, second=59, microsecond=999999)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format (expected ISO 8601, e.g. 2026-07-01)")
    return start, end


@router.get("/inventory-valuation")
def inventory_valuation(db: Session = Depends(get_db)):
    sellable = Product.quantity - func.coalesce(quarantined_qty_subquery(), 0)
    total_value = db.query(func.coalesce(func.sum(sellable * Product.cost_price), 0)).filter(
        Product.is_active == True
    ).scalar() or 0.0

    total_retail = db.query(func.coalesce(func.sum(sellable * Product.unit_price), 0)).filter(
        Product.is_active == True
    ).scalar() or 0.0

    cat_sums = (
        db.query(
            Category.name,
            func.coalesce(func.sum(sellable), 0),
            func.coalesce(func.sum(sellable * Product.cost_price), 0),
        )
        .outerjoin(Category.products)
        .filter(Product.is_active == True)
        .group_by(Category.name)
        .all()
    )
    cat_counts = (
        db.query(Category.name, func.count(Product.id))
        .outerjoin(Category.products)
        .filter(Product.is_active == True, Product.parent_id.is_(None))
        .group_by(Category.name)
        .all()
    )
    cat_count_map = {name: cnt for name, cnt in cat_counts}

    sup_sums = (
        db.query(
            Supplier.name,
            func.coalesce(func.sum(sellable), 0),
            func.coalesce(func.sum(sellable * Product.cost_price), 0),
        )
        .outerjoin(Supplier.products)
        .filter(Product.is_active == True)
        .group_by(Supplier.name)
        .all()
    )
    sup_counts = (
        db.query(Supplier.name, func.count(Product.id))
        .outerjoin(Supplier.products)
        .filter(Product.is_active == True, Product.parent_id.is_(None))
        .group_by(Supplier.name)
        .all()
    )
    sup_count_map = {name: cnt for name, cnt in sup_counts}

    return {
        "total_inventory_value": float(total_value),
        "total_retail_value": float(total_retail),
        "potential_profit": float(total_retail) - float(total_value),
        "by_category": [{"category": r[0] or "Uncategorized", "product_count": cat_count_map.get(r[0], 0), "total_stock": int(r[1]), "total_value": float(r[2])} for r in cat_sums],
        "by_supplier": [{"supplier": r[0] or "Unassigned", "product_count": sup_count_map.get(r[0], 0), "total_stock": int(r[1]), "total_value": float(r[2])} for r in sup_sums],
    }


@router.get("/stock-movement-trends")
def stock_movement_trends(days: int = 30, start_date: str | None = None, end_date: str | None = None, db: Session = Depends(get_db)):
    start, end = parse_range(start_date, end_date)
    since = start if start else (datetime.now(timezone.utc) - timedelta(days=days))
    q = db.query(
        func.date(StockMovement.created_at).label("date"),
        StockMovement.quantity_change,
    ).filter(
        StockMovement.created_at >= since,
        StockMovement.movement_type != TRANSFER_OUT,  # count each transfer pair once
    )
    if end:
        q = q.filter(StockMovement.created_at <= end)
    daily = q.order_by(func.date(StockMovement.created_at)).all()

    total_in = 0
    total_out = 0
    trend_data: dict = {}
    for date_str, qty in daily:
        if date_str not in trend_data:
            trend_data[date_str] = {"date": date_str, "in": 0, "out": 0}
        if qty > 0:
            trend_data[date_str]["in"] += int(qty)
            total_in += int(qty)
        else:
            trend_data[date_str]["out"] += int(abs(qty))
            total_out += int(abs(qty))

    return {
        "total_in": total_in,
        "total_out": total_out,
        "net_movement": total_in - total_out,
        "daily_trends": sorted(trend_data.values(), key=lambda x: x["date"]),
    }


@router.get("/category-breakdown")
def category_breakdown(db: Session = Depends(get_db)):
    sums = (
        db.query(
            Category.id,
            Category.name,
            func.coalesce(func.sum(Product.quantity), 0),
            func.coalesce(func.sum(Product.quantity * Product.cost_price), 0),
            func.coalesce(func.sum(Product.quantity * Product.unit_price), 0),
        )
        .outerjoin(Category.products)
        .filter(Product.is_active == True)
        .group_by(Category.id, Category.name)
        .order_by(Category.name)
        .all()
    )
    counts = (
        db.query(Category.id, func.count(Product.id))
        .outerjoin(Category.products)
        .filter(Product.is_active == True, Product.parent_id.is_(None))
        .group_by(Category.id)
        .all()
    )
    count_map = {cid: cnt for cid, cnt in counts}

    return [{
        "id": r[0],
        "name": r[1] or "Uncategorized",
        "product_count": count_map.get(r[0], 0),
        "total_stock": int(r[2]),
        "total_cost_value": float(r[3]),
        "total_retail_value": float(r[4]),
    } for r in sums]


@router.get("/profit-analysis")
def profit_analysis(db: Session = Depends(get_db)):
    products = db.query(Product).options(
        joinedload(Product.category), joinedload(Product.supplier)
    ).filter(
        Product.is_active == True,
        Product.id.notin_(Product.variant_parent_id_subquery()),
    ).order_by(Product.name).all()

    analysis = []
    total_cost = 0.0
    total_potential_revenue = 0.0
    for p in products:
        cost = float(p.cost_price) * p.quantity
        rev = float(p.unit_price) * p.quantity
        margin = float(p.unit_price) - float(p.cost_price) if p.cost_price else 0
        margin_pct = (margin / float(p.cost_price) * 100) if p.cost_price and float(p.cost_price) > 0 else 0
        analysis.append({
            "id": p.id,
            "name": p.display_name,
            "sku": p.sku,
            "category": p.category_name,
            "supplier": p.supplier_name,
            "quantity": p.quantity,
            "unit_cost": float(p.cost_price),
            "unit_price": float(p.unit_price),
            "unit_margin": round(margin, 2),
            "margin_percentage": round(margin_pct, 1),
            "total_cost": round(cost, 2),
            "total_revenue": round(rev, 2),
            "total_profit": round(rev - cost, 2),
        })
        total_cost += cost
        total_potential_revenue += rev

    return {
        "total_cost_value": round(total_cost, 2),
        "total_potential_revenue": round(total_potential_revenue, 2),
        "total_potential_profit": round(total_potential_revenue - total_cost, 2),
        "product_count": len(analysis),
        "products": analysis,
    }


@router.get("/order-summary")
def order_summary(db: Session = Depends(get_db)):
    by_status = (
        db.query(Order.status, func.count(Order.id), func.coalesce(func.sum(Order.total_amount), 0))
        .group_by(Order.status)
        .all()
    )

    total_orders = sum(r[1] for r in by_status)
    total_order_value = sum(float(r[2]) for r in by_status)

    top_suppliers = (
        db.query(
            Supplier.name,
            func.count(Order.id),
            func.coalesce(func.sum(Order.total_amount), 0),
        )
        .join(Supplier.orders)
        .group_by(Supplier.name)
        .order_by(func.coalesce(func.sum(Order.total_amount), 0).desc())
        .limit(10)
        .all()
    )

    return {
        "total_orders": total_orders,
        "total_order_value": round(total_order_value, 2),
        "by_status": [{"status": r[0], "count": r[1], "total_value": float(r[2])} for r in by_status],
        "top_suppliers": [{"supplier": r[0], "order_count": r[1], "total_value": float(r[2])} for r in top_suppliers],
    }


@router.get("/sales-summary")
def sales_summary(start_date: str | None = None, end_date: str | None = None, db: Session = Depends(get_db)):
    start, end = parse_range(start_date, end_date)
    q = db.query(Sale)
    if start:
        q = q.filter(Sale.created_at >= start)
    if end:
        q = q.filter(Sale.created_at <= end)
    sales = q.order_by(Sale.created_at.desc()).all()

    total_revenue = sum(float(s.total_amount) for s in sales if s.status != "refunded")
    total_tax = sum(float(s.tax_amount) for s in sales if s.status != "refunded")
    completed = [s for s in sales if s.status == "completed"]
    refunded = sum(1 for s in sales if s.status == "refunded")

    by_payment: dict[str, int] = {}
    for s in completed:
        by_payment[s.payment_method or "unknown"] = by_payment.get(s.payment_method or "unknown", 0) + 1

    item_rows = (
        db.query(
            Product.name,
            func.sum(SaleItem.quantity),
            func.sum(SaleItem.quantity * SaleItem.unit_price),
        )
        .join(SaleItem.product)
        .join(SaleItem.sale)
        .filter(Sale.status == "completed")
    )
    if start:
        item_rows = item_rows.filter(Sale.created_at >= start)
    if end:
        item_rows = item_rows.filter(Sale.created_at <= end)
    item_rows = item_rows.group_by(Product.id, Product.name).order_by(
        func.sum(SaleItem.quantity * SaleItem.unit_price).desc()
    ).limit(15).all()

    return {
        "total_sales": len(completed),
        "total_refunds": refunded,
        "total_revenue": round(total_revenue, 2),
        "total_tax": round(total_tax, 2),
        "by_payment_method": [{"method": k, "count": v} for k, v in by_payment.items()],
        "top_products": [{"name": r[0], "quantity_sold": int(r[1] or 0), "revenue": float(r[2] or 0)} for r in item_rows],
    }


def _csv_response(filename: str, headers: list[str], rows: list[list]) -> Response:
    buf = StringIO()
    writer = csv.writer(buf)
    writer.writerow(headers)
    writer.writerows(rows)
    return Response(
        buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={filename}.csv"},
    )


@router.get("/export/sales")
def export_sales(search: str = Query(""), start_date: str | None = None, end_date: str | None = None, db: Session = Depends(get_db)):
    start, end = parse_range(start_date, end_date)
    q = db.query(Sale).options(joinedload(Sale.customer))
    if search:
        q = q.filter(Sale.invoice_number.ilike(f"%{search}%"))
    if start:
        q = q.filter(Sale.created_at >= start)
    if end:
        q = q.filter(Sale.created_at <= end)
    sales = q.order_by(Sale.created_at.desc()).all()
    return _csv_response(
        "sales_report",
        ["Invoice", "Date", "Customer", "Subtotal", "Tax", "Total", "Payment", "Status", "Created By"],
        [[s.invoice_number, s.created_at.strftime("%Y-%m-%d %H:%M"), s.customer_name or "", s.subtotal, s.tax_amount, s.total_amount, s.payment_method or "", s.status, s.username] for s in sales],
    )


@router.get("/export/movements")
def export_movements(start_date: str | None = None, end_date: str | None = None, db: Session = Depends(get_db)):
    start, end = parse_range(start_date, end_date)
    q = db.query(StockMovement).options(joinedload(StockMovement.product))
    if start:
        q = q.filter(StockMovement.created_at >= start)
    if end:
        q = q.filter(StockMovement.created_at <= end)
    rows = q.order_by(StockMovement.created_at.desc()).limit(5000).all()
    return _csv_response(
        "stock_movements_report",
        ["Date", "Product", "Type", "Quantity Change", "Reference", "Notes"],
        [[m.created_at.strftime("%Y-%m-%d %H:%M"), m.product_name, m.movement_type, m.quantity_change, m.reference or "", m.notes or ""] for m in rows],
    )


@router.get("/exceptions")
def exception_dashboard(db: Session = Depends(get_db)):
    active_parents = Product.variant_parent_id_subquery()
    sellable = (Product.is_active == True, Product.id.notin_(active_parents))
    sellable_qty = Product.quantity - func.coalesce(quarantined_qty_subquery(), 0)

    low_stock_rows = db.query(Product).options(
        joinedload(Product.category), joinedload(Product.supplier)
    ).filter(*sellable, sellable_qty <= Product.reorder_level).order_by(Product.quantity.asc()).limit(100).all()
    low_stock = [{
        "id": p.id, "name": p.display_name, "sku": p.sku, "quantity": p.quantity,
        "reorder_level": p.reorder_level, "category": p.category_name, "supplier": p.supplier_name,
    } for p in low_stock_rows]

    zero_stock_rows = db.query(Product).filter(*sellable, sellable_qty <= 0).order_by(Product.name).limit(100).all()
    zero_stock = [{"id": p.id, "name": p.display_name, "sku": p.sku} for p in zero_stock_rows]

    quarantined = db.query(Lot).options(joinedload(Lot.product)).filter(
        Lot.status == "quarantined"
    ).order_by(Lot.received_date.desc()).limit(100).all()
    quarantined_lots = [{
        "id": l.id, "lot_number": l.lot_number, "product_name": l.product_name,
        "product_id": l.product_id, "on_hand": sum(sl.quantity for sl in l.stock_lines),
        "expiry_date": l.expiry_date, "received_date": l.received_date,
    } for l in quarantined]

    open_counts = db.query(CycleCount).options(
        joinedload(CycleCount.items), joinedload(CycleCount.location)
    ).filter(CycleCount.status.in_(["pending", "in_progress"])).order_by(CycleCount.created_at.desc()).limit(100).all()
    open_cycle_counts = [{
        "id": c.id, "cc_number": c.cc_number, "status": c.status,
        "location": c.location_name, "has_variance": c.has_variance,
        "total_expected": c.total_expected, "total_variance": c.total_variance,
        "created_at": c.created_at,
    } for c in open_counts]

    pending_asns = db.query(ASN).options(
        joinedload(ASN.items), joinedload(ASN.supplier)
    ).filter(ASN.status == "pending").order_by(ASN.expected_arrival.asc().nulls_last()).limit(100).all()
    pending_asn_rows = [{
        "id": a.id, "asn_number": a.asn_number, "supplier": a.supplier_name,
        "expected_arrival": a.expected_arrival,
        "items_pending": sum(max(0, i.expected_qty - i.received_qty) for i in a.items),
        "created_at": a.created_at,
    } for a in pending_asns]

    return {
        "low_stock": low_stock,
        "zero_stock": zero_stock,
        "quarantined_lots": quarantined_lots,
        "open_cycle_counts": open_cycle_counts,
        "pending_asns": pending_asn_rows,
        "summary": {
            "low_stock": len(low_stock),
            "zero_stock": len(zero_stock),
            "quarantined_lots": len(quarantined_lots),
            "open_cycle_counts": len(open_cycle_counts),
            "pending_asns": len(pending_asn_rows),
        },
    }


def _avg_daily_demand(db: Session, product_id: int, days: int = 90) -> float:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    out_qty = db.query(func.coalesce(func.sum(func.abs(StockMovement.quantity_change)), 0)).filter(
        StockMovement.product_id == product_id,
        StockMovement.created_at >= since,
        StockMovement.quantity_change < 0,
        StockMovement.movement_type.in_(["sale", "out", SHIP]),
    ).scalar() or 0
    return float(out_qty) / days


@router.get("/inventory-aging")
def inventory_aging(db: Session = Depends(get_db)):
    lots = db.query(Lot).options(joinedload(Lot.product)).order_by(Lot.received_date.desc()).all()
    result = []
    for lot in lots:
        on_hand = sum(sl.quantity for sl in lot.stock_lines)
        if on_hand <= 0:
            continue
        last = db.query(func.max(StockMovement.created_at)).filter(
            StockMovement.lot_id == lot.id
        ).scalar()
        age_ref = last or datetime.combine(lot.received_date, datetime.min.time())
        age_days = max((datetime.now(timezone.utc) - age_ref).days, 0)
        daily_out = _avg_daily_demand(db, lot.product_id)
        days_of_stock = round(on_hand / daily_out, 1) if daily_out > 0 else None
        result.append({
            "lot_id": lot.id,
            "product_id": lot.product_id,
            "product_name": lot.product_name,
            "lot_number": lot.lot_number,
            "status": lot.status,
            "expiry_date": lot.expiry_date,
            "received_date": lot.received_date,
            "last_movement_at": last,
            "age_days": age_days,
            "on_hand": on_hand,
            "avg_daily_demand": round(daily_out, 2),
            "days_of_stock": days_of_stock,
        })
    result.sort(key=lambda r: r["age_days"], reverse=True)
    return {"items": result, "total": len(result)}


@router.get("/stockout-risk")
def stockout_risk(lead_time_days: int = 7, db: Session = Depends(get_db)):
    items, summary = _stockout_risk_data(db, lead_time_days)
    return {"items": items, "summary": summary}


def _stockout_risk_data(db: Session, lead_time_days: int = 7) -> tuple[list[dict], dict]:
    active_parents = Product.variant_parent_id_subquery()
    products = db.query(Product).options(
        joinedload(Product.category), joinedload(Product.supplier)
    ).filter(Product.is_active == True, Product.id.notin_(active_parents)).all()
    quarantined = quarantined_qty_by_product(db)

    items = []
    for p in products:
        demand = _avg_daily_demand(db, p.id)
        on_hand = max(0, p.quantity - quarantined.get(p.id, 0))
        days_of_supply = round(on_hand / demand, 1) if demand > 0 else None
        if demand <= 0:
            risk_level = "low"
            risk_score = 0
        elif days_of_supply is None or days_of_supply < lead_time_days:
            risk_level = "high"
            risk_score = 100
        elif days_of_supply < lead_time_days * 2:
            risk_level = "medium"
            risk_score = 60
        else:
            risk_level = "low"
            risk_score = 20
        if on_hand <= 0 and demand > 0:
            risk_level = "high"
            risk_score = 100
        suggested_reorder = round(demand * lead_time_days) if demand > 0 else 0
        items.append({
            "product_id": p.id,
            "product_name": p.display_name,
            "sku": p.sku,
            "category": p.category_name,
            "supplier": p.supplier_name,
            "on_hand": on_hand,
            "reorder_level": p.reorder_level,
            "avg_daily_demand": round(demand, 2),
            "lead_time_days": lead_time_days,
            "days_of_supply": days_of_supply,
            "suggested_reorder": suggested_reorder,
            "risk_score": risk_score,
            "risk_level": risk_level,
        })
    order = {"high": 0, "medium": 1, "low": 2}
    items.sort(key=lambda i: (order[i["risk_level"]], i["risk_score"]), reverse=True)
    summary = {
        "high": sum(1 for i in items if i["risk_level"] == "high"),
        "medium": sum(1 for i in items if i["risk_level"] == "medium"),
        "low": sum(1 for i in items if i["risk_level"] == "low"),
    }
    return items, summary


@router.get("/top-customers")
def top_customers(limit: int = Query(10, ge=1, le=100), days: int | None = Query(None, ge=1), db: Session = Depends(get_db)):
    since = None
    if days:
        since = datetime.now(timezone.utc) - timedelta(days=days)
    q = (
        db.query(
            Customer.id,
            Customer.name,
            Customer.phone,
            Customer.email,
            func.count(Sale.id).label("total_sales"),
            func.coalesce(func.sum(Sale.total_amount), 0).label("total_spent"),
            func.max(Sale.created_at).label("last_purchase_at"),
        )
        .join(Sale, Sale.customer_id == Customer.id)
        .filter(Sale.status == "completed")
    )
    if since:
        q = q.filter(Sale.created_at >= since)
    rows = (
        q.group_by(Customer.id, Customer.name, Customer.phone, Customer.email)
        .order_by(func.sum(Sale.total_amount).desc())
        .limit(limit)
        .all()
    )
    items = [{
        "customer_id": r[0],
        "name": r[1],
        "phone": r[2],
        "email": r[3],
        "total_sales": r[4] or 0,
        "total_spent": round(float(r[5] or 0), 2),
        "last_purchase_at": r[6],
    } for r in rows]
    return {"items": items, "total": len(items), "days": days}


@router.get("/top-suppliers")
def top_suppliers(limit: int = Query(10, ge=1, le=100), days: int | None = Query(None, ge=1), db: Session = Depends(get_db)):
    since = None
    if days:
        since = datetime.now(timezone.utc) - timedelta(days=days)
    q = (
        db.query(
            Supplier.id,
            Supplier.name,
            Supplier.contact_person,
            Supplier.email,
            func.count(Order.id).label("total_orders"),
            func.coalesce(func.sum(Order.total_amount), 0).label("total_spent"),
            func.max(Order.created_at).label("last_order_at"),
        )
        .join(Order, Order.supplier_id == Supplier.id)
        .filter(Order.status == "received")
    )
    if since:
        q = q.filter(Order.created_at >= since)
    rows = (
        q.group_by(Supplier.id, Supplier.name, Supplier.contact_person, Supplier.email)
        .order_by(func.sum(Order.total_amount).desc())
        .limit(limit)
        .all()
    )
    items = [{
        "supplier_id": r[0],
        "name": r[1],
        "contact_person": r[2],
        "email": r[3],
        "total_orders": r[4] or 0,
        "total_spent": round(float(r[5] or 0), 2),
        "last_order_at": r[6],
    } for r in rows]
    return {"items": items, "total": len(items), "days": days}


@router.get("/export/products")
def export_products(
    search: str = "",
    category_id: int | None = None,
    expiry: str = "",
    low_stock: bool = False,
    db: Session = Depends(get_db),
):
    q = db.query(Product).options(
        joinedload(Product.category), joinedload(Product.supplier)
    )
    if search:
        like = f"%{search}%"
        q = q.filter(Product.name.ilike(like) | Product.sku.ilike(like))
    if category_id:
        q = q.filter(Product.category_id == category_id)
    today = date.today()
    if expiry == "expired":
        q = q.filter(Product.expiry_date.isnot(None), Product.expiry_date < today)
    elif expiry == "expiring":
        soon = today + timedelta(days=30)
        q = q.filter(Product.expiry_date.isnot(None), Product.expiry_date >= today, Product.expiry_date <= soon)
    if low_stock:
        sellable = Product.quantity - func.coalesce(quarantined_qty_subquery(), 0)
        q = q.filter(Product.is_active == True, Product.id.notin_(Product.variant_parent_id_subquery()), sellable <= Product.reorder_level)  # noqa: E712
    products = q.order_by(Product.name).all()
    return _csv_response(
        "products_report",
        ["SKU", "Name", "Category", "Supplier", "Quantity", "Unit Cost", "Unit Price", "Margin %", "Stock Value (Cost)", "Stock Value (Retail)", "Batch", "Expiry"],
        [[p.sku, p.display_name, p.category_name, p.supplier_name, p.quantity, p.cost_price, p.unit_price,
          round(((p.unit_price - p.cost_price) / p.cost_price * 100), 1) if p.cost_price else 0,
          p.quantity * p.cost_price, p.quantity * p.unit_price, p.batch_number, p.expiry_date.isoformat() if p.expiry_date else ""] for p in products],
    )


@router.get("/dashboard/pdf")
def dashboard_pdf(lead_time_days: int = 7, db: Session = Depends(get_db)):
    s = db.query(Settings).first()
    store_name = (s.store_name if s else None) or "My Store"
    currency = (s.currency_symbol if s else "$") or "$"
    store_lines = [store_name] + [ln for ln in (
        (s.address if s else None),
        (s.phone if s else None),
        (s.email if s else None),
    ) if ln]

    active_parents = Product.variant_parent_id_subquery()
    sellable = (Product.is_active == True, Product.id.notin_(active_parents))
    sellable_qty = Product.quantity - func.coalesce(quarantined_qty_subquery(), 0)
    today = datetime.now(timezone.utc)
    today_start = today.replace(hour=0, minute=0, second=0, microsecond=0)

    total_products = db.query(func.count(Product.id)).filter(
        Product.is_active == True, Product.parent_id.is_(None)
    ).scalar() or 0
    total_categories = db.query(func.count(Category.id)).scalar() or 0
    total_suppliers = db.query(func.count(Supplier.id)).scalar() or 0
    total_orders = db.query(func.count(Order.id)).scalar() or 0
    low_stock_count = db.query(func.count(Product.id)).filter(
        *sellable, sellable_qty <= Product.reorder_level
    ).scalar() or 0
    total_value = float(db.query(func.coalesce(func.sum(sellable_qty * Product.cost_price), 0)).filter(
        Product.is_active == True
    ).scalar() or 0.0)
    total_retail = float(db.query(func.coalesce(func.sum(sellable_qty * Product.unit_price), 0)).filter(
        Product.is_active == True
    ).scalar() or 0.0)
    movements_today = db.query(func.count(StockMovement.id)).filter(
        StockMovement.created_at >= today_start,
        StockMovement.movement_type != TRANSFER_OUT,  # count each transfer pair once
    ).scalar() or 0

    _, risk_summary = _stockout_risk_data(db, lead_time_days)
    quarantined = quarantined_qty_by_product(db)

    low_stock_rows = db.query(Product).filter(
        *sellable, sellable_qty <= Product.reorder_level
    ).order_by(Product.quantity.asc()).limit(30).all()

    pending_asns = db.query(ASN).options(
        joinedload(ASN.items), joinedload(ASN.supplier)
    ).filter(ASN.status == "pending").order_by(ASN.expected_arrival.asc().nulls_last()).limit(30).all()

    open_counts = db.query(CycleCount).options(
        joinedload(CycleCount.location)
    ).filter(CycleCount.status.in_(["pending", "in_progress"])).order_by(CycleCount.created_at.desc()).limit(30).all()

    order_rows = (
        db.query(Order.status, func.count(Order.id), func.coalesce(func.sum(Order.total_amount), 0))
        .group_by(Order.status)
        .all()
    )

    c, buf = new_canvas("Dashboard Summary")
    meta = [
        ("Generated:", today.strftime("%b %d, %Y %H:%M")),
        ("Products:", str(total_products)),
        ("Categories:", str(total_categories)),
        ("Suppliers:", str(total_suppliers)),
    ]
    body_y = draw_header(c, "DASHBOARD SUMMARY", meta, store_lines)

    y = draw_info_block(c, MARGIN, body_y, "Key Figures", [
        f"Inventory Value: {currency}{total_value:,.2f}",
        f"Retail Value: {currency}{total_retail:,.2f}",
        f"Potential Profit: {currency}{total_retail - total_value:,.2f}",
        f"Low Stock Items: {low_stock_count}",
        f"Orders: {total_orders}",
        f"Movements Today: {movements_today}",
        f"Stockout Risk - High: {risk_summary['high']}  Medium: {risk_summary['medium']}  Low: {risk_summary['low']}",
    ])

    if low_stock_rows:
        rows = [[p.display_name, p.sku, str(max(0, p.quantity - quarantined.get(p.id, 0))), str(p.reorder_level)] for p in low_stock_rows]
        y = draw_item_table(
            c, MARGIN, y, ["Low Stock Product", "SKU", "Qty", "Reorder"],
            ["l", "l", "r", "r"], [292, 120, 44, 48], rows,
            on_page_break=lambda c: draw_header(c, "DASHBOARD SUMMARY", meta, store_lines),
        )

    pending_asn_rows = [{
        "asn_number": a.asn_number,
        "supplier": a.supplier_name,
        "expected_arrival": a.expected_arrival,
        "items_pending": sum(max(0, i.expected_qty - i.received_qty) for i in a.items),
    } for a in pending_asns]
    if pending_asn_rows:
        rows = [[
            a["asn_number"],
            a["supplier"],
            a["expected_arrival"].strftime("%b %d") if a["expected_arrival"] else "\u2014",
            str(a["items_pending"]),
        ] for a in pending_asn_rows]
        y = draw_item_table(
            c, MARGIN, y, ["Pending ASN", "Supplier", "Arrival", "Pending"],
            ["l", "l", "l", "r"], [150, 180, 84, 60], rows,
            on_page_break=lambda c: draw_header(c, "DASHBOARD SUMMARY", meta, store_lines),
        )

    open_cc_rows = [{
        "cc_number": cc.cc_number,
        "location": cc.location_name,
        "status": cc.status,
        "total_variance": cc.total_variance,
    } for cc in open_counts]
    if open_cc_rows:
        rows = [[
            r["cc_number"], r["location"] or "\u2014", r["status"], str(r["total_variance"]),
        ] for r in open_cc_rows]
        y = draw_item_table(
            c, MARGIN, y, ["Open Cycle Count", "Location", "Status", "Variance"],
            ["l", "l", "l", "r"], [160, 160, 90, 64], rows,
            on_page_break=lambda c: draw_header(c, "DASHBOARD SUMMARY", meta, store_lines),
        )

    if order_rows:
        rows = [[status, str(count), f"{currency}{float(value):,.2f}"] for status, count, value in order_rows]
        y = draw_item_table(
            c, MARGIN, y, ["Order Status", "Count", "Value"],
            ["l", "r", "r"], [120, 80, 120], rows,
            on_page_break=lambda c: draw_header(c, "DASHBOARD SUMMARY", meta, store_lines),
        )

    draw_signoff(c, y, "Generated from the inventory dashboard.")
    return Response(render_pdf(c, buf), media_type="application/pdf", headers={
        "Content-Disposition": "inline; filename=dashboard_summary.pdf"
    })
