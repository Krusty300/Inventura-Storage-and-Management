from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator


class RestaurantTableCreate(BaseModel):
    number: str
    zone: Optional[str] = None
    capacity: int = Field(default=4, ge=1, le=99)
    pos_x: int = 0
    pos_y: int = 0
    is_active: bool = True


class RestaurantTableUpdate(BaseModel):
    number: Optional[str] = None
    zone: Optional[str] = None
    capacity: Optional[int] = Field(default=None, ge=1, le=99)
    pos_x: Optional[int] = None
    pos_y: Optional[int] = None
    is_active: Optional[bool] = None


class RestaurantTableOut(BaseModel):
    id: int
    number: str
    zone: Optional[str] = None
    capacity: int
    pos_x: int = 0
    pos_y: int = 0
    is_active: bool
    created_at: datetime
    updated_at: datetime
    status: str = "available"
    active_ticket_id: Optional[int] = None
    active_ticket_number: str = ""
    active_ticket_username: str = ""
    service_requested_at: Optional[datetime] = None
    service_request: Optional[str] = None

    class Config:
        from_attributes = True


class GuestServiceRequest(BaseModel):
    """Guest-side service flag raised from the QR menu."""

    request: str = Field(default="waiter", max_length=20)


class TicketItemCreate(BaseModel):
    product_id: int
    quantity: int = Field(gt=0)
    unit_price: float = Field(default=0.0, ge=0)
    notes: str = ""
    modifiers: list[dict] = []


class TicketItemUpdate(BaseModel):
    quantity: Optional[int] = Field(default=None, gt=0)
    unit_price: Optional[float] = Field(default=None, ge=0)
    notes: Optional[str] = None
    modifiers: Optional[list[dict]] = None


class TicketItemStatus(BaseModel):
    status: str


class TicketItemVoidCreate(BaseModel):
    reason: str = Field(min_length=3, max_length=200)

    @field_validator("reason")
    @classmethod
    def _reason_not_blank(cls, v: str) -> str:
        reason = (v or "").strip()
        if len(reason) < 3:
            raise ValueError("A reason is required to void a ticket item")
        return reason


class TicketSplitCreate(BaseModel):
    table_id: Optional[int] = None
    guest_count: Optional[int] = Field(default=None, ge=1, le=99)
    customer_name: str = ""
    customer_phone: str = ""
    item_ids: list[int] = Field(min_length=1)
    notes: str = ""


class TicketItemOut(BaseModel):
    id: int
    product_id: int
    quantity: int
    unit_price: float
    base_unit_price: float = 0.0
    modifiers: list[dict] = Field(default_factory=list)
    status: str
    sent_at: Optional[datetime] = None
    notes: str = ""
    product_name: str = ""
    product_image: str = ""
    sku: str = ""
    line_total: float = 0.0
    voided_at: Optional[datetime] = None
    void_reason: Optional[str] = None
    voided_by: Optional[int] = None
    voided_by_username: str = ""

    @field_validator("modifiers", mode="before")
    @classmethod
    def _coerce_modifiers(cls, v):
        return v or []

    class Config:
        from_attributes = True


class TicketCreate(BaseModel):
    table_id: Optional[int] = None
    reservation_id: Optional[int] = None
    guest_count: int = Field(default=1, ge=1, le=99)
    customer_name: str = ""
    customer_phone: str = ""
    notes: str = ""


class TicketUpdate(BaseModel):
    table_id: Optional[int] = None
    guest_count: Optional[int] = Field(default=None, ge=1, le=99)
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    discount_amount: Optional[float] = Field(default=None, ge=0)
    discount_reason: Optional[str] = Field(default=None, max_length=200)
    notes: Optional[str] = None


class TicketSettle(BaseModel):
    payment_method: str = "cash"
    payment_provider: Optional[str] = None
    payment_phone: Optional[str] = None
    customer_id: Optional[int] = None
    customer_phone: Optional[str] = None
    discount_amount: Optional[float] = Field(default=None, ge=0)
    discount_reason: str = Field(default="", max_length=200)
    tip_amount: float = Field(default=0.0, ge=0, le=1_000_000)
    notes: str = ""


