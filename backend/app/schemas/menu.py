from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class MenuSectionCreate(BaseModel):
    name: str
    description: str = ""
    sort_order: int = Field(default=0, ge=0)
    is_active: bool = True


class MenuSectionUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    sort_order: Optional[int] = Field(default=None, ge=0)
    is_active: Optional[bool] = None


class MenuSectionOut(BaseModel):
    id: int
    name: str
    description: str
    sort_order: int
    is_active: bool
    created_at: datetime
    updated_at: datetime
    item_count: int = 0

    class Config:
        from_attributes = True


class MenuModifierOptionCreate(BaseModel):
    name: str
    price_delta: float = Field(default=0.0, ge=-9999)
    sort_order: int = Field(default=0, ge=0)
    is_active: bool = True


class MenuModifierGroupCreate(BaseModel):
    name: str
    min_select: int = Field(default=0, ge=0, le=99)
    max_select: int = Field(default=1, ge=1, le=99)
    is_required: bool = False
    sort_order: int = Field(default=0, ge=0)
    is_active: bool = True
    options: list[MenuModifierOptionCreate] = []


class MenuModifierGroupUpdate(BaseModel):
    name: Optional[str] = None
    min_select: Optional[int] = Field(default=None, ge=0, le=99)
    max_select: Optional[int] = Field(default=None, ge=1, le=99)
    is_required: Optional[bool] = None
    sort_order: Optional[int] = Field(default=None, ge=0)
    is_active: Optional[bool] = None


class MenuModifierOptionOut(BaseModel):
    id: int
    name: str
    price_delta: float
    sort_order: int
    is_active: bool

    class Config:
        from_attributes = True


class MenuModifierGroupOut(BaseModel):
    id: int
    product_id: int
    name: str
    min_select: int
    max_select: int
    is_required: bool
    sort_order: int
    is_active: bool
    option_count: int = 0
    options: list[MenuModifierOptionOut] = []

    class Config:
        from_attributes = True


class MenuItemOut(BaseModel):
    id: int
    name: str
    display_name: str
    description: str
    sku: str
    unit_price: float
    image_url: str = ""
    image: str = ""
    section_id: Optional[int] = None


class MenuSectionWithItems(BaseModel):
    id: Optional[int]
    name: str
    description: str = ""
    item_count: int = 0
    items: list[MenuItemOut] = []