from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, model_validator


class CycleCountItemCreate(BaseModel):
    product_id: int
    expected_qty: int = Field(ge=0, default=0)


class CycleCountCreate(BaseModel):
    location_id: Optional[int] = None
    notes: str = ""
    items: list[CycleCountItemCreate] = Field(min_length=1)


class CycleCountUpdate(BaseModel):
    status: Optional[str] = None
    notes: Optional[str] = None


class CycleCountItemCount(BaseModel):
    product_id: int
    counted_qty: int = Field(ge=0)


class CycleCountSubmit(BaseModel):
    items: list[CycleCountItemCount] = Field(min_length=1)

    @model_validator(mode="after")
    def _unique_products(self):
        ids = [i.product_id for i in self.items]
        if len(ids) != len(set(ids)):
            raise ValueError("Each product may only be counted once")
        return self


class CycleCountItemOut(BaseModel):
    id: int
    cycle_count_id: int
    product_id: int
    expected_qty: int
    counted_qty: Optional[int] = None
    variance: int = 0
    status: str = "pending"
    product_name: str = ""

    class Config:
        from_attributes = True


class CycleCountOut(BaseModel):
    id: int
    cc_number: str
    location_id: Optional[int] = None
    created_by: int
    status: str
    notes: str
    created_at: datetime
    completed_at: Optional[datetime] = None
    location_name: str = ""
    username: str = ""
    has_variance: bool = False
    total_expected: int = 0
    total_variance: int = 0
    items: list[CycleCountItemOut] = []

    class Config:
        from_attributes = True
