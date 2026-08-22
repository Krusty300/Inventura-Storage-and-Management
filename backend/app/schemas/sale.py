from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class SaleItemCreate(BaseModel):
    product_id: int
    quantity: int = Field(gt=0)
    unit_price: float = Field(default=0.0, ge=0)
    location_id: Optional[int] = None


class SaleCreate(BaseModel):
    customer_id: Optional[int] = None
    channel_id: Optional[int] = None
    items: list[SaleItemCreate]
    payment_method: str = "cash"
    payment_provider: Optional[str] = None
    payment_reference: Optional[str] = None
    payment_phone: Optional[str] = None
    payment_provider_amount: Optional[float] = Field(default=None, ge=0)
    currency: Optional[str] = None
    currency_symbol: Optional[str] = None
    discount_amount: float = Field(default=0.0, ge=0)
    promo_code: Optional[str] = None
    notes: str = ""


class RefundRequest(BaseModel):
    refund_method: Optional[str] = None
    refund_provider: Optional[str] = None


class SaleBulkEdit(BaseModel):
    ids: list[int]
    notes: Optional[str] = None
    status: Optional[str] = None
    payment_status: Optional[str] = None


class SaleItemOut(BaseModel):
    id: int
    product_id: int
    quantity: int
    unit_price: float
    product_name: str = ""
    line_total: float = 0.0
    location: str = ""
    locations: list[str] = []

    class Config:
        from_attributes = True


class SaleOut(BaseModel):
    id: int
    invoice_number: str
    customer_id: Optional[int] = None
    user_id: int
    channel_id: Optional[int] = None
    subtotal: float
    discount_amount: float
    tax_amount: float
    total_amount: float
    status: str
    payment_method: str
    payment_provider: Optional[str] = None
    payment_reference: Optional[str] = None
    payment_phone: Optional[str] = None
    payment_provider_amount: Optional[float] = None
    currency: Optional[str] = None
    currency_symbol: Optional[str] = None
    payment_status: Optional[str] = None
    payment_checkout_request_id: Optional[str] = None
    refund_status: Optional[str] = None
    refunded_at: Optional[datetime] = None
    refund_method: Optional[str] = None
    refund_provider: Optional[str] = None
    refund_checkout_request_id: Optional[str] = None
    notes: str
    promo_code: Optional[str] = None
    promo_discount: float = 0.0
    created_at: datetime
    updated_at: datetime
    customer_name: str = ""
    channel_name: str = ""
    username: str = ""
    items: list[SaleItemOut] = []
    locations: list[str] = []

    class Config:
        from_attributes = True
