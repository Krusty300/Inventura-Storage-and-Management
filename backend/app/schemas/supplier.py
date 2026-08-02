from datetime import datetime
from typing import Optional
import re

from pydantic import BaseModel, ConfigDict, field_validator

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _clean_email(v: Optional[str]) -> str:
    v = (v or "").strip()
    if v and not _EMAIL_RE.match(v):
        raise ValueError("Invalid email address")
    return v


class SupplierCreate(BaseModel):
    name: str
    contact_person: str = ""
    email: str = ""
    phone: str = ""
    address: str = ""
    notes: str = ""

    @field_validator("email")
    @classmethod
    def validate_email(cls, v):
        return _clean_email(v)


class SupplierUpdate(BaseModel):
    name: Optional[str] = None
    contact_person: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    notes: Optional[str] = None

    @field_validator("email")
    @classmethod
    def validate_email(cls, v):
        return _clean_email(v)


class SupplierOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    contact_person: str
    email: str
    phone: str
    address: str
    notes: str
    is_active: bool
    created_at: datetime
    updated_at: datetime


class SupplierStats(BaseModel):
    total_orders: int = 0
    total_spent: float = 0.0
    avg_order_value: float = 0.0
    last_order_at: Optional[datetime] = None
    product_count: int = 0


class SupplierListItem(SupplierOut):
    total_orders: int = 0
    total_spent: float = 0.0
    avg_order_value: float = 0.0
    last_order_at: Optional[datetime] = None
    product_count: int = 0


class SupplierImportResult(BaseModel):
    created: int = 0
    skipped: int = 0
    errors: list[str] = []
