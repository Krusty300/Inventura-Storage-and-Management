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
from app.schemas.dashboard import DashboardStats
from app.services.auth import get_current_user
from app.services.inventory import quarantined_qty_subquery

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/stats", response_model=DashboardStats)
def dashboard_stats(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    quarantined = quarantined_qty_subquery()
    sellable = Product.quantity - func.coalesce(quarantined, 0)

    total_products = db.query(func.count(Product.id)).filter(
        Product.is_active == True, Product.parent_id.is_(None)
    ).scalar() or 0
    total_categories = db.query(func.count(Category.id)).scalar() or 0
    total_suppliers = db.query(func.count(Supplier.id)).scalar() or 0
    total_orders = db.query(func.count(Order.id)).scalar() or 0
    low_stock_count = db.query(func.count(Product.id)).filter(
        Product.is_active == True, sellable <= Product.reorder_level,
        Product.id.notin_(Product.variant_parent_id_subquery()),
    ).scalar() or 0
    expiring_soon = date.today() + timedelta(days=30)
    expiring_soon_count = db.query(func.count(Product.id)).filter(
        Product.is_active == True, Product.expiry_date.isnot(None), Product.expiry_date <= expiring_soon,
        Product.id.notin_(Product.variant_parent_id_subquery()),
    ).scalar() or 0
    total_value = db.query(func.coalesce(func.sum(sellable * Product.cost_price), 0)).filter(
        Product.is_active == True
    ).scalar() or 0.0

    movements_today = db.query(func.count(StockMovement.id)).filter(
        StockMovement.created_at >= today_start
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
        .order_by(Product.quantity.asc())
        .limit(10)
        .all()
    )
    expiring_products = (
        db.query(Product)
        .filter(
            Product.is_active == True, Product.expiry_date.isnot(None), Product.expiry_date <= expiring_soon,
            Product.id.notin_(Product.variant_parent_id_subquery()),
        )
        .order_by(Product.expiry_date.asc())
        .limit(10)
        .all()
    )

    return DashboardStats(
        total_products=total_products,
        total_categories=total_categories,
        total_suppliers=total_suppliers,
        total_orders=total_orders,
        low_stock_count=low_stock_count,
        expiring_soon_count=expiring_soon_count,
        total_inventory_value=total_value,
        total_stock_movements_today=movements_today,
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
    )
