from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import SoftDeleteMixin
from app.models.types import UTCDateTime


class Kit(SoftDeleteMixin, Base):
    __tablename__ = "kits"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    version: Mapped[str] = mapped_column(String(50), default="")
    discount_type: Mapped[str] = mapped_column(String(20), default="fixed")
    discount_value: Mapped[float] = mapped_column(Numeric(10, 2), default=0.0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now(), onupdate=func.now())

    product = relationship("Product", back_populates="kits")
    items = relationship("KitItem", back_populates="kit", cascade="all, delete-orphan", order_by="KitItem.position")

    @property
    def item_count(self) -> int:
        return len(self.items)

    @property
    def total_cost(self) -> float:
        return sum(float(i.product.cost_price or 0) * i.quantity for i in self.items)

    @property
    def retail_value(self) -> float:
        """Sum of component retail (unit_price) values - the "normal" price for the bundle."""
        return sum(float(i.product.unit_price or 0) * i.quantity for i in self.items)

    @property
    def bundle_price(self) -> float:
        """Price the kit sells at after applying the bundle discount."""
        base = self.retail_value
        if self.discount_type == "percentage":
            return round(base * (1 - float(self.discount_value) / 100), 2)
        return max(0.0, round(base - float(self.discount_value), 2))

    @property
    def savings(self) -> float:
        return round(self.retail_value - self.bundle_price, 2)

    @property
    def product_name(self) -> str:
        return self.product.display_name if self.product else ""


class KitItem(Base):
    __tablename__ = "kit_items"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    kit_id: Mapped[int] = mapped_column(ForeignKey("kits.id"), nullable=False, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    position: Mapped[int] = mapped_column(Integer, default=0)

    kit = relationship("Kit", back_populates="items")
    product = relationship("Product")

    @property
    def product_name(self) -> str:
        return self.product.display_name if self.product else ""

    @property
    def unit_cost(self) -> float:
        return float(self.product.cost_price or 0) if self.product else 0.0

    @property
    def unit_price(self) -> float:
        return float(self.product.unit_price or 0) if self.product else 0.0