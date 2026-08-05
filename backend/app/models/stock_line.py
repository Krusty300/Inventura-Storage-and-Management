from datetime import datetime

from sqlalchemy import ForeignKey, Index, Integer, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.types import UTCDateTime


class StockLine(Base):
    __tablename__ = "stock_lines"
    __table_args__ = (
        UniqueConstraint("product_id", "location_id", "lot_id", "lpn_id", name="uq_stock_lines_loc_lot_lpn"),
        Index("ix_stock_lines_product_lot", "product_id", "lot_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"), nullable=True, index=True)
    lot_id: Mapped[int | None] = mapped_column(ForeignKey("lots.id"), nullable=True, index=True)
    lpn_id: Mapped[int | None] = mapped_column(ForeignKey("lpns.id"), nullable=True, index=True)
    quantity: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now(), onupdate=func.now())

    product = relationship("Product", back_populates="stock_lines")
    location = relationship("Location", back_populates="stock_lines")
    lot = relationship("Lot", back_populates="stock_lines")
    lpn = relationship("LPN", back_populates="stock_lines")

    @property
    def location_name(self) -> str:
        return self.location.name if self.location else ""

    @property
    def lot_number(self) -> str:
        return self.lot.lot_number if self.lot else ""

    @property
    def lpn_number(self) -> str:
        return self.lpn.lpn_number if self.lpn else ""
