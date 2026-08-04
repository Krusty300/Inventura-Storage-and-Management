from pydantic import BaseModel


class DashboardShipmentRow(BaseModel):
    id: int
    shipment_number: str
    customer_name: str
    status: str
    total_quantity: int
    total_picked: int
    total_amount: float
    created_at: str


class DashboardWorkOrderRow(BaseModel):
    id: int
    wo_number: str
    product_name: str
    status: str
    quantity: int
    created_at: str


class DashboardQualityCheckRow(BaseModel):
    id: int
    qc_number: str
    product_name: str
    result: str
    created_at: str


class DashboardStats(BaseModel):
    total_products: int
    total_categories: int
    total_suppliers: int
    total_orders: int
    low_stock_count: int
    expiring_soon_count: int
    total_inventory_value: float
    total_stock_movements_today: int
    open_shipments: int = 0
    open_work_orders: int = 0
    pending_quality_checks: int = 0
    quarantined_units: int = 0
    serial_numbers_in_stock: int = 0
    recent_movements: list = []
    low_stock_products: list = []
    expiring_products: list = []
    shipments_to_process: list[DashboardShipmentRow] = []
    work_orders_to_process: list[DashboardWorkOrderRow] = []
    quality_checks_to_process: list[DashboardQualityCheckRow] = []
