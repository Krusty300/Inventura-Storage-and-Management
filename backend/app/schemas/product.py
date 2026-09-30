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
    cost_price: float = Field(default=0.0, ge=0)
    quantity: int = 0
    reorder_level: Optional[int] = Field(default=None, ge=0)
    location_id: Optional[int] = None
    location: str = ""
    barcode: str = ""
    batch_number: str = ""
    expiry_date: Optional[date] = None
    image_url: str = ""
    is_active: bool = True
    is_serialized: bool = False
    is_menu_item: bool = False
    menu_section_id: Optional[int] = None
    prep_station: Optional[str] = Field(default=None, max_length=60)
    par_qty: int = Field(default=0, ge=0, le=100_000)
    warn_qty: int = Field(default=0, ge=0, le=100_000)

    @model_validator(mode="after")
    def _name_required_without_parent(self):
        if not self.name and not self.parent_id:
            raise ValueError("name is required for standalone products")
        return self

    @model_validator(mode="after")
    def _warn_below_par(self):
        if self.warn_qty > self.par_qty:
            raise ValueError("warn_qty cannot exceed par_qty")
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
    cost_price: Optional[float] = Field(default=None, ge=0)
    quantity: Optional[int] = None
    reorder_level: Optional[int] = Field(default=None, ge=0)
    location_id: Optional[int] = None
    location: Optional[str] = None
    barcode: Optional[str] = None
    batch_number: Optional[str] = None
    expiry_date: Optional[date] = None
    image_url: Optional[str] = None
    is_active: Optional[bool] = None
    is_serialized: Optional[bool] = None
    is_menu_item: Optional[bool] = None
    menu_section_id: Optional[int] = None
    prep_station: Optional[str] = Field(default=None, max_length=60)
    par_qty: Optional[int] = Field(default=None, ge=0, le=100_000)
    warn_qty: Optional[int] = Field(default=None, ge=0, le=100_000)

    @model_validator(mode="after")
    def _warn_below_par(self):
        if self.par_qty is not None and self.warn_qty is not None and self.warn_qty > self.par_qty:
            raise ValueError("warn_qty cannot exceed par_qty")
        return self


class ImageOut(BaseModel):
    id: int
    url: str
    sort_order: int

    class Config:
        from_attributes = True


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
    effective_expiry_date: Optional[date] = None
    expiry_days_left: Optional[int] = None
    image_url: str
    is_active: bool
    is_serialized: bool = False
    is_menu_item: bool = False
    menu_section_id: Optional[int] = None
    prep_station: Optional[str] = None
    par_qty: int = 0
    warn_qty: int = 0
    created_at: datetime
    updated_at: datetime
    category_name: str = ""
    supplier_name: str = ""
    is_variant: bool = False
    variant_of_name: str = ""
    variant_label: str = ""
    display_name: str = ""
    total_quantity: int = 0
    quarantined_qty: int = 0
    expired_lot_qty: int = 0
    sellable_qty: int = 0
    reserved_qty: int = 0
    images: list[ImageOut] = []
    variants: list["ProductOut"] = []

    @model_validator(mode="after")
    def _sync_image_url(self):
        """Keep image_url consistent with the gallery so all listings show images[0]."""
        if self.images:
            self.image_url = self.images[0].url
        return self

    class Config:
        from_attributes = True


ProductOut.model_rebuild()
