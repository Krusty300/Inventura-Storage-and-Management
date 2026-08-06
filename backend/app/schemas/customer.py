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


class CustomerCreate(BaseModel):
    name: str
    phone: str = ""
    email: str = ""
    address: str = ""
    customer_type: str = "walk-in"
    notes: str = ""

    @field_validator("email")
    @classmethod
    def validate_email(cls, v):
        return _clean_email(v)


class CustomerUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    customer_type: Optional[str] = None
    notes: Optional[str] = None

    @field_validator("email")
    @classmethod
    def validate_email(cls, v):
        return _clean_email(v)


class CustomerBulkEdit(BaseModel):
    ids: list[int]
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    customer_type: Optional[str] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None

    @field_validator("email")
    @classmethod
    def validate_email(cls, v):
        return _clean_email(v)


class CustomerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    phone: str
    email: str
    address: str
    customer_type: str
    notes: str
    is_active: bool
    created_at: datetime
    updated_at: datetime


class CustomerStats(BaseModel):
    total_sales: int = 0
    total_spent: float = 0.0
    avg_order_value: float = 0.0
    last_purchase_at: Optional[datetime] = None


class FrequentProduct(BaseModel):
    product_id: int
    product_name: str = ""
    sku: str = ""
    order_count: int = 0
    total_quantity: int = 0


class CustomerListItem(CustomerOut):
    total_sales: int = 0
    total_spent: float = 0.0
    avg_order_value: float = 0.0
    last_purchase_at: Optional[datetime] = None


class CustomerImportResult(BaseModel):
    created: int = 0
    skipped: int = 0
    errors: list[str] = []