class TicketOut(BaseModel):
    id: int
    ticket_number: str
    table_id: Optional[int] = None
    user_id: int
    status: str
    guest_count: int
    customer_name: str
    customer_phone: str = ""
    subtotal: float
    discount_amount: float
    tax_amount: float
    total_amount: float
    tip_amount: float = 0.0
    sale_id: Optional[int] = None
    notes: str
    split_group: Optional[str] = None
    split_parent_id: Optional[int] = None
    split_parent_number: str = ""
    opened_at: datetime
    settled_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    table_number: str = ""
    username: str = ""
    item_count: int = 0
    items: list[TicketItemOut] = []

    class Config:
        from_attributes = True


class KitchenTicketOut(BaseModel):
    id: int
    ticket_number: str
    table_number: str = ""
    table_zone: str = ""
    guest_count: int
    status: str
    stage: str = ""
    earliest_sent_at: Optional[datetime] = None
    notes: str = ""
    items: list[TicketItemOut] = []

    class Config:
        from_attributes = True


class GuestOrderItem(BaseModel):
    product_id: int
    quantity: int = Field(gt=0, le=99)
    notes: str = ""
    modifiers: list[dict] = []


class GuestOrderCreate(BaseModel):
    table_id: Optional[int] = None
    guest_name: str = ""
    guest_phone: str = ""
    guest_count: int = Field(default=1, ge=1, le=99)
    notes: str = ""
    items: list[GuestOrderItem] = Field(min_length=1, max_length=50)


class GuestOrderOut(BaseModel):
    id: int
    token: str = ""
    ticket_number: str
    table_id: Optional[int] = None
    table_number: str = ""
    status: str
    guest_count: int
    guest_name: str = ""
    guest_phone: str = ""
    subtotal: float
    total_amount: float
    opened_at: datetime
    items: list[TicketItemOut] = []

    class Config:
        from_attributes = True


class ReservationCreate(BaseModel):
    table_id: Optional[int] = None
    guest_name: str
    guest_phone: str = ""
    guest_count: int = Field(default=1, ge=1, le=99)
    reserved_at: datetime
    duration_minutes: int = Field(default=90, ge=15, le=1440)
    notes: str = ""


class ReservationUpdate(BaseModel):
    table_id: Optional[int] = None
    guest_name: Optional[str] = None
    guest_phone: Optional[str] = None
    guest_count: Optional[int] = Field(default=None, ge=1, le=99)
    reserved_at: Optional[datetime] = None
    duration_minutes: Optional[int] = Field(default=None, ge=15, le=1440)
    notes: Optional[str] = None
    status: Optional[str] = None


class ReservationStatusUpdate(BaseModel):
    status: str


class ReservationOut(BaseModel):
    id: int
    reservation_number: str
    table_id: Optional[int] = None
    user_id: int
    guest_name: str
    guest_phone: str = ""
    guest_count: int
    reserved_at: datetime
    duration_minutes: int = 90
    status: str
    notes: str = ""
    ticket_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime
    table_number: str = ""
    username: str = ""

    class Config:
        from_attributes = True


class ShiftPreview(BaseModel):
    period_start: datetime
    period_end: datetime
    ticket_count: int = 0
    total_sales: float = 0.0
    expected_cash: float = 0.0
    cash_tips: float = 0.0
    cash_sales: float = 0.0
    open_tickets: int = 0
    paying_tickets: int = 0
    payment_review_count: int = 0
    payment_review_amount: float = 0.0
    by_method: dict[str, dict] = {}
    open_prep_sessions: int = 0
    prep_session_count: int = 0
    prepped_qty: int = 0
    prep_sold_qty: int = 0
    prep_waste_qty: int = 0
    prep_variance_qty: int = 0


class ShiftCloseCreate(BaseModel):
    """Cash-drawer reconciliation input.

    The shift window is always derived server-side from the caller's previous
    close, so a client cannot shrink it to fake a balanced drawer.
    """

    counted_cash: float = Field(ge=0)
    opening_float: float = Field(default=0.0, ge=0, le=10_000_000)
    paid_in: float = Field(default=0.0, ge=0, le=10_000_000)
    paid_out: float = Field(default=0.0, ge=0, le=10_000_000)
    notes: str = Field(default="", max_length=300)


