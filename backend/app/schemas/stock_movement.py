from datetime import datetime
from typing import Optional

from pydantic import BaseModel, field_validator


class StockMovementCreate(BaseModel):
    product_id: int
    movement_type: str
    quantity_change: int
    reference: str = ""
    notes: str = ""
    location_id: Optional[int] = None
    serial_id: Optional[int] = None

    @field_validator("movement_type")
    @classmethod
    def validate_type(cls, v: str) -> str:
        allowed = {"in", "out", "adjustment", "return"}
        if v.lower() not in allowed:
            raise ValueError(f"movement_type must be one of {allowed}")
        return v.lower()

    @field_validator("quantity_change")
    @classmethod
    def validate_quantity_sign(cls, v: int, info) -> int:
        movement_type = info.data.get("movement_type")
        if movement_type == "out" and v >= 0:
            raise ValueError("quantity_change must be negative for movement_type='out'")
        if movement_type in ("in", "return") and v <= 0:
            raise ValueError(f"quantity_change must be positive for movement_type='{movement_type}'")
        if movement_type == "adjustment" and v == 0:
            raise ValueError("quantity_change must not be zero for movement_type='adjustment'")
        return v


class StockMovementAdjust(BaseModel):
    product_id: int
    new_quantity: int
    reason_code: str
    notes: str = ""
    location_id: Optional[int] = None


class StockMovementUpdate(BaseModel):
    product_id: Optional[int] = None
    quantity_change: Optional[int] = None
    movement_type: Optional[str] = None
    reference: Optional[str] = None
    notes: Optional[str] = None
    location_id: Optional[int] = None

    @field_validator("movement_type")
    @classmethod
    def validate_type(cls, v: str | None) -> str | None:
        if v is None:
            return v
        allowed = {"in", "out", "adjustment", "return"}
        if v.lower() not in allowed:
            raise ValueError(f"movement_type must be one of {allowed}")
        return v.lower()


class StockMovementOut(BaseModel):
    id: int
    product_id: int
    user_id: int
    quantity_change: int
    movement_type: str
    reference: str
    notes: str
    created_at: datetime
    product_name: str = ""
    username: str = ""
    from_location_id: Optional[int] = None
    to_location_id: Optional[int] = None
    lot_id: Optional[int] = None
    serial_id: Optional[int] = None
    lpn_id: Optional[int] = None
    transfer_id: Optional[int] = None
    reference_type: str = ""
    from_location_name: str = ""
    to_location_name: str = ""

    class Config:
        from_attributes = True


class StockMovementTransfer(BaseModel):
    product_id: int
    quantity: int
    from_location_id: int
    to_location_id: int
    lot_id: Optional[int] = None
    lpn_id: Optional[int] = None
    notes: str = ""

    @field_validator("quantity")
    @classmethod
    def validate_quantity(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("quantity must be positive")
        return v


class StockMovementSerialTransfer(BaseModel):
    product_id: int
    serial_ids: list[int]
    from_location_id: int
    to_location_id: int
    notes: str = ""

    @field_validator("serial_ids")
    @classmethod
    def validate_serial_ids(cls, v: list[int]) -> list[int]:
        if not v:
            raise ValueError("serial_ids must not be empty")
        if len(set(v)) != len(v):
            raise ValueError("serial_ids must be unique")
        return v


class StockMovementUnallocatedMove(BaseModel):
    product_id: int
    quantity: int
    to_location_id: int
    lot_id: Optional[int] = None
    serial_ids: Optional[list[int]] = None
    notes: str = ""

    @field_validator("quantity")
    @classmethod
    def validate_quantity(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("quantity must be positive")
        return v

    @field_validator("serial_ids")
    @classmethod
    def validate_serial_ids(cls, v: Optional[list[int]]) -> Optional[list[int]]:
        if v is not None:
            if not v:
                raise ValueError("serial_ids must not be empty")
            if len(set(v)) != len(v):
                raise ValueError("serial_ids must be unique")
        return v


class StockMovementQuarantine(BaseModel):
    product_id: int
    quantity: int = 1
    from_location_id: int
    to_location_id: int
    lot_id: Optional[int] = None
    serial_ids: Optional[list[int]] = None
    notes: str = ""

    @field_validator("quantity")
    @classmethod
    def validate_quantity(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("quantity must be positive")
        return v

    @field_validator("serial_ids")
    @classmethod
    def validate_serial_ids(cls, v: Optional[list[int]]) -> Optional[list[int]]:
        if v is not None:
            if not v:
                raise ValueError("serial_ids must not be empty")
            if len(set(v)) != len(v):
                raise ValueError("serial_ids must be unique")
        return v
