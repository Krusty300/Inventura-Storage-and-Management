from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class PriceListItemCreate(BaseModel):
    product_id: int
    price: float = Field(gt=0)
    min_qty: int = Field(default=1, ge=1)


class PriceListCreate(BaseModel):
    name: str
    description: str = ""
    valid_from: Optional[date] = None
    valid_to: Optional[date] = None
    is_default: bool = False
    items: list[PriceListItemCreate] = []


class PriceListUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    valid_from: Optional[date] = None
    valid_to: Optional[date] = None
    is_default: Optional[bool] = None
    is_active: Optional[bool] = None
    items: Optional[list[PriceListItemCreate]] = None


class PriceListItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    product_id: int
    price: float
    min_qty: int
    product_name: str = ""
    product_sku: str = ""


class PriceListOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str
    valid_from: Optional[date] = None
    valid_to: Optional[date] = None
    is_default: bool
    is_active: bool
    created_at: datetime
    updated_at: datetime
    items: list[PriceListItemOut] = []


class PriceListListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str
    valid_from: Optional[date] = None
    valid_to: Optional[date] = None
    is_default: bool
    is_active: bool
    item_count: int = 0
    created_at: datetime
