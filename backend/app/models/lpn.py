from datetime import datetime

from sqlalchemy import ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.types import UTCDateTime


class LPN(Base):
    __tablename__ = "lpns"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    lpn_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    lpn_type: Mapped[str] = mapped_column(String(20), default="pallet")
    location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(20), default="active")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now())

    location = relationship("Location", back_populates="lpns")
    stock_lines = relationship("StockLine", back_populates="lpn")
    serial_numbers = relationship("SerialNumber", back_populates="lpn")

    @property
    def location_name(self) -> str:
        return self.location.name if self.location else ""
