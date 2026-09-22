from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class RestaurantTableCreate(BaseModel):
    number: str
    zone: Optional[str] = None
    capacity: int = Field(default=4, ge=1, le=99)
    is_active: bool = True


class RestaurantTableUpdate(BaseModel):
    number: Optional[str] = None
    zone: Optional[str] = None
    capacity: Optional[int] = Field(default=None, ge=1, le=99)
    is_active: Optional[bool] = None


class RestaurantTableOut(BaseModel):
    id: int
    number: str
    zone: Optional[str] = None
    capacity: int
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


class TicketItemUpdate(BaseModel):
    quantity: Optional[int] = Field(default=None, gt=0)
    unit_price: Optional[float] = Field(default=None, ge=0)
    notes: Optional[str] = None


class TicketItemStatus(BaseModel):
    status: str


class TicketItemOut(BaseModel):
    id: int
    product_id: int
    quantity: int
    unit_price: float
    status: str
    sent_at: Optional[datetime] = None
    notes: str = ""
    product_name: str = ""
    product_image: str = ""
    sku: str = ""
    line_total: float = 0.0

    class Config:
        from_attributes = True


class TicketCreate(BaseModel):
    table_id: Optional[int] = None
    guest_count: int = Field(default=1, ge=1, le=99)
    customer_name: str = ""
    notes: str = ""


class TicketUpdate(BaseModel):
    table_id: Optional[int] = None
    guest_count: Optional[int] = Field(default=None, ge=1, le=99)
    customer_name: Optional[str] = None
    discount_amount: Optional[float] = Field(default=None, ge=0)
    notes: Optional[str] = None


class TicketSettle(BaseModel):
    payment_method: str = "cash"
    payment_provider: Optional[str] = None
    payment_phone: Optional[str] = None
    discount_amount: Optional[float] = Field(default=None, ge=0)
    notes: str = ""


class TicketOut(BaseModel):
    id: int
    ticket_number: str
    table_id: Optional[int] = None
    user_id: int
    status: str
    guest_count: int
    customer_name: str
    subtotal: float
    discount_amount: float
    tax_amount: float
    total_amount: float
    sale_id: Optional[int] = None
    notes: str
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
    items: list[TicketItemOut] = []

    class Config:
        from_attributes = True