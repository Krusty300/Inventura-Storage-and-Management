from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class ShipmentItemIn(BaseModel):
    product_id: int
    quantity: int = Field(gt=0)
    location_id: Optional[int] = None


class ShipmentCreate(BaseModel):
    customer_id: Optional[int] = None
    sale_id: Optional[int] = None
    carrier: str = ""
    tracking_number: str = ""
    notes: str = ""
    items: list[ShipmentItemIn] = Field(min_length=1)


class ShipmentUpdate(BaseModel):
    customer_id: Optional[int] = None
    sale_id: Optional[int] = None
    carrier: Optional[str] = None
    tracking_number: Optional[str] = None
    notes: Optional[str] = None


class ShipmentPickItem(BaseModel):
    product_id: int
    serial_ids: Optional[list[int]] = None


class ShipmentPickRequest(BaseModel):
    items: list[ShipmentPickItem] = Field(default_factory=list)


class ShipmentItemOut(BaseModel):
    id: int
    shipment_id: int
    product_id: int
    location_id: Optional[int] = None
    quantity_ordered: int
    quantity_picked: int
    quantity_packed: int
    quantity_shipped: int
    product_name: str = ""
    location_name: str = ""
    is_serialized: bool = False

    class Config:
        from_attributes = True


class ShipmentOut(BaseModel):
    id: int
    shipment_number: str
    customer_id: Optional[int] = None
    status: str
    carrier: str
    tracking_number: str
    staging_location_id: Optional[int] = None
    sale_id: Optional[int] = None
    notes: str
    ship_date: Optional[datetime] = None
    shipped_at: Optional[datetime] = None
    created_by: int
    created_at: datetime
    updated_at: datetime
    customer_name: str = ""
    username: str = ""
    invoice_number: str = ""
    total_amount: float = 0.0
    total_quantity: int = 0
    total_picked: int = 0
    items: list[ShipmentItemOut] = []

    class Config:
        from_attributes = True
