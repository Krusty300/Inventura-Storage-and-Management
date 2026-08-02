from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class LocationCreate(BaseModel):
    name: str
    code: Optional[str] = None
    location_type: str = "bin"
    parent_id: Optional[int] = None
    is_active: bool = True


class LocationUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    location_type: Optional[str] = None
    parent_id: Optional[int] = None
    is_active: Optional[bool] = None


class LocationOut(BaseModel):
    id: int
    name: str
    code: Optional[str] = None
    location_type: str = "bin"
    parent_id: Optional[int] = None
    is_active: bool
    created_at: datetime
    path: str = ""
    stock_line_count: int = 0
    lpn_count: int = 0
    total_quantity: int = 0
    stock_value: float = 0.0

    class Config:
        from_attributes = True
