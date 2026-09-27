from datetime import datetime

from sqlalchemy import JSON, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.types import UTCDateTime


class RestaurantTable(Base):
    __tablename__ = "restaurant_tables"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    number: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    zone: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    capacity: Mapped[int] = mapped_column(Integer, default=4)
    pos_x: Mapped[int] = mapped_column(Integer, default=0)
    pos_y: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(default=True)
    service_requested_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    service_request: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now(), index=True)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now(), onupdate=func.now())

    tickets = relationship("RestaurantTicket", back_populates="table")
    reservations = relationship("RestaurantReservation", back_populates="table", order_by="RestaurantReservation.id")

    @property
    def active_ticket(self) -> "RestaurantTicket | None":
        for t in self.tickets:
            if t.status not in ("settled", "cancelled"):
                return t
        return None


class RestaurantReservation(Base):
    __tablename__ = "restaurant_reservations"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    reservation_number: Mapped[str] = mapped_column(String(30), unique=True, nullable=False, index=True)
    table_id: Mapped[int | None] = mapped_column(ForeignKey("restaurant_tables.id"), nullable=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    guest_name: Mapped[str] = mapped_column(String(120), nullable=False)
    guest_phone: Mapped[str] = mapped_column(String(40), default="")
    guest_count: Mapped[int] = mapped_column(Integer, default=1)
    reserved_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, index=True)
    duration_minutes: Mapped[int] = mapped_column(Integer, default=90)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    notes: Mapped[str] = mapped_column(Text, default="")
    ticket_id: Mapped[int | None] = mapped_column(ForeignKey("restaurant_tickets.id"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now(), index=True)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now(), onupdate=func.now())

    table = relationship("RestaurantTable", back_populates="reservations")
    user = relationship("User")
    ticket = relationship("RestaurantTicket")

    @property
    def table_number(self) -> str:
        return self.table.number if self.table else ""

    @property
    def username(self) -> str:
        return self.user.username if self.user else ""


class RestaurantTicket(Base):
    __tablename__ = "restaurant_tickets"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    ticket_number: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    table_id: Mapped[int | None] = mapped_column(ForeignKey("restaurant_tables.id"), nullable=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(20), default="open", index=True)
    guest_count: Mapped[int] = mapped_column(Integer, default=1)
    customer_name: Mapped[str] = mapped_column(String(120), default="")
    customer_phone: Mapped[str] = mapped_column(String(40), default="")
    guest_token: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    subtotal: Mapped[float] = mapped_column(Numeric(10, 2), default=0.0)
    discount_amount: Mapped[float] = mapped_column(Numeric(10, 2), default=0.0)
    tax_amount: Mapped[float] = mapped_column(Numeric(10, 2), default=0.0)
    total_amount: Mapped[float] = mapped_column(Numeric(10, 2), default=0.0)
    tip_amount: Mapped[float] = mapped_column(Numeric(10, 2), default=0.0)
    sale_id: Mapped[int | None] = mapped_column(ForeignKey("sales.id"), nullable=True, index=True)
    notes: Mapped[str] = mapped_column(Text, default="")
    split_group: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    split_parent_id: Mapped[int | None] = mapped_column(ForeignKey("restaurant_tickets.id"), nullable=True, index=True)
    opened_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now(), index=True)
    settled_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now(), onupdate=func.now())

    table = relationship("RestaurantTable", back_populates="tickets")
    user = relationship("User")
    sale = relationship("Sale")
    split_parent = relationship("RestaurantTicket", remote_side=[id], foreign_keys=[split_parent_id])
    items = relationship(
        "RestaurantTicketItem",
        back_populates="ticket",
        cascade="all, delete-orphan",
        order_by="RestaurantTicketItem.id",
    )

    @property
    def table_number(self) -> str:
        return self.table.number if self.table else "Takeaway"

    @property
    def username(self) -> str:
        return self.user.username if self.user else ""

    @property
    def split_parent_number(self) -> str:
        return self.split_parent.ticket_number if self.split_parent else ""

    @property
    def item_count(self) -> int:
        return sum(i.quantity for i in self.items if i.status != "voided")


class RestaurantTicketItem(Base):
    __tablename__ = "restaurant_ticket_items"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("restaurant_tickets.id"), nullable=False, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_price: Mapped[float] = mapped_column(Numeric(10, 2), default=0.0)
    base_unit_price: Mapped[float] = mapped_column(Numeric(10, 2), default=0.0)
    modifiers: Mapped[list | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    notes: Mapped[str] = mapped_column(Text, default="")
    sent_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    ready_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    served_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    voided_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    voided_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    void_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now())

    ticket = relationship("RestaurantTicket", back_populates="items")
    product = relationship("Product")

    @property
    def product_name(self) -> str:
        return self.product.display_name if self.product else f"Product #{self.product_id}"

    @property
    def product_image(self) -> str:
        if not self.product:
            return ""
        if self.product.images:
            return self.product.images[0].url
        return self.product.image_url

    @property
    def sku(self) -> str:
        return self.product.sku if self.product else ""

    @property
    def line_total(self) -> float:
        return float(self.unit_price) * self.quantity


class RestaurantShiftClose(Base):
    """Cash-drawer reconciliation for one cashier's shift."""

    __tablename__ = "restaurant_shift_closes"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    period_start: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    period_end: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    ticket_count: Mapped[int] = mapped_column(Integer, default=0)
    total_sales: Mapped[float] = mapped_column(Numeric(12, 2), default=0.0)
    expected_cash: Mapped[float] = mapped_column(Numeric(12, 2), default=0.0)
    counted_cash: Mapped[float] = mapped_column(Numeric(12, 2), default=0.0)
    variance: Mapped[float] = mapped_column(Numeric(12, 2), default=0.0)
    cash_tips: Mapped[float] = mapped_column(Numeric(12, 2), default=0.0)
    breakdown: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    notes: Mapped[str] = mapped_column(String(300), default="")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now(), index=True)

    user = relationship("User")

    @property
    def username(self) -> str:
        return self.user.username if self.user else ""