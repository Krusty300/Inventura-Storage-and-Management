from datetime import datetime

from sqlalchemy import ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.types import UTCDateTime


class Sale(Base):
    __tablename__ = "sales"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    invoice_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    customer_id: Mapped[int | None] = mapped_column(ForeignKey("customers.id"), nullable=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    channel_id: Mapped[int | None] = mapped_column(ForeignKey("sales_channels.id"), nullable=True, index=True)
    subtotal: Mapped[float] = mapped_column(Numeric(10, 2), default=0.0)
    discount_amount: Mapped[float] = mapped_column(Numeric(10, 2), default=0.0)
    tax_amount: Mapped[float] = mapped_column(Numeric(10, 2), default=0.0)
    total_amount: Mapped[float] = mapped_column(Numeric(10, 2), default=0.0)
    status: Mapped[str] = mapped_column(String(20), default="completed", index=True)
    payment_method: Mapped[str] = mapped_column(String(20), default="cash")
    payment_provider: Mapped[str | None] = mapped_column(String(20), nullable=True, default=None)
    payment_reference: Mapped[str | None] = mapped_column(String(100), nullable=True, default=None)
    payment_phone: Mapped[str | None] = mapped_column(String(30), nullable=True, default=None)
    payment_provider_amount: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True, default=None)
    currency: Mapped[str | None] = mapped_column(String(10), nullable=True, default=None)
    currency_symbol: Mapped[str | None] = mapped_column(String(10), nullable=True, default=None)
    payment_status: Mapped[str | None] = mapped_column(String(20), nullable=True, default=None)
    payment_checkout_request_id: Mapped[str | None] = mapped_column(String(64), nullable=True, default=None)
    refund_status: Mapped[str | None] = mapped_column(String(20), nullable=True, default=None)
    refunded_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True, default=None)
    refund_method: Mapped[str | None] = mapped_column(String(20), nullable=True, default=None)
    refund_provider: Mapped[str | None] = mapped_column(String(20), nullable=True, default=None)
    refund_checkout_request_id: Mapped[str | None] = mapped_column(String(64), nullable=True, default=None)
    promo_code: Mapped[str | None] = mapped_column(String(50), nullable=True, default=None)
    promo_discount: Mapped[float] = mapped_column(Numeric(10, 2), default=0.0)
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now(), index=True)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now(), onupdate=func.now())

    customer = relationship("Customer", back_populates="sales")
    user = relationship("User", back_populates="sales")
    channel = relationship("SalesChannel")
    shipment = relationship("Shipment", back_populates="sale", uselist=False)
    items = relationship("SaleItem", back_populates="sale", cascade="all, delete-orphan")

    @property
    def customer_name(self) -> str:
        return self.customer.name if self.customer else "Walk-in Customer"

    @property
    def channel_name(self) -> str:
        return self.channel.name if self.channel else ""

    @property
    def username(self) -> str:
        return self.user.username if self.user else ""


class SaleItem(Base):
    __tablename__ = "sale_items"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    sale_id: Mapped[int] = mapped_column(ForeignKey("sales.id"), nullable=False, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_price: Mapped[float] = mapped_column(Numeric(10, 2), default=0.0)

    sale = relationship("Sale", back_populates="items")
    product = relationship("Product", back_populates="sale_items")

    @property
    def product_name(self) -> str:
        return self.product.display_name if self.product else ""

    @property
    def product_image(self) -> str:
        return self.product.image_url if self.product else ""

    @property
    def line_total(self) -> float:
        return float(self.unit_price) * self.quantity
