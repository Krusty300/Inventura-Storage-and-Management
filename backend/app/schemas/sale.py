from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class SaleItemCreate(BaseModel):
    product_id: int
    quantity: int = Field(gt=0)
    unit_price: float = Field(default=0.0, ge=0)


class SaleCreate(BaseModel):
    customer_id: Optional[int] = None
    items: list[SaleItemCreate]
    payment_method: str = "cash"
    notes: str = ""


class SaleItemOut(BaseModel):
    id: int
    product_id: int
    quantity: int
    unit_price: float
    product_name: str = ""
    line_total: float = 0.0

    class Config:
        from_attributes = True


class SaleOut(BaseModel):
    id: int
    invoice_number: str
    customer_id: Optional[int] = None
    user_id: int
    subtotal: float
    tax_amount: float
    total_amount: float
    status: str
    payment_method: str
    notes: str
    created_at: datetime
    updated_at: datetime
    customer_name: str = ""
    username: str = ""
    items: list[SaleItemOut] = []

    class Config:
        from_attributes = True
