from datetime import date, datetime

from sqlalchemy import Boolean, Date, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.mixins import SoftDeleteMixin
from app.models.types import UTCDateTime


class Promotion(SoftDeleteMixin, Base):
    __tablename__ = "promotions"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    code: Mapped[str] = mapped_column(String(50), nullable=False, unique=True, index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    discount_type: Mapped[str] = mapped_column(String(20), nullable=False)  # "percentage" or "fixed"
    value: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    min_qty: Mapped[int] = mapped_column(Integer, default=0)
    min_amount: Mapped[float] = mapped_column(Numeric(10, 2), default=0)
    valid_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    valid_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    max_uses: Mapped[int] = mapped_column(Integer, default=0)  # 0 = unlimited
    used_count: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now(), onupdate=func.now())
