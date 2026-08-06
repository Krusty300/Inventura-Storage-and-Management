from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class LPNCreate(BaseModel):
    lpn_number: Optional[str] = None
    lpn_type: str = "pallet"
    location_id: Optional[int] = None


class LPNUpdate(BaseModel):
    location_id: Optional[int] = None
    status: Optional[str] = None


class LPNContentOut(BaseModel):
    product_id: int
    product_name: str = ""
    lot_id: Optional[int] = None
    lot_number: str = ""
    quantity: int = 0


class LPNSerialOut(BaseModel):
    serial_id: int
    product_id: int
    product_name: str = ""
    serial_number: str = ""
    lot_number: str = ""
    status: str = ""
    location_name: str = ""


class LPNOut(BaseModel):
    id: int
    lpn_number: str
    lpn_type: str = "pallet"
    location_id: Optional[int] = None
    status: str = "active"
    created_at: datetime
    location_name: str = ""
    content_count: int = 0
    total_quantity: int = 0
    contents: list[LPNContentOut] = []
    serials: list[LPNSerialOut] = []

    class Config:
        from_attributes = True
