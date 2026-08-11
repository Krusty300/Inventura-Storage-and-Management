from datetime import datetime, timezone
from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from app.constants import MAX_PAGE_SIZE
from app.database import get_db
from app.models import Lot, Location, Product, QualityCheck
from app.schemas.quality_check import QC_RESULTS, QualityCheckCreate, QualityCheckOut, QualityCheckUpdate
from app.services.auth import get_current_user, require_permission
from app.services.sequences import next_document_number
from app.utils import get_or_404, log_activity, broadcast_change

router = APIRouter(prefix="/api/quality-checks", tags=["quality-checks"], dependencies=[Depends(get_current_user)])


def _load_qc(db: Session, qc_id: int) -> QualityCheck:
    return get_or_404(QualityCheck, qc_id, db, options=[
        joinedload(QualityCheck.product), joinedload(QualityCheck.lot),
        joinedload(QualityCheck.location), joinedload(QualityCheck.work_order),
        joinedload(QualityCheck.checker),
    ])


def _quarantine_lot(db: Session, lot: Lot) -> None:
    if lot.status == "quarantined":
        return
    if lot.status != "in_stock":
        raise HTTPException(status_code=400, detail=f"Cannot quarantine lot '{lot.lot_number}' in status '{lot.status}'")
    lot.status = "quarantined"


def _release_lot_if_clear(db: Session, lot: Lot) -> None:
    """Restore a quarantined lot to sellable stock once no failing quality check
    still references it (e.g. after its only failing check is updated to pass)."""
    if lot.status != "quarantined":
        return
    still_failing = db.query(QualityCheck.id).filter(
        QualityCheck.lot_id == lot.id, QualityCheck.result == "fail"
    ).first()
    if still_failing is None:
        lot.status = "in_stock"


@router.get("")
def list_quality_checks(
    product_id: int | None = None,
    result: str | None = None,
    lot_id: int | None = None,
    location_id: int | None = None,
    search: str = Query(""),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=MAX_PAGE_SIZE),
    db: Session = Depends(get_db),
):
    q = db.query(QualityCheck).options(
        joinedload(QualityCheck.product), joinedload(QualityCheck.lot),
        joinedload(QualityCheck.location), joinedload(QualityCheck.work_order),
        joinedload(QualityCheck.checker),
    )
    if product_id:
        q = q.filter(QualityCheck.product_id == product_id)
    if result:
        if result not in QC_RESULTS:
            raise HTTPException(status_code=400, detail=f"result must be one of {QC_RESULTS}")
        q = q.filter(QualityCheck.result == result)
    if lot_id:
        q = q.filter(QualityCheck.lot_id == lot_id)
    if location_id:
        q = q.filter(QualityCheck.location_id == location_id)
    if search:
        like = f"%{search}%"
        q = q.join(QualityCheck.product, isouter=True).filter(
            QualityCheck.qc_number.ilike(like) | Product.name.ilike(like) | Product.sku.ilike(like)
        )
    total = q.count()
    items = q.order_by(QualityCheck.created_at.desc()).offset(skip).limit(limit).all()
    return {"items": [QualityCheckOut.model_validate(qc) for qc in items], "total": total,
            "page": (skip // limit) + 1, "pages": max(ceil(total / limit), 1)}


@router.get("/{qc_id}", response_model=QualityCheckOut)
def get_quality_check(qc_id: int, db: Session = Depends(get_db)):
    return _load_qc(db, qc_id)


@router.post("", response_model=QualityCheckOut, status_code=201)
def create_quality_check(data: QualityCheckCreate, db: Session = Depends(get_db), user=Depends(require_permission("quality_checks.create"))):
    get_or_404(Product, data.product_id, db)
    if data.lot_id is not None:
        lot = get_or_404(Lot, data.lot_id, db)
        if lot.product_id != data.product_id:
            raise HTTPException(status_code=400, detail="The selected lot does not belong to this product")
    if data.location_id is not None:
        loc = get_or_404(Location, data.location_id, db)
        if not loc.is_active:
            raise HTTPException(status_code=400, detail=f"Location '{loc.path}' is inactive")
    qc = QualityCheck(
        qc_number=next_document_number(db, "quality_check", "QC-"),
        product_id=data.product_id,
        lot_id=data.lot_id,
        location_id=data.location_id,
        work_order_id=data.work_order_id,
        batch_number=data.batch_number,
        result=data.result,
        notes=data.notes,
        checked_by=user.id,
    )
    db.add(qc)
    db.flush()
    if data.result == "fail" and data.lot_id is not None:
        _quarantine_lot(db, qc.lot)
    if data.result in ("pass", "fail"):
        qc.checked_at = datetime.now(timezone.utc)
    db.commit()
    qc = _load_qc(db, qc.id)
    action = "fail" if qc.result == "fail" else "complete"
    log_activity(db, user.id, user.username, action, "quality_check", qc.id,
                 f"Quality check '{qc.qc_number}' for '{qc.product_name}' -> {qc.result}"
                 + (f" (lot '{qc.lot_number}' quarantined)" if qc.result == "fail" and qc.lot_id else ""))
    db.commit()
    broadcast_change("quality_check", "created")
    if qc.result == "fail" and qc.lot_id:
        broadcast_change("lot", "updated")
    return qc


@router.put("/{qc_id}", response_model=QualityCheckOut)
def update_quality_check(qc_id: int, data: QualityCheckUpdate, db: Session = Depends(get_db), user=Depends(require_permission("quality_checks.update"))):
    qc = _load_qc(db, qc_id)
    updates = data.model_dump(exclude_unset=True)
    old_result = qc.result
    for k, v in updates.items():
        setattr(qc, k, v)
    if updates.get("result") in ("pass", "fail"):
        qc.checked_at = datetime.now(timezone.utc)
    if updates.get("result") == "fail" and qc.lot_id is not None:
        _quarantine_lot(db, qc.lot)
    db.commit()
    if qc.result == "pass" and qc.lot_id is not None:
        _release_lot_if_clear(db, qc.lot)
        db.commit()
    qc = _load_qc(db, qc.id)
    log_activity(db, user.id, user.username, "update", "quality_check", qc.id,
                 f"Updated quality check '{qc.qc_number}' ({old_result} -> {qc.result})")
    db.commit()
    broadcast_change("quality_check", "updated")
    if qc.lot_id and qc.result in ("pass", "fail"):
        broadcast_change("lot", "updated")
    return qc


@router.delete("/{qc_id}", status_code=204)
def delete_quality_check(qc_id: int, db: Session = Depends(get_db), user=Depends(require_permission("quality_checks.delete"))):
    qc = _load_qc(db, qc_id)
    lot = qc.lot
    was_fail = qc.result == "fail" and qc.lot_id is not None
    db.delete(qc)
    db.commit()
    if was_fail and lot is not None:
        _release_lot_if_clear(db, lot)
        db.commit()
    log_activity(db, user.id, user.username, "delete", "quality_check", qc.id, f"Deleted quality check '{qc.qc_number}'")
    db.commit()
    broadcast_change("quality_check", "deleted")
