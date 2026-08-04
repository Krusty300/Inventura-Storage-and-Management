from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class BOM(Base):
    __tablename__ = "boms"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    product = relationship("Product", back_populates="boms")
    items = relationship("BOMItem", back_populates="bom", cascade="all, delete-orphan", order_by="BOMItem.position")

    @property
    def item_count(self) -> int:
        return len(self.items)

    @property
    def total_cost(self) -> float:
        return sum(float(i.product.cost_price or 0) * i.quantity for i in self.items)

    @property
    def product_name(self) -> str:
        return self.product.display_name if self.product else ""


class BOMItem(Base):
    __tablename__ = "bom_items"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    bom_id: Mapped[int] = mapped_column(ForeignKey("boms.id"), nullable=False, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    position: Mapped[int] = mapped_column(Integer, default=0)

    bom = relationship("BOM", back_populates="items")
    product = relationship("Product")

    @property
    def product_name(self) -> str:
        return self.product.display_name if self.product else ""

    @property
    def unit_cost(self) -> float:
        return float(self.product.cost_price or 0) if self.product else 0.0
