from datetime import datetime

from sqlalchemy import ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import SoftDeleteMixin
from app.models.types import UTCDateTime


class Customer(SoftDeleteMixin, Base):
    __tablename__ = "customers"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    phone: Mapped[str] = mapped_column(String(30), default="")
    email: Mapped[str] = mapped_column(String(120), default="")
    address: Mapped[str] = mapped_column(Text, default="")
    customer_type: Mapped[str] = mapped_column(String(20), default="walk-in")
    group_id: Mapped[int | None] = mapped_column(ForeignKey("customer_groups.id"), nullable=True, index=True)
    notes: Mapped[str] = mapped_column(Text, default="")
    image_url: Mapped[str] = mapped_column(String(500), default="")
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now(), onupdate=func.now())

    sales = relationship("Sale", back_populates="customer")
    group = relationship("CustomerGroup", back_populates="customers")

    @property
    def group_name(self) -> str:
        return self.group.name if self.group else ""

    @property
    def price_list_id(self) -> int | None:
        return self.group.price_list_id if self.group else None
