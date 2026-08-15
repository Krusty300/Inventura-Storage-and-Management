from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
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
from app.schemas.dashboard import DashboardStats
from app.services.auth import get_current_user, require_permission
from app.services import inventory
from app.services.inventory import TRANSFER_OUT, SERIAL_STATUS_QUARANTINED, expire_overdue_lots, sellable_qty_subquery

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"], dependencies=[Depends(require_permission("dashboard.view"))])


@router.get("/stats", response_model=DashboardStats)
def dashboard_stats(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    expire_overdue_lots(db)
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
    expiring_soon = date.today() + timedelta(days=30)
    expiring_soon_count = db.query(func.count(Product.id)).filter(
        Product.is_active == True, Product.expiry_date.isnot(None),
        Product.expiry_date >= date.today(), Product.expiry_date <= expiring_soon,
        Product.id.notin_(Product.variant_parent_id_subquery()),
    ).scalar() or 0
    total_value = db.query(func.coalesce(func.sum(sellable * Product.cost_price), 0)).filter(
        Product.is_active == True
    ).scalar() or 0.0

    movements_today = db.query(func.count(StockMovement.id)).filter(
        StockMovement.created_at >= today_start,
        StockMovement.movement_type != TRANSFER_OUT,  # count each transfer pair once
    ).scalar() or 0

    open_shipments = db.query(func.count(Shipment.id)).filter(
        Shipment.status.in_(["draft", "picking", "packed"])
    ).scalar() or 0
    open_work_orders = db.query(func.count(WorkOrder.id)).filter(
        WorkOrder.status.in_(["planned", "released", "in_progress"])
    ).scalar() or 0
    pending_quality_checks = db.query(func.count(QualityCheck.id)).filter(
        QualityCheck.result == "pending"
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
        .filter(
            Product.is_active == True, Product.expiry_date.isnot(None),
            Product.expiry_date >= date.today(), Product.expiry_date <= expiring_soon,
            Product.id.notin_(Product.variant_parent_id_subquery()),
        )
        .order_by(Product.expiry_date.asc())
        .limit(10)
        .all()
    )

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
        .filter(QualityCheck.result == "pending")
        .order_by(QualityCheck.created_at.asc())
        .limit(5)
        .all()
    )

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
                "sellable": inventory.on_hand(db, product_id=p.id, sellable_only=True),
                "reorder_level": p.reorder_level,
            }
            for p in low_stock_products
        ],
        expiring_products=[
            {
                "id": p.id,
                "name": p.display_name,
                "sku": p.sku,
                "expiry_date": p.expiry_date.isoformat() if p.expiry_date else "",
                "batch_number": p.batch_number,
            }
            for p in expiring_products
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
    )
