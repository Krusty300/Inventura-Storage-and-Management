"""Shared query-parameter parsing helpers for list endpoints.

Every list endpoint accepts the same optional filter shapes so the frontend
can offer date-range and numeric-range filtering uniformly:

- Date range params are ISO-8601 strings, ``<field>_after`` / ``<field>_before``.
  ``before`` is inclusive through end-of-day (e.g. ``created_before=2026-07-01``
  includes everything created on July 1st).
- Numeric range params are ``<field>_min`` / ``<field>_max``.

Invalid inputs raise ``400`` with a helpful message instead of failing late.
"""

from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import Date


def _unwrap_type(column):
    t = getattr(column, "type", None)
    while hasattr(t, "impl"):
        t = t.impl
    return t


def _is_date_column(column) -> bool:
    return isinstance(_unwrap_type(column), Date)


def parse_date(value: str | None, param: str = "date") -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid {param}: expected ISO 8601 date, e.g. 2026-07-01",
        )


def parse_end_of_day(value: str | None, param: str = "date") -> datetime | None:
    dt = parse_date(value, param)
    if dt is None:
        return None
    return dt.replace(hour=23, minute=59, second=59, microsecond=999999)


def parse_number(value: str | None, param: str = "value") -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"Invalid {param}: must be a number")


def apply_date_range(q, column, after: str | None, before: str | None, label: str = "date"):
    """Apply an inclusive ``[after, before]`` range on a date/datetime column.

    Values are ISO-8601 strings. For datetime columns ``before`` is normalized to
    end-of-day so the upper bound is inclusive; pure ``Date`` columns compare by
    calendar day directly. Invalid values raise ``400``.
    """
    if _is_date_column(column):
        # Pure date columns are compared by calendar day; parse down to the date part.
        start_raw = parse_date(after, f"{label} after")
        end_raw = parse_date(before, f"{label} before")
        start = start_raw.date() if start_raw else None
        end = end_raw.date() if end_raw else None
    else:
        start = parse_date(after, f"{label} after")
        end = parse_end_of_day(before, f"{label} before")
    if start is not None:
        q = q.filter(column >= start)
    if end is not None:
        q = q.filter(column <= end)
    return q


def apply_numeric_range(q, column, min_value: str | None, max_value: str | None, label: str = "value"):
    """Apply an inclusive ``[min, max]`` range on a numeric column.

    Values are numbers (ints or floats); invalid values raise ``400``.
    """
    lo = parse_number(min_value, f"{label} minimum")
    hi = parse_number(max_value, f"{label} maximum")
    if lo is not None:
        q = q.filter(column >= lo)
    if hi is not None:
        q = q.filter(column <= hi)
    return q