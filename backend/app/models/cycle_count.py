from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class CycleCount(Base):
    __tablename__ = "cycle_counts"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    cc_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"), nullable=True, index=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    location = relationship("Location")
    creator = relationship("User")
    items = relationship("CycleCountItem", back_populates="cycle_count", cascade="all, delete-orphan", order_by="CycleCountItem.id")

    @property
    def location_name(self) -> str:
        return self.location.path if self.location else ""

    @property
    def username(self) -> str:
        return self.creator.username if self.creator else ""

    @property
    def has_variance(self) -> bool:
        return any(i.variance != 0 for i in self.items)

    @property
    def total_expected(self) -> int:
        return sum(i.expected_qty for i in self.items)

    @property
    def total_variance(self) -> int:
        return sum(i.variance for i in self.items)


class CycleCountItem(Base):
    __tablename__ = "cycle_count_items"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    cycle_count_id: Mapped[int] = mapped_column(ForeignKey("cycle_counts.id"), nullable=False, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    expected_qty: Mapped[int] = mapped_column(Integer, default=0)
    counted_qty: Mapped[int | None] = mapped_column(Integer, nullable=True)
    variance: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), default="pending")

    cycle_count = relationship("CycleCount", back_populates="items")
    product = relationship("Product")

    @property
    def product_name(self) -> str:
        return self.product.display_name if self.product else ""
