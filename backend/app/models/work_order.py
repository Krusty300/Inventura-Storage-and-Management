from datetime import datetime

from sqlalchemy import ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.types import UTCDateTime


class WorkOrder(Base):
    __tablename__ = "work_orders"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    wo_number: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    bom_id: Mapped[int | None] = mapped_column(ForeignKey("boms.id"), nullable=True, index=True)
    wip_location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(20), default="planned")
    priority: Mapped[str] = mapped_column(String(20), default="normal")
    notes: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now(), onupdate=func.now())

    product = relationship("Product", foreign_keys=[product_id])
    bom = relationship("BOM")
    wip_location = relationship("Location")
    creator = relationship("User", foreign_keys=[created_by])
    items = relationship("WorkOrderItem", back_populates="work_order", cascade="all, delete-orphan", order_by="WorkOrderItem.id")

    @property
    def product_name(self) -> str:
        return self.product.display_name if self.product else ""

    @property
    def is_serialized(self) -> bool:
        return bool(self.product and self.product.is_serialized)

    @property
    def username(self) -> str:
        return self.creator.username if self.creator else ""

    @property
    def bom_name(self) -> str:
        return self.bom.name if self.bom else ""

    @property
    def total_required(self) -> int:
        return sum(i.quantity_required for i in self.items)

    @property
    def total_issued(self) -> int:
        return sum(i.quantity_issued for i in self.items)

    @property
    def fully_issued(self) -> bool:
        return all(i.quantity_issued >= i.quantity_required for i in self.items)


class WorkOrderItem(Base):
    __tablename__ = "work_order_items"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    work_order_id: Mapped[int] = mapped_column(ForeignKey("work_orders.id"), nullable=False, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    quantity_required: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    quantity_issued: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    work_order = relationship("WorkOrder", back_populates="items")
    product = relationship("Product")

    @property
    def product_name(self) -> str:
        return self.product.display_name if self.product else ""
