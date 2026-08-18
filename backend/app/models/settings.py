from datetime import datetime

from sqlalchemy import Boolean, Float, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.types import UTCDateTime


class Settings(Base):
    __tablename__ = "settings"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    store_name: Mapped[str] = mapped_column(String(200), default="My Store")
    address: Mapped[str] = mapped_column(Text, default="")
    phone: Mapped[str] = mapped_column(String(30), default="")
    email: Mapped[str] = mapped_column(String(120), default="")
    currency_symbol: Mapped[str] = mapped_column(String(10), default="$")
    currency_code: Mapped[str] = mapped_column(String(10), default="USD")
    tax_rate: Mapped[float] = mapped_column(Float, default=0.0)
    default_reorder_level: Mapped[int] = mapped_column(default=10)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now(), onupdate=func.now())

    expiry_warning_days: Mapped[int] = mapped_column(Integer, default=30)
    low_stock_alerts: Mapped[bool] = mapped_column(Boolean, default=True)
    expiry_alerts: Mapped[bool] = mapped_column(Boolean, default=True)

    shipment_prefix: Mapped[str] = mapped_column(String(20), default="SHP")
    work_order_prefix: Mapped[str] = mapped_column(String(20), default="WO")
    sale_prefix: Mapped[str] = mapped_column(String(20), default="SALE")
    invoice_prefix: Mapped[str] = mapped_column(String(20), default="INV")
    po_prefix: Mapped[str] = mapped_column(String(20), default="PO")

    require_qc_before_ship: Mapped[bool] = mapped_column(Boolean, default=False)
    auto_allocate_stock: Mapped[bool] = mapped_column(Boolean, default=False)
    enforce_fefo: Mapped[bool] = mapped_column(Boolean, default=True)

    default_costing_method: Mapped[str] = mapped_column(String(30), default="weighted_average")
    fiscal_year_start_month: Mapped[int] = mapped_column(Integer, default=1)

    default_items_per_page: Mapped[int] = mapped_column(Integer, default=50)
    date_format: Mapped[str] = mapped_column(String(20), default="YYYY-MM-DD")
