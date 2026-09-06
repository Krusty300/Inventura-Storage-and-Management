from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class KitItemIn(BaseModel):
    product_id: int
    quantity: int = Field(gt=0)
    position: int = 0


class KitCreate(BaseModel):
    product_id: int
    name: str = ""
    description: str = ""
    version: str = ""
    discount_type: str = "fixed"
    discount_value: float = Field(default=0, ge=0)
    items: list[KitItemIn] = Field(min_length=1)


class KitUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    version: Optional[str] = None
    discount_type: Optional[str] = None
    discount_value: Optional[float] = Field(default=None, ge=0)
    is_active: Optional[bool] = None
    items: Optional[list[KitItemIn]] = None


class KitAssemble(BaseModel):
    quantity: int = Field(gt=0)
    location_id: int | None = None
    lot_number: str = ""


class KitDisassemble(BaseModel):
    quantity: int = Field(gt=0)
    location_id: int | None = None


class KitItemOut(BaseModel):
    id: int
    kit_id: int
    product_id: int
    quantity: int
    position: int
    product_name: str = ""
    unit_cost: float = 0.0
    unit_price: float = 0.0

    class Config:
        from_attributes = True


class KitOut(BaseModel):
    id: int
    product_id: int
    name: str
    description: str
    version: str
    discount_type: str
    discount_value: float
    is_active: bool
    created_at: datetime
    updated_at: datetime
    product_name: str = ""
    item_count: int = 0
    total_cost: float = 0.0
    retail_value: float = 0.0
    bundle_price: float = 0.0
    savings: float = 0.0
    items: list[KitItemOut] = []

    class Config:
        from_attributes = True