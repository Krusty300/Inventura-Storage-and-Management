from datetime import datetime
from typing import Optional

from pydantic import BaseModel, field_validator

QC_RESULTS = {"pending", "pass", "fail"}


class QualityCheckCreate(BaseModel):
    product_id: int
    lot_id: Optional[int] = None
    work_order_id: Optional[int] = None
    batch_number: str = ""
    result: str = "pass"
    notes: str = ""

    @field_validator("result")
    @classmethod
    def validate_result(cls, v: str) -> str:
        if v not in QC_RESULTS:
            raise ValueError(f"result must be one of {QC_RESULTS}")
        return v


class QualityCheckUpdate(BaseModel):
    result: Optional[str] = None
    notes: Optional[str] = None

    @field_validator("result")
    @classmethod
    def validate_result(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if v not in QC_RESULTS:
            raise ValueError(f"result must be one of {QC_RESULTS}")
        return v


class QualityCheckOut(BaseModel):
    id: int
    qc_number: str
    product_id: int
    lot_id: Optional[int] = None
    work_order_id: Optional[int] = None
    batch_number: str
    result: str
    notes: str
    checked_by: int
    checked_at: Optional[datetime] = None
    created_at: datetime
    product_name: str = ""
    lot_number: str = ""
    wo_number: str = ""
    checker_username: str = ""

    class Config:
        from_attributes = True
