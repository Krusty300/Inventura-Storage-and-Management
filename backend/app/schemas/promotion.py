from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class PromotionCreate(BaseModel):
    code: str = Field(min_length=1, max_length=50)
    description: str = ""
    discount_type: str = Field(pattern=r"^(percentage|fixed)$")
    value: float = Field(gt=0)
    min_qty: int = Field(default=0, ge=0)
    min_amount: float = Field(default=0, ge=0)
    valid_from: Optional[date] = None
    valid_to: Optional[date] = None
    max_uses: int = Field(default=0, ge=0)
    is_active: bool = True


class PromotionUpdate(BaseModel):
    code: Optional[str] = Field(default=None, min_length=1, max_length=50)
    description: Optional[str] = None
    discount_type: Optional[str] = Field(default=None, pattern=r"^(percentage|fixed)$")
    value: Optional[float] = Field(default=None, gt=0)
    min_qty: Optional[int] = Field(default=None, ge=0)
    min_amount: Optional[float] = Field(default=None, ge=0)
    valid_from: Optional[date] = None
    valid_to: Optional[date] = None
    max_uses: Optional[int] = Field(default=None, ge=0)
    is_active: Optional[bool] = None


class PromotionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    description: str
    discount_type: str
    value: float
    min_qty: int
    min_amount: float
    valid_from: Optional[date] = None
    valid_to: Optional[date] = None
    max_uses: int
    used_count: int
    is_active: bool
    created_at: datetime
    updated_at: datetime


class PromotionListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    description: str
    discount_type: str
    value: float
    min_qty: int
    min_amount: float
    valid_from: Optional[date] = None
    valid_to: Optional[date] = None
    max_uses: int
    used_count: int
    is_active: bool
    created_at: datetime
