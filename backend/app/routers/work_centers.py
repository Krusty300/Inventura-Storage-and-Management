from datetime import date, timedelta
from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from app.constants import MAX_PAGE_SIZE
from app.database import get_db
from app.models import Location, RoutingOperation, WorkCenter
from app.models.work_center import WORK_CENTER_TYPES
from app.schemas.work_center import WorkCenterCreate, WorkCenterLoadOut, WorkCenterOut, WorkCenterUpdate
from app.services import scheduling
from app.services.auth import require_permission
from app.services.soft_delete import register, soft_delete
from app.utils import broadcast_change, get_or_404, log_activity

router = APIRouter(prefix="/api/work-centers", tags=["work-centers"], dependencies=[Depends(require_permission("work_centers.view"))])

# The window a capacity report covers when the caller does not pick one.
DEFAULT_LOAD_WINDOW_DAYS = 6


def _purge_work_center(db: Session, wc: WorkCenter, user) -> None:
    in_routing = db.query(RoutingOperation).filter(RoutingOperation.work_center_id == wc.id).first()
    if in_routing:
        raise HTTPException(status_code=400, detail="Cannot delete a work center that is used by a routing")
    db.delete(wc)


register("work_center", WorkCenter, lambda w: f"{w.code} - {w.name}", _purge_work_center)


def _load(db: Session, wc_id: int) -> WorkCenter:
    return get_or_404(WorkCenter, wc_id, db, options=[joinedload(WorkCenter.location)])


def _out(db: Session, wc: WorkCenter) -> WorkCenterOut:
    wc.operation_count = db.query(RoutingOperation).filter(RoutingOperation.work_center_id == wc.id).count()
    return WorkCenterOut.model_validate(wc)


def _window(from_date: date, to_date: date | None) -> tuple[date, date]:
    end = to_date or (from_date + timedelta(days=DEFAULT_LOAD_WINDOW_DAYS))
    if end < from_date:
        raise HTTPException(status_code=400, detail="to_date cannot be before from_date")
    return from_date, end


def _assert_code_free(db: Session, code: str, exclude_id: int | None = None) -> None:
    q = db.query(WorkCenter).filter(WorkCenter.code == code, WorkCenter.is_deleted == False)  # noqa: E712
    if exclude_id is not None:
        q = q.filter(WorkCenter.id != exclude_id)
    if q.first():
        raise HTTPException(status_code=400, detail=f"A work center with code '{code}' already exists")


@router.get("")
def list_work_centers(
    work_center_type: str | None = None,
    is_active: bool | None = None,
    search: str = Query(""),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=MAX_PAGE_SIZE),
    db: Session = Depends(get_db),
):
    q = db.query(WorkCenter).options(joinedload(WorkCenter.location)).filter(WorkCenter.is_deleted == False)  # noqa: E712
    if work_center_type:
        q = q.filter(WorkCenter.work_center_type == work_center_type)
    if is_active is not None:
        q = q.filter(WorkCenter.is_active == is_active)
    if search:
        like = f"%{search}%"
        q = q.filter(WorkCenter.name.ilike(like) | WorkCenter.code.ilike(like))
    total = q.count()
    items = q.order_by(WorkCenter.name).offset(skip).limit(limit).all()
    return {"items": [_out(db, w) for w in items], "total": total,
            "page": (skip // limit) + 1, "pages": max(ceil(total / limit), 1)}


@router.get("/load", response_model=list[WorkCenterLoadOut])
def work_center_load(
    from_date: date = Query(default_factory=date.today),
    to_date: date | None = None,
    include_inactive: bool = True,
    db: Session = Depends(get_db),
):
    """Capacity vs. committed load per work center over a date window.

    Centers come back ordered by utilization so the constrained ones surface
    first rather than leaving the reader to sort the table themselves.
    """
    start, end = _window(from_date, to_date)
    q = db.query(WorkCenter).filter(WorkCenter.is_deleted == False)  # noqa: E712
    if not include_inactive:
        q = q.filter(WorkCenter.is_active == True)  # noqa: E712
    reports = [scheduling.build_load_report(w, db, start, end) for w in q.all()]
    reports.sort(key=lambda r: (-r["utilization_pct"], r["work_center_code"]))
    return reports


@router.get("/types", response_model=list[str])
def work_center_types():
    return list(WORK_CENTER_TYPES)


@router.get("/{wc_id}", response_model=WorkCenterOut)
def get_work_center(wc_id: int, db: Session = Depends(get_db)):
    return _out(db, _load(db, wc_id))


@router.post("", response_model=WorkCenterOut, status_code=201)
def create_work_center(data: WorkCenterCreate, db: Session = Depends(get_db), user=Depends(require_permission("work_centers.create"))):
    _assert_code_free(db, data.code)
    if data.location_id is not None:
        get_or_404(Location, data.location_id, db)
    wc = WorkCenter(**data.model_dump())
    db.add(wc)
    db.commit()
    wc = _load(db, wc.id)
    log_activity(db, user.id, user.username, "create", "work_center", wc.id, f"Created work center '{wc.code}' - {wc.name}")
    db.commit()
    broadcast_change("work_center", "created")
    return _out(db, wc)


@router.put("/{wc_id}", response_model=WorkCenterOut)
def update_work_center(wc_id: int, data: WorkCenterUpdate, db: Session = Depends(get_db), user=Depends(require_permission("work_centers.update"))):
    wc = _load(db, wc_id)
    updates = data.model_dump(exclude_unset=True)
    if "code" in updates:
        _assert_code_free(db, updates["code"], exclude_id=wc.id)
    if updates.get("location_id") is not None:
        get_or_404(Location, updates["location_id"], db)
    for k, v in updates.items():
        setattr(wc, k, v)
    db.commit()
    wc = _load(db, wc.id)
    log_activity(db, user.id, user.username, "update", "work_center", wc.id, f"Updated work center '{wc.code}'")
    db.commit()
    broadcast_change("work_center", "updated")
    return _out(db, wc)


@router.get("/{wc_id}/load", response_model=WorkCenterLoadOut)
def work_center_load_detail(
    wc_id: int,
    from_date: date = Query(default_factory=date.today),
    to_date: date | None = None,
    db: Session = Depends(get_db),
):
    start, end = _window(from_date, to_date)
    return scheduling.build_load_report(_load(db, wc_id), db, start, end)


@router.delete("/{wc_id}", status_code=204)
def delete_work_center(wc_id: int, db: Session = Depends(get_db), user=Depends(require_permission("work_centers.delete"))):
    wc = _load(db, wc_id)
    soft_delete(db, wc, user, "work_center")