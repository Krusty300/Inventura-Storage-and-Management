from datetime import datetime

from sqlalchemy import ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.types import UTCDateTime


class Shipment(Base):
    __tablename__ = "shipments"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    shipment_number: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    customer_id: Mapped[int | None] = mapped_column(ForeignKey("customers.id"), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(20), default="draft")
    carrier: Mapped[str] = mapped_column(String(100), default="")
    tracking_number: Mapped[str] = mapped_column(String(200), default="")
    staging_location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"), nullable=True)
    sale_id: Mapped[int | None] = mapped_column(ForeignKey("sales.id"), nullable=True, unique=True, index=True)
    notes: Mapped[str] = mapped_column(Text, default="")
    ship_date: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    shipped_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now(), index=True)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now(), onupdate=func.now())

    customer = relationship("Customer")
    creator = relationship("User", foreign_keys=[created_by])
    staging_location = relationship("Location")
    sale = relationship("Sale", back_populates="shipment", uselist=False)
    items = relationship("ShipmentItem", back_populates="shipment", cascade="all, delete-orphan", order_by="ShipmentItem.id")

    @property
    def customer_name(self) -> str:
        return self.customer.name if self.customer else ""

    @property
    def invoice_number(self) -> str:
        return self.sale.invoice_number if self.sale else ""

    @property
    def total_amount(self) -> float:
        return float(self.sale.total_amount) if self.sale else 0.0

    @property
    def username(self) -> str:
        return self.creator.username if self.creator else ""

    @property
    def total_quantity(self) -> int:
        return sum(i.quantity_ordered for i in self.items)

    @property
    def total_picked(self) -> int:
        return sum(i.quantity_picked for i in self.items)


class ShipmentItem(Base):
    __tablename__ = "shipment_items"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    shipment_id: Mapped[int] = mapped_column(ForeignKey("shipments.id"), nullable=False, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    quantity_ordered: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    quantity_picked: Mapped[int] = mapped_column(Integer, default=0)
    quantity_packed: Mapped[int] = mapped_column(Integer, default=0)
    quantity_shipped: Mapped[int] = mapped_column(Integer, default=0)

    shipment = relationship("Shipment", back_populates="items")
    product = relationship("Product")

    @property
    def product_name(self) -> str:
        return self.product.display_name if self.product else ""

    @property
    def is_serialized(self) -> bool:
        return bool(self.product and self.product.is_serialized)
