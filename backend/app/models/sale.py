from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Sale(Base):
    __tablename__ = "sales"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    invoice_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    customer_id: Mapped[int | None] = mapped_column(ForeignKey("customers.id"), nullable=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    subtotal: Mapped[float] = mapped_column(Numeric(10, 2), default=0.0)
    tax_amount: Mapped[float] = mapped_column(Numeric(10, 2), default=0.0)
    total_amount: Mapped[float] = mapped_column(Numeric(10, 2), default=0.0)
    status: Mapped[str] = mapped_column(String(20), default="completed")
    payment_method: Mapped[str] = mapped_column(String(20), default="cash")
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    customer = relationship("Customer", back_populates="sales")
    user = relationship("User", back_populates="sales")
    shipment = relationship("Shipment", back_populates="sale", uselist=False)
    items = relationship("SaleItem", back_populates="sale", cascade="all, delete-orphan")

    @property
    def customer_name(self) -> str:
        return self.customer.name if self.customer else "Walk-in Customer"

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
