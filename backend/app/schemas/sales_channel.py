from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class SalesChannelCreate(BaseModel):
    name: str
    type: str = "store"
    is_active: bool = True


class SalesChannelUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    is_active: Optional[bool] = None


class SalesChannelOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    type: str
    is_active: bool
    created_at: datetime
    updated_at: datetime
