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
    product_name_snapshot: Mapped[str | None] = mapped_column(String(200), nullable=True)
    product_image_snapshot: Mapped[str | None] = mapped_column(String(500), nullable=True)
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
    # ``voided_by`` is a plain integer (not a FK) so a void survives a deleted
    # user account, which means the join has to be spelled out.
    voided_by_user = relationship(
        "User",
        primaryjoin="RestaurantTicketItem.voided_by == User.id",
        foreign_keys="RestaurantTicketItem.voided_by",
        viewonly=True,
        lazy="selectin",
    )

    @property
    def voided_by_username(self) -> str:
        """Who voided the line, so the audit trail survives a deleted account."""
        if self.voided_by_user is not None:
            return self.voided_by_user.username
        return ""

    @property
    def product_name(self) -> str:
        """Name frozen when the item was added, so history survives renames."""
        if self.product_name_snapshot:
            return self.product_name_snapshot
        return self.product.display_name if self.product else f"Product #{self.product_id}"

    @property
    def product_image(self) -> str:
        """Cover image frozen when the item was added, so history survives swaps."""
        if self.product_image_snapshot:
            return self.product_image_snapshot
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


class RestaurantPrepSession(Base):
    """One prep run at a station, e.g. the Friday grill batch.

    A session records what the kitchen claims it produced. The system then
    derives what it actually sold from the ticket items fired during the
    window, and the difference between the two is the prep variance: the
    signal that catches skimming a plate before it ever reaches a guest.
    """

    __tablename__ = "restaurant_prep_sessions"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    session_number: Mapped[str] = mapped_column(String(30), unique=True, nullable=False, index=True)
    station: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(20), default="open", index=True)
    notes: Mapped[str] = mapped_column(Text, default="")
    opened_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now(), index=True)
    closed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    # Plain integer, not a FK, so a close survives a deleted account.
    closed_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now())

    user = relationship("User")
    closed_by_user = relationship(
        "User",
        primaryjoin="RestaurantPrepSession.closed_by == User.id",
        foreign_keys="RestaurantPrepSession.closed_by",
        viewonly=True,
    )
    items = relationship(
        "RestaurantPrepSessionItem",
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="RestaurantPrepSessionItem.id",
    )

    @property
    def username(self) -> str:
        return self.user.username if self.user else ""

    @property
    def closed_by_username(self) -> str:
        return self.closed_by_user.username if self.closed_by_user is not None else ""


class RestaurantPrepSessionItem(Base):
    """A single dish inside a prep session.

    ``sold_qty``/``expected_remaining``/``variance`` are derived while the
    session is open and frozen on close, so a closed session is an immutable
    audit record rather than a number that drifts when a late void lands.
    """

    __tablename__ = "restaurant_prep_session_items"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("restaurant_prep_sessions.id"), nullable=False, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    product_name_snapshot: Mapped[str | None] = mapped_column(String(200), nullable=True)
    prepped_qty: Mapped[int] = mapped_column(Integer, default=0)
    waste_qty: Mapped[int] = mapped_column(Integer, default=0)
    counted_qty: Mapped[int | None] = mapped_column(Integer, nullable=True)
    waste_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    sold_qty: Mapped[int | None] = mapped_column(Integer, nullable=True)
    expected_remaining: Mapped[int | None] = mapped_column(Integer, nullable=True)
    variance: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now())

    session = relationship("RestaurantPrepSession", back_populates="items")
    product = relationship("Product")

    @property
    def product_name(self) -> str:
        """Name frozen when the batch was recorded, so history survives renames."""
        if self.product_name_snapshot:
            return self.product_name_snapshot
        return self.product.display_name if self.product else f"Product #{self.product_id}"


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
    cash_sales: Mapped[float] = mapped_column(Numeric(12, 2), default=0.0)
    opening_float: Mapped[float] = mapped_column(Numeric(12, 2), default=0.0)
    paid_in: Mapped[float] = mapped_column(Numeric(12, 2), default=0.0)
    paid_out: Mapped[float] = mapped_column(Numeric(12, 2), default=0.0)
    prep_session_count: Mapped[int] = mapped_column(Integer, default=0)
    prepped_qty: Mapped[int] = mapped_column(Integer, default=0)
    prep_sold_qty: Mapped[int] = mapped_column(Integer, default=0)
    prep_waste_qty: Mapped[int] = mapped_column(Integer, default=0)
    prep_variance_qty: Mapped[int] = mapped_column(Integer, default=0)
    breakdown: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    notes: Mapped[str] = mapped_column(String(300), default="")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now(), index=True)

    user = relationship("User")

    @property
    def username(self) -> str:
        return self.user.username if self.user else ""