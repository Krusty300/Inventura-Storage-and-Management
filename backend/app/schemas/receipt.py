from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, Field, model_validator


class ReceiptItemCreate(BaseModel):
    product_id: int
    quantity: int = Field(gt=0)
    unit_cost: float = Field(default=0.0, ge=0)
    lot_number: str = ""
    expiry_date: Optional[date] = None
    location_id: Optional[int] = None
    lpn_id: Optional[int] = None
    serial_numbers: list[str] = []

    @model_validator(mode="after")
    def _serial_numbers_match_quantity(self):
        if self.serial_numbers and len(self.serial_numbers) != self.quantity:
            raise ValueError(
                f"Serialized receipt lines require one serial number per unit "
                f"({self.quantity} expected, {len(self.serial_numbers)} provided)"
            )
        if self.serial_numbers and any(not sn.strip() for sn in self.serial_numbers):
            raise ValueError("Serial numbers cannot be empty")
        return self


class ReceiptCreate(BaseModel):
    supplier_id: Optional[int] = None
    reference: str = ""
    notes: str = ""
    items: list[ReceiptItemCreate] = Field(min_length=1)


class ReceiptItemOut(BaseModel):
    id: int
    receipt_id: int
    product_id: int
    quantity: int
    unit_cost: float
    lot_id: Optional[int] = None
    location_id: Optional[int] = None
    product_name: str = ""
    lot_number: str = ""
    location_name: str = ""

    class Config:
        from_attributes = True


class ReceiptOut(BaseModel):
    id: int
    receipt_number: str
    supplier_id: Optional[int] = None
    user_id: int
    reference: str
    notes: str
    total_quantity: int
    total_cost: float
    created_at: datetime
    supplier_name: str = ""
    username: str = ""
    items: list[ReceiptItemOut] = []

    class Config:
        from_attributes = True
