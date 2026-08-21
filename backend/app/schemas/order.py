from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class OrderItemCreate(BaseModel):
    product_id: int
    quantity: int = Field(gt=0)
    unit_price: float = Field(default=0.0, ge=0)


class OrderCreate(BaseModel):
    supplier_id: Optional[int] = None
    notes: str = ""
    items: list[OrderItemCreate]


class OrderUpdate(BaseModel):
    status: Optional[str] = None
    notes: Optional[str] = None
    supplier_id: Optional[int] = None
    items: Optional[list[OrderItemCreate]] = None
    serial_numbers: Optional[dict[int, list[str]]] = None
    receive_locations: Optional[dict[int, int]] = None
    lot_numbers: Optional[dict[int, str]] = None
    expiry_dates: Optional[dict[int, str]] = None
    lpn_ids: Optional[dict[int, int]] = None


class OrderBulkEdit(BaseModel):
    ids: list[int]
    status: Optional[str] = None
    notes: Optional[str] = None


class ReorderLowStockRequest(BaseModel):
    product_ids: Optional[list[int]] = None


class OrderItemOut(BaseModel):
    id: int
    product_id: int
    quantity: int
    unit_price: float
    product_name: str = ""
    is_serialized: bool = False
    sku: str = ""

    class Config:
        from_attributes = True


class OrderOut(BaseModel):
    id: int
    order_number: str
    supplier_id: Optional[int] = None
    user_id: int
    status: str
    total_amount: float
    notes: str
    created_at: datetime
    updated_at: datetime
    supplier_name: str = ""
    username: str = ""
    items: list[OrderItemOut] = []

    class Config:
        from_attributes = True
