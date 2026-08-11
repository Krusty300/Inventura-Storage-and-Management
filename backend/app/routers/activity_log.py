from math import ceil

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.constants import MAX_PAGE_SIZE
from app.database import get_db
from app.models.activity_log import ActivityLog
from app.schemas.activity_log import ActivityLogOut
from app.services.auth import get_current_user

router = APIRouter(prefix="/api/activity-logs", tags=["activity-logs"], dependencies=[Depends(get_current_user)])


@router.get("")
def list_logs(
    search: str = Query(""),
    entity_type: str | None = Query(None),
    entity_id: int | None = Query(None),
    action: str | None = Query(None),
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
    total = query.count()
    items = query.order_by(ActivityLog.created_at.desc()).offset(skip).limit(limit).all()
    return {"items": [ActivityLogOut.model_validate(l) for l in items], "total": total, "page": (skip // limit) + 1, "pages": max(ceil(total / limit), 1)}
