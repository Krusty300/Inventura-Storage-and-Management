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

    class Config:
        from_attributes = True


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
    reason: str = Field(default="", max_length=200)


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
    notes: Optional[str] = None


class TicketSettle(BaseModel):
    payment_method: str = "cash"
    payment_provider: Optional[str] = None
    payment_phone: Optional[str] = None
    customer_id: Optional[int] = None
    customer_phone: Optional[str] = None
    discount_amount: Optional[float] = Field(default=None, ge=0)
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