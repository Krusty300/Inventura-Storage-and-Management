"""Capacity and standard-time math for production scheduling.

Phase 1 groundwork for finite capacity scheduling. This module answers two
questions and nothing else:

1. *How much time does a center offer?* - ``capacity_minutes`` walks the
   requested date window and sums ``hours_per_day`` on the days the center is
   open. A Mon-Fri center asked about a week offers 5 days, not 7.
2. *How much of that time is already spoken for?* - ``load_minutes`` sums the
   scheduled windows of open work orders assigned to the center.

Both are deliberately independent of the scheduler that will place work orders
onto the schedule, so the load shown before scheduling exists is zero rather
than an estimate, and the same helpers can be reused once it does.
"""

from datetime import date, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import WorkOrder
from app.models.work_center import WorkCenter

# A work order only holds capacity while it is open; completed and cancelled
# work keeps its history but no longer reserves the center.
OPEN_WO_STATUSES = ("planned", "released", "in_progress")

WEEKDAY_NAMES = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")

# A center is flagged as the bottleneck once it is this committed. Below it the
# load is noise; at or above it the queue in front of the center is what sets
# the delivery date for everything behind it.
BOTTLENECK_UTILIZATION_PCT = 90.0


def working_days_in_window(work_center: WorkCenter, start: date, end: date) -> list[date]:
    """Every date in ``[start, end]`` the center is scheduled to run."""
    available = set(work_center.working_day_list)
    days: list[date] = []
    cursor = start
    while cursor <= end:
        if cursor.weekday() in available:
            days.append(cursor)
        cursor += timedelta(days=1)
    return days


def capacity_minutes(work_center: WorkCenter, start: date, end: date) -> int:
    """Total minutes the center offers across the window."""
    return len(working_days_in_window(work_center, start, end)) * work_center.daily_minutes


def effective_minutes(work_center: WorkCenter, ideal_minutes: float) -> float:
    """Convert ideal minutes into the real time the center actually takes.

    A center running at 80% efficiency needs 25% longer for the same job.
    Non-positive or missing efficiency is treated as 100% so a mis-entered
    rate never inflates or erases the load.
    """
    efficiency = float(work_center.efficiency or 0)
    if efficiency <= 0:
        return float(ideal_minutes)
    return float(ideal_minutes) * (100.0 / efficiency)


def load_minutes(db: Session, work_center_id: int, start: date, end: date) -> dict:
    """Minutes already committed to a center by open, scheduled work orders.

    Counting is done in Python from the work order's own scheduled window so
    the result matches what the shop floor is shown, and so a window that
    straddles midnight is handled the same way as any other.
    """
    rows = (
        db.query(WorkOrder)
        .filter(
            WorkOrder.work_center_id == work_center_id,
            WorkOrder.status.in_(OPEN_WO_STATUSES),
            WorkOrder.scheduled_start.is_not(None),
            WorkOrder.scheduled_end.is_not(None),
            WorkOrder.is_deleted == False,  # noqa: E712
        )
        .all()
    )
    total = 0
    count = 0
    for wo in rows:
        window_start = wo.scheduled_start.date()
        window_end = wo.scheduled_end.date()
        if window_end < start or window_start > end:
            continue
        total += wo.scheduled_minutes
        count += 1
    return {"minutes": total, "work_orders": count}


def open_work_order_counts(db: Session, work_center_id: int) -> dict:
    """Open work orders at the center, split by whether they already have a slot."""
    base = db.query(func.count(WorkOrder.id)).filter(
        WorkOrder.work_center_id == work_center_id,
        WorkOrder.status.in_(OPEN_WO_STATUSES),
        WorkOrder.is_deleted == False,  # noqa: E712
    )
    scheduled = base.filter(WorkOrder.scheduled_start.is_not(None)).scalar() or 0
    unscheduled = base.filter(WorkOrder.scheduled_start.is_(None)).scalar() or 0
    overdue = base.filter(
        WorkOrder.due_date.is_not(None),
        WorkOrder.due_date < date.today(),
    ).scalar() or 0
    return {"scheduled": int(scheduled), "unscheduled": int(unscheduled), "overdue": int(overdue)}


def build_load_report(work_center: WorkCenter, db: Session, start: date, end: date) -> dict:
    """Capacity vs. committed load for one center over a window."""
    days = working_days_in_window(work_center, start, end)
    capacity = len(days) * work_center.daily_minutes
    load = load_minutes(db, work_center.id, start, end)
    counts = open_work_order_counts(db, work_center.id)
    utilization = (load["minutes"] / capacity * 100.0) if capacity > 0 else 0.0
    return {
        "work_center_id": work_center.id,
        "work_center_code": work_center.code,
        "work_center_name": work_center.name,
        "from_date": start,
        "to_date": end,
        "working_days_available": len(days),
        "capacity_minutes": capacity,
        "load_minutes": load["minutes"],
        "free_minutes": max(capacity - load["minutes"], 0),
        "utilization_pct": round(utilization, 1),
        "scheduled_work_orders": load["work_orders"],
        "open_work_orders": counts["scheduled"] + counts["unscheduled"],
        "is_bottleneck": capacity > 0 and utilization >= BOTTLENECK_UTILIZATION_PCT,
        "overdue_work_orders": counts["overdue"],
    }