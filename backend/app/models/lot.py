from datetime import date, datetime

from sqlalchemy import Date, ForeignKey, String, UniqueConstraint, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.types import UTCDateTime


class Lot(Base):
    __tablename__ = "lots"
    __table_args__ = (UniqueConstraint("product_id", "lot_number", name="uq_lots_product_lot"),)

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    lot_number: Mapped[str] = mapped_column(String(100), nullable=False)
    supplier_id: Mapped[int | None] = mapped_column(ForeignKey("suppliers.id"), nullable=True, index=True)
    expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    received_date: Mapped[date] = mapped_column(Date, server_default=text("(date('now'))"))
    status: Mapped[str] = mapped_column(String(20), default="in_stock")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now())

    product = relationship("Product", back_populates="lots")
    supplier = relationship("Supplier", back_populates="lots")
    stock_lines = relationship("StockLine", back_populates="lot")
    serial_numbers = relationship("SerialNumber", back_populates="lot")
    stock_movements = relationship("StockMovement", back_populates="lot")
    parent_links = relationship(
        "LotLink", foreign_keys="LotLink.child_lot_id", back_populates="child"
    )
    child_links = relationship(
        "LotLink", foreign_keys="LotLink.parent_lot_id", back_populates="parent"
    )

    @property
    def product_name(self) -> str:
        return self.product.display_name if self.product else ""

    @property
    def supplier_name(self) -> str:
        return self.supplier.name if self.supplier else ""

    @property
    def on_hand(self) -> int:
        return sum(sl.quantity for sl in self.stock_lines)

    @property
    def serial_count(self) -> int:
        return sum(1 for s in self.serial_numbers if s.status == "in_stock")
