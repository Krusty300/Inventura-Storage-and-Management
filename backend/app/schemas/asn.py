from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, Field, model_validator


class ASNItemCreate(BaseModel):
    product_id: int
    expected_qty: int = Field(gt=0)
    unit_cost: float = Field(default=0.0, ge=0)
    location_id: Optional[int] = None


class ASNCreate(BaseModel):
    supplier_id: Optional[int] = None
    order_id: Optional[int] = None
    expected_arrival: Optional[date] = None
    notes: str = ""
    items: list[ASNItemCreate] = Field(min_length=1)


class ASNUpdate(BaseModel):
    status: Optional[str] = None
    expected_arrival: Optional[date] = None
    notes: Optional[str] = None


class ASNReceiveItem(BaseModel):
    product_id: int
    received_qty: int = Field(gt=0)
    unit_cost: float = Field(default=0.0, ge=0)
    lot_number: str = ""
    expiry_date: Optional[date] = None
    location_id: Optional[int] = None
    lpn_id: Optional[int] = None
    serial_numbers: list[str] = []

    @model_validator(mode="after")
    def _serial_numbers_match_quantity(self):
        if self.serial_numbers and len(self.serial_numbers) != self.received_qty:
            raise ValueError(
                f"Serialized receive lines require one serial number per unit "
                f"({self.received_qty} expected, {len(self.serial_numbers)} provided)"
            )
        if self.serial_numbers and any(not sn.strip() for sn in self.serial_numbers):
            raise ValueError("Serial numbers cannot be empty")
        return self


class ASNReceiveRequest(BaseModel):
    items: list[ASNReceiveItem] = Field(min_length=1)
    notes: str = ""


class ASNItemOut(BaseModel):
    id: int
    asn_id: int
    product_id: int
    expected_qty: int
    received_qty: int
    unit_cost: float
    location_id: Optional[int] = None
    product_name: str = ""
    location_name: str = ""
    status: str = "pending"

    class Config:
        from_attributes = True


class ASNOut(BaseModel):
    id: int
    asn_number: str
    supplier_id: Optional[int] = None
    order_id: Optional[int] = None
    user_id: int
    status: str
    expected_arrival: Optional[date] = None
    notes: str
    created_at: datetime
    received_at: Optional[datetime] = None
    supplier_name: str = ""
    order_number: str = ""
    username: str = ""
    total_expected: int = 0
    total_received: int = 0
    items: list[ASNItemOut] = []

    class Config:
        from_attributes = True
