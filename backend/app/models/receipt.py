from datetime import datetime

from sqlalchemy import ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.types import UTCDateTime


class Receipt(Base):
    __tablename__ = "receipts"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    receipt_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    supplier_id: Mapped[int | None] = mapped_column(ForeignKey("suppliers.id"), nullable=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    reference: Mapped[str] = mapped_column(String(200), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    total_quantity: Mapped[int] = mapped_column(Integer, default=0)
    total_cost: Mapped[float] = mapped_column(Numeric(12, 2), default=0.0)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now())

    supplier = relationship("Supplier")
    user = relationship("User")
    items = relationship("ReceiptItem", back_populates="receipt", cascade="all, delete-orphan", order_by="ReceiptItem.id")

    @property
    def supplier_name(self) -> str:
        return self.supplier.name if self.supplier else ""

    @property
    def username(self) -> str:
        return self.user.username if self.user else ""


class ReceiptItem(Base):
    __tablename__ = "receipt_items"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    receipt_id: Mapped[int] = mapped_column(ForeignKey("receipts.id"), nullable=False, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_cost: Mapped[float] = mapped_column(Numeric(10, 2), default=0.0)
    lot_id: Mapped[int | None] = mapped_column(ForeignKey("lots.id"), nullable=True, index=True)
    location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"), nullable=True, index=True)

    receipt = relationship("Receipt", back_populates="items")
    product = relationship("Product")
    lot = relationship("Lot")
    location = relationship("Location")

    @property
    def product_name(self) -> str:
        return self.product.display_name if self.product else ""

    @property
    def lot_number(self) -> str:
        return self.lot.lot_number if self.lot else ""

    @property
    def location_name(self) -> str:
        return self.location.path if self.location else ""

    @property
    def location_code(self) -> str:
        return self.location.code or self.location.name if self.location else ""
