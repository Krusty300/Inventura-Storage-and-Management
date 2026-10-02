from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class BOMItemIn(BaseModel):
    product_id: int
    quantity: float = Field(gt=0)
    position: int = 0


class BOMCreate(BaseModel):
    product_id: int
    name: str = ""
    description: str = ""
    items: list[BOMItemIn] = Field(min_length=1)


class BOMUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None
    items: Optional[list[BOMItemIn]] = None


class BOMItemOut(BaseModel):
    id: int
    bom_id: int
    product_id: int
    quantity: float
    position: int
    product_name: str = ""
    unit_cost: float = 0.0

    class Config:
        from_attributes = True


class BOMOut(BaseModel):
    id: int
    product_id: int
    name: str
    description: str
    is_active: bool
    created_at: datetime
    updated_at: datetime
    product_name: str = ""
    item_count: int = 0
    total_cost: float = 0.0
    items: list[BOMItemOut] = []

    class Config:
        from_attributes = True
