from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.services.httpratelimit import limiter
from app.models.order import Order
from app.models.product import Product
from app.models.stock_movement import StockMovement
from app.models.category import Category
from app.models.supplier import Supplier
from app.models.user import User
from app.models.shipment import Shipment
from app.models.work_order import WorkOrder
from app.models.quality_check import QualityCheck
from app.models.serial_number import SerialNumber
from app.models.stock_line import StockLine
from app.models.lot import Lot
from app.models.sale import Sale
from app.models.sales_channel import SalesChannel
from app.models.promotion import Promotion
from app.schemas.dashboard import DashboardStats, DashboardWidgetLayout, WidgetConfig
from app.services.auth import get_current_user, require_permission
from app.services import expiry as expiry_svc
from app.services import inventory
from app.services.inventory import NON_ACTIVITY_MOVEMENT_TYPES, TRANSFER_OUT, SERIAL_STATUS_QUARANTINED, sellable_qty_by_product, sellable_qty_subquery

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"], dependencies=[Depends(require_permission("dashboard.view"))])


@router.get("/stats", response_model=DashboardStats)
@limiter.limit("30/minute")
def dashboard_stats(request: Request, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    inventory.expire_overdue_lots(db)
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    sellable = sellable_qty_subquery()

    total_products = db.query(func.count(Product.id)).filter(
        Product.is_active == True, Product.parent_id.is_(None)
    ).scalar() or 0
    total_categories = db.query(func.count(Category.id)).scalar() or 0
    total_suppliers = db.query(func.count(Supplier.id)).scalar() or 0
    total_orders = db.query(func.count(Order.id)).scalar() or 0
    total_lots = db.query(func.count(Lot.id)).scalar() or 0
    low_stock_count = db.query(func.count(Product.id)).filter(
        Product.is_active == True, sellable <= Product.reorder_level,
        Product.id.notin_(Product.variant_parent_id_subquery()),
    ).scalar() or 0
    today = date.today()
    expiring_days = expiry_svc.warning_window(db)
    expiring_soon = today + timedelta(days=expiring_days)
    # Same question as the products grid: a parent is expiring when it or any
    # active variant holds sellable stock (or a static date) inside the window.
    expiring_cond = (
        expiry_svc.expiring_condition(Product.id, today, expiring_soon)
        | Product.id.in_(
            select(Product.parent_id).where(
                Product.parent_id.isnot(None), Product.is_active == True,  # noqa: E712
                expiry_svc.expiring_condition(Product.id, today, expiring_soon),
            )
        )
    )
    expiring_soon_count = db.query(func.count(Product.id)).filter(
        Product.is_active == True, expiring_cond,
    ).scalar() or 0
    total_value = db.query(func.coalesce(func.sum(sellable * Product.cost_price), 0)).filter(
        Product.is_active == True
    ).scalar() or 0.0

    movements_today = db.query(func.count(StockMovement.id)).filter(
        StockMovement.created_at >= today_start,
        StockMovement.movement_type.notin_(NON_ACTIVITY_MOVEMENT_TYPES | {TRANSFER_OUT}),  # exclude bookkeeping; count each transfer pair once
    ).scalar() or 0

    open_shipments = db.query(func.count(Shipment.id)).filter(
        Shipment.status.in_(["draft", "picking", "packed"])
    ).scalar() or 0
    open_work_orders = db.query(func.count(WorkOrder.id)).filter(
        WorkOrder.status.in_(["planned", "released", "in_progress"])
    ).scalar() or 0
    pending_quality_checks = db.query(func.count(QualityCheck.id)).filter(
        QualityCheck.result.in_(["pending", "fail"])
    ).scalar() or 0
    quarantined_units = (
        db.query(func.coalesce(func.sum(StockLine.quantity), 0))
        .join(Lot, StockLine.lot_id == Lot.id)
        .filter(Lot.status == "quarantined")
        .scalar()
        or 0
    )
    quarantined_units += (
        db.query(func.count(SerialNumber.id))
        .filter(SerialNumber.status == SERIAL_STATUS_QUARANTINED)
        .scalar()
        or 0
    )
    serial_numbers_in_stock = db.query(func.count(SerialNumber.id)).filter(
        SerialNumber.status == "in_stock"
    ).scalar() or 0

    recent_movements = (
        db.query(StockMovement)
        .options(joinedload(StockMovement.product))
        .order_by(StockMovement.created_at.desc())
        .limit(10)
        .all()
    )
    low_stock_products = (
        db.query(Product)
        .filter(
            Product.is_active == True, sellable <= Product.reorder_level,
            Product.id.notin_(Product.variant_parent_id_subquery()),
        )
        .order_by(sellable.asc())
        .limit(10)
        .all()
    )
    expiring_products = (
        db.query(Product)
        .options(
            joinedload(Product.stock_lines).joinedload(StockLine.lot),
            joinedload(Product.variants).joinedload(Product.stock_lines).joinedload(StockLine.lot),
        )
        .filter(Product.is_active == True, expiring_cond)  # noqa: E712
        .all()
    )
    expiring_lot_dates = expiry_svc.lot_expiry_dates_by_product(db, [p.id for p in expiring_products]) if expiring_products else {}
    expiring_rows = []
    for p in expiring_products:
        eff, days = expiry_svc.effective_expiry(today, p.expiry_date, expiring_lot_dates.get(p.id, []))
        expiring_rows.append((eff, days, p))
    expiring_rows.sort(key=lambda x: (x[0] or date.max, x[2].name.lower()))
    expiring_rows = expiring_rows[:10]

    shipments_to_process = (
        db.query(Shipment)
        .options(joinedload(Shipment.customer), joinedload(Shipment.items))
        .filter(Shipment.status.in_(["draft", "picking", "packed"]))
        .order_by(Shipment.created_at.asc())
        .limit(5)
        .all()
    )
    work_orders_to_process = (
        db.query(WorkOrder)
        .options(joinedload(WorkOrder.product))
        .filter(WorkOrder.status.in_(["planned", "released", "in_progress"]))
        .order_by(WorkOrder.created_at.asc())
        .limit(5)
        .all()
    )
    quality_checks_to_process = (
        db.query(QualityCheck)
        .options(joinedload(QualityCheck.product))
        .filter(QualityCheck.result.in_(["pending", "fail"]))
        .order_by(
            case((QualityCheck.result == "pending", 0), else_=1),
            QualityCheck.created_at.asc(),
        )
        .limit(5)
        .all()
    )

    now = datetime.now(timezone.utc)
    thirty_days = now + timedelta(days=30)
    active_promotions_count = db.query(func.count(Promotion.id)).filter(
        Promotion.is_active == True  # noqa: E712
    ).scalar() or 0
    expiring_promotions_count = db.query(func.count(Promotion.id)).filter(
        Promotion.is_active == True,  # noqa: E712
        Promotion.valid_to.isnot(None),
        Promotion.valid_to <= thirty_days.date(),
        Promotion.valid_to >= date.today(),
    ).scalar() or 0
    top_channel_row = (
        db.query(SalesChannel.name, func.count(Sale.id).label("cnt"))
        .join(Sale, Sale.channel_id == SalesChannel.id)
        .filter(Sale.status == "completed")
        .group_by(SalesChannel.name)
        .order_by(func.count(Sale.id).desc())
        .first()
    )
    top_channel = top_channel_row[0] if top_channel_row else ""
    pending_sales_count = db.query(func.count(Sale.id)).filter(
        Sale.status == "pending"
    ).scalar() or 0

    sellable_by_product = sellable_qty_by_product(db, [p.id for p in low_stock_products]) if low_stock_products else {}

    return DashboardStats(
        total_products=total_products,
        total_categories=total_categories,
        total_suppliers=total_suppliers,
        total_orders=total_orders,
        total_lots=total_lots,
        low_stock_count=low_stock_count,
        expiring_soon_count=expiring_soon_count,
        total_inventory_value=total_value,
        total_stock_movements_today=movements_today,
        open_shipments=open_shipments,
        open_work_orders=open_work_orders,
        pending_quality_checks=pending_quality_checks,
        quarantined_units=quarantined_units,
        serial_numbers_in_stock=serial_numbers_in_stock,
        recent_movements=[
            {
                "id": m.id,
                "product_name": m.product.display_name if m.product else "",
                "quantity_change": m.quantity_change,
                "movement_type": m.movement_type,
                "created_at": m.created_at.isoformat(),
            }
            for m in recent_movements
        ],
        low_stock_products=[
            {
                "id": p.id,
                "name": p.display_name,
                "sku": p.sku,
                "quantity": p.quantity,
                "sellable": sellable_by_product.get(p.id, 0),
                "reorder_level": p.reorder_level,
            }
            for p in low_stock_products
        ],
        expiring_products=[
            {
                "id": p.id,
                "name": p.display_name,
                "sku": p.sku,
                "expiry_date": eff.isoformat() if eff else "",
                "expiry_days_left": days,
                "batch_number": p.batch_number,
            }
            for eff, days, p in expiring_rows
        ],
        shipments_to_process=[
            {
                "id": s.id,
                "shipment_number": s.shipment_number,
                "customer_name": s.customer_name,
                "status": s.status,
                "total_quantity": s.total_quantity,
                "total_picked": s.total_picked,
                "total_amount": s.total_amount,
                "created_at": s.created_at.isoformat(),
            }
            for s in shipments_to_process
        ],
        work_orders_to_process=[
            {
                "id": w.id,
                "wo_number": w.wo_number,
                "product_name": w.product_name,
                "status": w.status,
                "quantity": w.quantity,
                "created_at": w.created_at.isoformat(),
            }
            for w in work_orders_to_process
        ],
        quality_checks_to_process=[
            {
                "id": q.id,
                "qc_number": q.qc_number,
                "product_name": q.product_name,
                "result": q.result,
                "created_at": q.created_at.isoformat(),
            }
            for q in quality_checks_to_process
        ],
        active_promotions_count=active_promotions_count,
        expiring_promotions_count=expiring_promotions_count,
        top_channel=top_channel,
        pending_sales_count=pending_sales_count,
    )


DEFAULT_WIDGETS: list[WidgetConfig] = [
    WidgetConfig(id="kpi-inventory", order=0),
    WidgetConfig(id="kpi-fulfillment", order=1),
    WidgetConfig(id="kpi-manufacturing", order=2),
    WidgetConfig(id="kpi-business", order=3),
    WidgetConfig(id="chart-trends", order=4),
    WidgetConfig(id="chart-category-value", order=5),
    WidgetConfig(id="list-top-products", order=6),
    WidgetConfig(id="chart-profit", order=7),
    WidgetConfig(id="list-low-stock", order=8),
    WidgetConfig(id="list-expiring", order=9),
    WidgetConfig(id="list-recent-movements", order=10),
    WidgetConfig(id="list-recent-sales", order=11),
    WidgetConfig(id="list-receipts", order=12),
    WidgetConfig(id="list-lpns", order=13),
    WidgetConfig(id="list-order-status", order=14),
    WidgetConfig(id="list-pending-asns", order=15),
    WidgetConfig(id="list-open-cycle-counts", order=16),
    WidgetConfig(id="list-shipments", order=17),
    WidgetConfig(id="list-work-orders", order=18),
    WidgetConfig(id="list-qc", order=19),
    WidgetConfig(id="list-cost", order=20),
    WidgetConfig(id="stockout-risk", order=21),
]


@router.get("/widgets", response_model=DashboardWidgetLayout)
def get_dashboard_widgets(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.dashboard_widgets:
        return DashboardWidgetLayout(widgets=[WidgetConfig(**w) for w in user.dashboard_widgets])
    return DashboardWidgetLayout(widgets=list(DEFAULT_WIDGETS))


@router.put("/widgets", response_model=DashboardWidgetLayout)
def save_dashboard_widgets(
    data: DashboardWidgetLayout,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    user.dashboard_widgets = [w.model_dump() for w in data.widgets]
    db.commit()
    return DashboardWidgetLayout(widgets=data.widgets)
