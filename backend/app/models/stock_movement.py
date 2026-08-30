from datetime import datetime

from sqlalchemy import ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.types import UTCDateTime


class StockMovement(Base):
    __tablename__ = "stock_movements"
    __table_args__ = (
        Index("ix_stock_movements_reference", "reference_type", "reference"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    quantity_change: Mapped[int] = mapped_column(Integer, nullable=False)
    movement_type: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    from_location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"), nullable=True, index=True)
    to_location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"), nullable=True, index=True)
    lot_id: Mapped[int | None] = mapped_column(ForeignKey("lots.id"), nullable=True, index=True)
    serial_id: Mapped[int | None] = mapped_column(ForeignKey("serial_numbers.id"), nullable=True, index=True)
    lpn_id: Mapped[int | None] = mapped_column(ForeignKey("lpns.id"), nullable=True, index=True)
    transfer_id: Mapped[int | None] = mapped_column(nullable=True, index=True)
    reference_type: Mapped[str] = mapped_column(String(30), default="")
    reference: Mapped[str] = mapped_column(String(100), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now(), index=True)

    product = relationship("Product", back_populates="stock_movements")
    user = relationship("User", back_populates="stock_movements")
    from_location = relationship("Location", foreign_keys=[from_location_id])
    to_location = relationship("Location", foreign_keys=[to_location_id])
    lot = relationship("Lot", back_populates="stock_movements")
    serial_number = relationship("SerialNumber", back_populates="stock_movements")
    lpn = relationship("LPN", back_populates="stock_movements")

    @property
    def product_name(self) -> str:
        return self.product.display_name if self.product else ""

    @property
    def username(self) -> str:
        return self.user.username if self.user else ""

    @property
    def from_location_name(self) -> str:
        return self.from_location.name if self.from_location else ""

    @property
    def to_location_name(self) -> str:
        return self.to_location.name if self.to_location else ""
