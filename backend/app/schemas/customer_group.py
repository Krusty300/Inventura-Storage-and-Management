from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class CustomerGroupCreate(BaseModel):
    name: str
    description: str = ""
    price_list_id: Optional[int] = None


class CustomerGroupUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    price_list_id: Optional[int] = None


class CustomerGroupOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str
    price_list_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime
    customer_count: int = 0
