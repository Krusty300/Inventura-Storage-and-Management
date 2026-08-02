from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class SerialNumber(Base):
    __tablename__ = "serial_numbers"
    __table_args__ = (
        UniqueConstraint("product_id", "serial_number", name="uq_serial_numbers_product_serial"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    serial_number: Mapped[str] = mapped_column(String(100), nullable=False)
    lot_id: Mapped[int | None] = mapped_column(ForeignKey("lots.id"), nullable=True, index=True)
    location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"), nullable=True, index=True)
    lpn_id: Mapped[int | None] = mapped_column(ForeignKey("lpns.id"), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(20), default="in_stock")
    sold_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    product = relationship("Product", back_populates="serial_numbers")
    lot = relationship("Lot", back_populates="serial_numbers")
    location = relationship("Location")
    stock_movements = relationship("StockMovement", back_populates="serial_number")

    @property
    def product_name(self) -> str:
        return self.product.display_name if self.product else ""

    @property
    def lot_number(self) -> str:
        return self.lot.lot_number if self.lot else ""

    @property
    def location_name(self) -> str:
        return self.location.path if self.location else ""
