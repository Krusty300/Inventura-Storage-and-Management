from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, field_validator

LOT_STATUSES = {"in_stock", "quarantined", "expired"}


class LotUpdate(BaseModel):
    status: Optional[str] = None
    expiry_date: Optional[date] = None
    supplier_id: Optional[int] = None

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if v not in LOT_STATUSES:
            raise ValueError(f"status must be one of {LOT_STATUSES}")
        return v


class LotOut(BaseModel):
    id: int
    product_id: int
    lot_number: str
    supplier_id: Optional[int] = None
    expiry_date: Optional[date] = None
    received_date: date
    status: str
    created_at: datetime
    product_name: str = ""
    supplier_name: str = ""
    on_hand: int = 0
    serial_count: int = 0

    class Config:
        from_attributes = True
