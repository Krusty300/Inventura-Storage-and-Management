from datetime import date, datetime

from sqlalchemy import JSON, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, func, select
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Product(Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    sku: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id"), nullable=True, index=True)
    supplier_id: Mapped[int | None] = mapped_column(ForeignKey("suppliers.id"), nullable=True, index=True)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("products.id"), nullable=True, index=True)
    attributes: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    unit_price: Mapped[float] = mapped_column(Numeric(10, 2), default=0.0)
    cost_price: Mapped[float] = mapped_column(Numeric(10, 2), default=0.0)
    quantity: Mapped[int] = mapped_column(Integer, default=0)
    reorder_level: Mapped[int] = mapped_column(Integer, default=10)
    is_serialized: Mapped[bool] = mapped_column(default=False)
    location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"), nullable=True, index=True)
    location: Mapped[str] = mapped_column(String(100), default="")
    barcode: Mapped[str] = mapped_column(String(100), default="")
    batch_number: Mapped[str] = mapped_column(String(100), default="")
    expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    image_url: Mapped[str] = mapped_column(String(500), default="")
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    category = relationship("Category", back_populates="products")
    supplier = relationship("Supplier", back_populates="products")
    default_location = relationship("Location")
    stock_movements = relationship("StockMovement", back_populates="product")
    order_items = relationship("OrderItem", back_populates="product")
    sale_items = relationship("SaleItem", back_populates="product")
    stock_lines = relationship("StockLine", back_populates="product")
    lots = relationship("Lot", back_populates="product")
    serial_numbers = relationship("SerialNumber", back_populates="product")
    variant_of = relationship("Product", remote_side=[id], back_populates="variants")
    variants = relationship("Product", back_populates="variant_of", cascade="all", order_by="Product.id")

    @property
    def category_name(self) -> str:
        return self.category.name if self.category else ""

    @property
    def supplier_name(self) -> str:
        return self.supplier.name if self.supplier else ""

    @property
    def is_variant(self) -> bool:
        return self.parent_id is not None

    @property
    def variant_label(self) -> str:
        if not self.attributes:
            return ""
        return " / ".join(str(v) for k, v in sorted(self.attributes.items()))

    @property
    def display_name(self) -> str:
        if self.is_variant and self.variant_label:
            return f"{self.name} - {self.variant_label}"
        return self.name

    @property
    def total_quantity(self) -> int:
        if self.variants:
            return sum(v.quantity for v in self.variants if v.is_active)
        return self.quantity

    @staticmethod
    def variant_parent_id_subquery():
        """Select the ids of parents that have at least one active variant row."""
        return select(Product.parent_id).where(
            Product.parent_id.isnot(None), Product.is_active == True
        )