class ShiftCloseOut(BaseModel):
    id: int
    user_id: int
    username: str = ""
    period_start: datetime
    period_end: datetime
    ticket_count: int = 0
    total_sales: float = 0.0
    expected_cash: float = 0.0
    counted_cash: float = 0.0
    variance: float = 0.0
    cash_tips: float = 0.0
    cash_sales: float = 0.0
    opening_float: float = 0.0
    paid_in: float = 0.0
    paid_out: float = 0.0
    prep_session_count: int = 0
    prepped_qty: int = 0
    prep_sold_qty: int = 0
    prep_waste_qty: int = 0
    prep_variance_qty: int = 0
    breakdown: Optional[dict] = None
    notes: str = ""
    created_at: datetime

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Prep accounting
# ---------------------------------------------------------------------------


class PrepSessionCreate(BaseModel):
    """Open a prep run at one station.

    Only one session may be open per station, so two shifts cannot both claim
    the same batch of plates.
    """

    station: str = Field(min_length=2, max_length=60)
    notes: str = Field(default="", max_length=300)

    @field_validator("station", "notes")
    @classmethod
    def _strip(cls, value: str) -> str:
        return value.strip()


class PrepSessionItemCreate(BaseModel):
    """Record a prepped batch. Repeating a product adds to the same line."""

    product_id: int
    quantity: int = Field(gt=0, le=10_000)


class PrepSessionWasteCreate(BaseModel):
    """Write off part of a batch.

    Waste is declared separately from prepped so that a late correction to the
    batch size can never quietly absorb undeclared loss: the variance is
    ``counted - (prepped - sold - waste)`` and a bad waste number shows up as
    a bad variance.
    """

    quantity: int = Field(gt=0, le=10_000)
    reason: str = Field(min_length=3, max_length=300)
    product_id: Optional[int] = None

    @field_validator("reason")
    @classmethod
    def _strip_reason(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 3:
            raise ValueError("A waste reason of at least 3 characters is required")
        return value


class PrepSessionCountCreate(BaseModel):
    """Leftover count for one prepped dish at close."""

    product_id: int
    counted_qty: int = Field(ge=0, le=10_000)


class PrepSessionCloseCreate(BaseModel):
    counted: list[PrepSessionCountCreate] = []
    notes: str = Field(default="", max_length=300)


class PrepStationItemOut(BaseModel):
    """A dish offered for prep at a station, with its par level."""

    product_id: int
    name: str
    station: str = ""
    par_qty: int = 0
    warn_qty: int = 0
    # What is on the pass right now across open sessions at this station.
    available_qty: int = 0
    sold_qty: int = 0
    is_below_warn: bool = False


class PrepStationOut(BaseModel):
    station: str
    par_qty: int = 0
    items: list[PrepStationItemOut] = []


class PrepSessionItemOut(BaseModel):
    id: int
    product_id: int
    product_name: str = ""
    prepped_qty: int = 0
    sold_qty: int = 0
    waste_qty: int = 0
    counted_qty: Optional[int] = None
    expected_remaining: Optional[int] = None
    variance: Optional[int] = None
    waste_reason: str = ""
    created_at: datetime

    class Config:
        from_attributes = True


class PrepSessionOut(BaseModel):
    id: int
    session_number: str
    station: str
    user_id: int
    username: str = ""
    status: str = "open"
    notes: str = ""
    opened_at: datetime
    closed_at: Optional[datetime] = None
    closed_by: Optional[int] = None
    closed_by_username: str = ""
    prepped_qty: int = 0
    sold_qty: int = 0
    waste_qty: int = 0
    expected_remaining: int = 0
    variance: int = 0
    item_count: int = 0
    items: list[PrepSessionItemOut] = []
    created_at: datetime

    class Config:
        from_attributes = True


class PrepLevelUpdate(BaseModel):
    """Manager control over what gets prepped and what counts as low."""

    prep_station: Optional[str] = Field(default=None, max_length=60)
    par_qty: Optional[int] = Field(default=None, ge=0, le=100_000)
    warn_qty: Optional[int] = Field(default=None, ge=0, le=100_000)

    @field_validator("prep_station")
    @classmethod
    def _strip_station(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None
