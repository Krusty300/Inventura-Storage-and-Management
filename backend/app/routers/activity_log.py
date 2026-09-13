from math import ceil

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.constants import MAX_PAGE_SIZE
from app.database import get_db
from app.models.activity_log import ActivityLog
from app.schemas.activity_log import ActivityLogOut
from app.services.auth import get_current_user, require_permission
from app.services.csv_export import csv_stream_response
from app.services.filters import apply_date_range

router = APIRouter(prefix="/api/activity-logs", tags=["activity-logs"], dependencies=[Depends(require_permission("activity.view"))])

MAX_EXPORT_ROWS = 10_000


@router.get("")
def list_logs(
    search: str = Query(""),
    entity_type: str | None = Query(None),
    entity_id: int | None = Query(None),
    action: str | None = Query(None),
    created_after: str = Query(""),
    created_before: str = Query(""),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=MAX_PAGE_SIZE),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    query = db.query(ActivityLog)
    if search:
        query = query.filter(ActivityLog.description.ilike(f"%{search}%"))
    if entity_type:
        query = query.filter(ActivityLog.entity_type == entity_type)
    if entity_id is not None:
        query = query.filter(ActivityLog.entity_id == entity_id)
    if action:
        query = query.filter(ActivityLog.action == action)
    query = apply_date_range(query, ActivityLog.created_at, created_after, created_before, "created_at")
    total = query.count()
    items = query.order_by(ActivityLog.created_at.desc()).offset(skip).limit(limit).all()
    return {"items": [ActivityLogOut.model_validate(l) for l in items], "total": total, "page": (skip // limit) + 1, "pages": max(ceil(total / limit), 1)}


@router.get("/export")
def export_logs(
    search: str = Query(""),
    entity_type: str | None = Query(None),
    entity_id: int | None = Query(None),
    action: str | None = Query(None),
    created_after: str = Query(""),
    created_before: str = Query(""),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    query = db.query(ActivityLog)
    if search:
        query = query.filter(ActivityLog.description.ilike(f"%{search}%"))
    if entity_type:
        query = query.filter(ActivityLog.entity_type == entity_type)
    if entity_id is not None:
        query = query.filter(ActivityLog.entity_id == entity_id)
    if action:
        query = query.filter(ActivityLog.action == action)
    query = apply_date_range(query, ActivityLog.created_at, created_after, created_before, "created_at")
    logs = query.order_by(ActivityLog.created_at.desc()).limit(MAX_EXPORT_ROWS).yield_per(500)
    return csv_stream_response(
        "activity_log_report",
        ["Date", "User", "Action", "Entity Type", "Entity ID", "Description"],
        ([
            l.created_at.strftime("%Y-%m-%d %H:%M") if l.created_at else "",
            l.username or "",
            l.action,
            l.entity_type,
            l.entity_id if l.entity_id is not None else "",
            l.description or "",
        ] for l in logs),
    )
