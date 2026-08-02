from pydantic import BaseModel


class DashboardStats(BaseModel):
    total_products: int
    total_categories: int
    total_suppliers: int
    total_orders: int
    low_stock_count: int
    expiring_soon_count: int
    total_inventory_value: float
    total_stock_movements_today: int
    recent_movements: list = []
    low_stock_products: list = []
    expiring_products: list = []
