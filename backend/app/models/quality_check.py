from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class QualityCheck(Base):
    __tablename__ = "quality_checks"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    qc_number: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    lot_id: Mapped[int | None] = mapped_column(ForeignKey("lots.id"), nullable=True, index=True)
    work_order_id: Mapped[int | None] = mapped_column(ForeignKey("work_orders.id"), nullable=True, index=True)
    batch_number: Mapped[str] = mapped_column(String(100), default="")
    result: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    notes: Mapped[str] = mapped_column(Text, default="")
    checked_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    checked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    product = relationship("Product")
    lot = relationship("Lot")
    work_order = relationship("WorkOrder")
    checker = relationship("User", foreign_keys=[checked_by])

    @property
    def product_name(self) -> str:
        return self.product.display_name if self.product else ""

    @property
    def lot_number(self) -> str:
        return self.lot.lot_number if self.lot else ""

    @property
    def wo_number(self) -> str:
        return self.work_order.wo_number if self.work_order else ""

    @property
    def checker_username(self) -> str:
        return self.checker.username if self.checker else ""
