from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator

WORK_ORDER_STATUSES = {"planned", "released", "in_progress", "completed", "cancelled"}


class WorkOrderItemIn(BaseModel):
    product_id: int
    quantity_required: int = Field(ge=0)


class WorkOrderCreate(BaseModel):
    product_id: int
    quantity: int = Field(gt=0)
    bom_id: Optional[int] = None
    priority: str = "normal"
    notes: str = ""
    items: list[WorkOrderItemIn] = []


class WorkOrderUpdate(BaseModel):
    quantity: Optional[int] = Field(default=None, gt=0)
    priority: Optional[str] = None
    notes: Optional[str] = None
    items: Optional[list[WorkOrderItemIn]] = None


class WorkOrderRelease(BaseModel):
    pass


class WorkOrderComplete(BaseModel):
    received_qty: Optional[int] = Field(default=None, gt=0)
    receive_location_id: int
    lot_number: Optional[str] = None
    backflush: bool = False
    serial_numbers: list[str] = []

    @field_validator("received_qty")
    @classmethod
    def validate_received_qty(cls, v: int | None) -> int | None:
        if v is not None and v <= 0:
            raise ValueError("received_qty must be positive")
        return v


class WorkOrderItemOut(BaseModel):
    id: int
    work_order_id: int
    product_id: int
    quantity_required: int
    quantity_issued: int
    product_name: str = ""
    unit_cost: float = 0.0

    class Config:
        from_attributes = True


class WorkOrderOut(BaseModel):
    id: int
    wo_number: str
    product_id: int
    quantity: int
    bom_id: Optional[int] = None
    wip_location_id: Optional[int] = None
    status: str
    priority: str
    notes: str
    created_by: int
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    product_name: str = ""
    username: str = ""
    bom_name: str = ""
    is_serialized: bool = False
    total_required: int = 0
    total_issued: int = 0
    fully_issued: bool = False
    items: list[WorkOrderItemOut] = []

    class Config:
        from_attributes = True
