from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator

from app.models.work_center import WORK_CENTER_TYPES


def _code(v: str | None) -> str | None:
    v = (v or "").strip().upper()
    if not v:
        raise ValueError("code cannot be empty")
    return v


def _name(v: str | None) -> str | None:
    v = (v or "").strip()
    if not v:
        raise ValueError("name cannot be empty")
    return v


def _wc_type(v: str | None) -> str | None:
    if v is not None and v not in WORK_CENTER_TYPES:
        raise ValueError(f"work_center_type must be one of {', '.join(WORK_CENTER_TYPES)}")
    return v


def _working_days(v: list[int] | None) -> list[int] | None:
    if v is None:
        return None
    days = sorted({int(d) for d in v})
    if any(d < 0 or d > 6 for d in days):
        raise ValueError("working_days must be weekday numbers 0 (Monday) to 6 (Sunday)")
    return days


def _shift_start(v: str | None) -> str | None:
    v = (v or "").strip()
    parts = v.split(":")
    if len(parts) != 2 or not all(p.isdigit() for p in parts):
        raise ValueError("shift_start must be HH:MM")
    hour, minute = int(parts[0]), int(parts[1])
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        raise ValueError("shift_start must be a valid time of day")
    return f"{hour:02d}:{minute:02d}"


class WorkCenterCreate(BaseModel):
    code: str
    name: str
    work_center_type: str = "workstation"
    location_id: Optional[int] = None
    hours_per_day: float = Field(default=8.0, gt=0, le=24)
    working_days: Optional[list[int]] = None
    shift_start: str = "08:00"
    efficiency: float = Field(default=100.0, gt=0, le=1000)
    hourly_rate: float = Field(default=0.0, ge=0)
    notes: str = ""
    is_active: bool = True

    _v_code = field_validator("code")(_code)
    _v_name = field_validator("name")(_name)
    _v_type = field_validator("work_center_type")(_wc_type)
    _v_working_days = field_validator("working_days")(_working_days)
    _v_shift_start = field_validator("shift_start")(_shift_start)


class WorkCenterUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    work_center_type: Optional[str] = None
    location_id: Optional[int] = None
    hours_per_day: Optional[float] = Field(default=None, gt=0, le=24)
    working_days: Optional[list[int]] = None
    shift_start: Optional[str] = None
    efficiency: Optional[float] = Field(default=None, gt=0, le=1000)
    hourly_rate: Optional[float] = Field(default=None, ge=0)
    notes: Optional[str] = None
    is_active: Optional[bool] = None

    _v_code = field_validator("code")(_code)
    _v_name = field_validator("name")(_name)
    _v_type = field_validator("work_center_type")(_wc_type)
    _v_working_days = field_validator("working_days")(_working_days)
    _v_shift_start = field_validator("shift_start")(_shift_start)


class WorkCenterOut(BaseModel):
    id: int
    code: str
    name: str
    work_center_type: str
    location_id: Optional[int] = None
    hours_per_day: float = 8.0
    # The raw stored calendar, which is null when the center never set one.
    working_days: Optional[list[int]] = None
    shift_start: str = "08:00"
    efficiency: float = 100.0
    hourly_rate: float = 0.0
    notes: str = ""
    is_active: bool = True
    created_at: datetime
    updated_at: datetime
    location_name: str = ""
    # The calendar actually used, with the Mon-Fri default filled in.
    working_day_list: list[int] = []
    daily_minutes: int = 0
    operation_count: int = 0

    class Config:
        from_attributes = True


class WorkCenterLoadOut(BaseModel):
    """Capacity and committed load for one work center over a date window."""

    work_center_id: int
    work_center_code: str = ""
    work_center_name: str = ""
    from_date: date
    to_date: date
    working_days_available: int = 0
    capacity_minutes: int = 0
    load_minutes: int = 0
    free_minutes: int = 0
    utilization_pct: float = 0.0
    scheduled_work_orders: int = 0
    open_work_orders: int = 0
    is_bottleneck: bool = False
    overdue_work_orders: int = 0


class RoutingOperationIn(BaseModel):
    work_center_id: int
    position: int = 0
    name: str = ""
    setup_minutes: int = Field(default=0, ge=0, le=100000)
    run_minutes_per_unit: float = Field(default=0.0, ge=0, le=100000)
    notes: str = ""
    is_active: bool = True

    @field_validator("name")
    @classmethod
    def validate_op_name(cls, v: str) -> str:
        return v.strip()


class RoutingReplace(BaseModel):
    operations: list[RoutingOperationIn] = []


class RoutingOperationOut(BaseModel):
    id: int
    product_id: int
    work_center_id: int
    position: int
    name: str
    setup_minutes: int
    run_minutes_per_unit: float
    notes: str
    is_active: bool
    created_at: datetime
    work_center_name: str = ""
    work_center_code: str = ""
    label: str = ""

    class Config:
        from_attributes = True


class RoutingOut(BaseModel):
    """A product's full route plus the time a single unit needs to make it.

    ``ideal_minutes_per_unit`` is setup plus run time as written on the route.
    ``adjusted_minutes_per_unit`` applies each step's work center efficiency, so
    a route through a half-speed machine reads as twice as slow as its numbers
    suggest.
    """

    product_id: int
    product_name: str = ""
    sku: str = ""
    operation_count: int = 0
    total_setup_minutes: int = 0
    total_run_minutes_per_unit: float = 0.0
    unique_work_centers: int = 0
    ideal_minutes_per_unit: float = 0.0
    adjusted_minutes_per_unit: float = 0.0
    is_complete: bool = False
    operations: list[RoutingOperationOut] = []