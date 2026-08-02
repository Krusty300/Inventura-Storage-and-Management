from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class SerialNumberOut(BaseModel):
    id: int
    product_id: int
    serial_number: str
    lot_id: Optional[int] = None
    location_id: Optional[int] = None
    status: str
    sold_at: Optional[datetime] = None
    created_at: datetime
    product_name: str = ""
    lot_number: str = ""
    location_name: str = ""

    class Config:
        from_attributes = True
