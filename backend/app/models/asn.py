from datetime import date, datetime

from sqlalchemy import Date, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.types import UTCDateTime


class ASN(Base):
    __tablename__ = "asns"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    asn_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    supplier_id: Mapped[int | None] = mapped_column(ForeignKey("suppliers.id"), nullable=True, index=True)
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id"), nullable=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    expected_arrival: Mapped[date | None] = mapped_column(Date, nullable=True)
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now())
    received_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    supplier = relationship("Supplier", back_populates="asns")
    order = relationship("Order")
    user = relationship("User")
    items = relationship("ASNItem", back_populates="asn", cascade="all, delete-orphan", order_by="ASNItem.id")

    @property
    def supplier_name(self) -> str:
        return self.supplier.name if self.supplier else ""

    @property
    def order_number(self) -> str:
        return self.order.order_number if self.order else ""

    @property
    def username(self) -> str:
        return self.user.username if self.user else ""

    @property
    def total_expected(self) -> int:
        return sum(i.expected_qty for i in self.items)

    @property
    def total_received(self) -> int:
        return sum(i.received_qty for i in self.items)


class ASNItem(Base):
    __tablename__ = "asn_items"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    asn_id: Mapped[int] = mapped_column(ForeignKey("asns.id"), nullable=False, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    expected_qty: Mapped[int] = mapped_column(Integer, nullable=False)
    received_qty: Mapped[int] = mapped_column(Integer, default=0)
    unit_cost: Mapped[float] = mapped_column(default=0.0)
    location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"), nullable=True, index=True)

    asn = relationship("ASN", back_populates="items")
    product = relationship("Product")
    location = relationship("Location")

    @property
    def product_name(self) -> str:
        return self.product.display_name if self.product else ""

    @property
    def location_name(self) -> str:
        return self.location.path if self.location else ""

    @property
    def status(self) -> str:
        if self.asn and self.asn.status == "cancelled":
            return "cancelled"
        if self.received_qty >= self.expected_qty:
            return "received"
        if self.received_qty > 0:
            return "partial"
        return "pending"
