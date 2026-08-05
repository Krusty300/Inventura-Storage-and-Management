from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.types import UTCDateTime


class Location(Base):
    __tablename__ = "locations"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    code: Mapped[str | None] = mapped_column(String(50), unique=True, nullable=True, index=True)
    location_type: Mapped[str] = mapped_column(String(30), default="bin")
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"), nullable=True, index=True)
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now())

    parent = relationship("Location", remote_side=[id], back_populates="children")
    children = relationship("Location", back_populates="parent", cascade="all", order_by="Location.id")
    stock_lines = relationship("StockLine", back_populates="location")
    lpns = relationship("LPN", back_populates="location")

    @property
    def path(self) -> str:
        parts = [self.name]
        node = self.parent
        while node is not None:
            parts.insert(0, node.name)
            node = node.parent
        return " / ".join(parts)
