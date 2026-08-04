from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, Field, model_validator


class ProductCreate(BaseModel):
    sku: str
    name: Optional[str] = None
    description: str = ""
    category_id: Optional[int] = None
    supplier_id: Optional[int] = None
    parent_id: Optional[int] = None
    attributes: Optional[dict] = None
    unit_price: float = 0.0
    cost_price: float = 0.0
    quantity: int = 0
    reorder_level: Optional[int] = None
    location_id: Optional[int] = None
    location: str = ""
    barcode: str = ""
    batch_number: str = ""
    expiry_date: Optional[date] = None
    image_url: str = ""
    is_active: bool = True
    is_serialized: bool = False

    @model_validator(mode="after")
    def _name_required_without_parent(self):
        if not self.name and not self.parent_id:
            raise ValueError("name is required for standalone products")
        return self


class ProductUpdate(BaseModel):
    sku: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    category_id: Optional[int] = None
    supplier_id: Optional[int] = None
    parent_id: Optional[int] = None
    attributes: Optional[dict] = None
    unit_price: Optional[float] = None
    cost_price: Optional[float] = None
    quantity: Optional[int] = None
    reorder_level: Optional[int] = None
    location_id: Optional[int] = None
    location: Optional[str] = None
    barcode: Optional[str] = None
    batch_number: Optional[str] = None
    expiry_date: Optional[date] = None
    image_url: Optional[str] = None
    is_active: Optional[bool] = None
    is_serialized: Optional[bool] = None


class ProductOut(BaseModel):
    id: int
    sku: str
    name: str
    description: str
    category_id: Optional[int] = None
    supplier_id: Optional[int] = None
    parent_id: Optional[int] = None
    attributes: Optional[dict] = None
    unit_price: float
    cost_price: float
    quantity: int
    reorder_level: int
    location_id: Optional[int] = None
    location: str
    barcode: str
    batch_number: str
    expiry_date: Optional[date] = None
    image_url: str
    is_active: bool
    is_serialized: bool = False
    created_at: datetime
    updated_at: datetime
    category_name: str = ""
    supplier_name: str = ""
    is_variant: bool = False
    variant_label: str = ""
    display_name: str = ""
    total_quantity: int = 0
    variants: list["ProductOut"] = []

    class Config:
        from_attributes = True


ProductOut.model_rebuild()
