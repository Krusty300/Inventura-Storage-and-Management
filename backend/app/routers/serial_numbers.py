from math import ceil

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models.serial_number import SerialNumber
from app.models.stock_movement import StockMovement
from app.schemas.serial_number import SerialNumberOut
from app.schemas.stock_movement import StockMovementOut
from app.services.auth import get_current_user
from app.utils import get_or_404

router = APIRouter(prefix="/api/serial-numbers", tags=["serial-numbers"], dependencies=[Depends(get_current_user)])


def _load_serial(db: Session, serial_id: int) -> SerialNumber:
    return get_or_404(SerialNumber, serial_id, db, options=[
        joinedload(SerialNumber.product), joinedload(SerialNumber.lot), joinedload(SerialNumber.location),
    ])


@router.get("")
def list_serial_numbers(
    product_id: int | None = None,
    status: str | None = None,
    location_id: int | None = None,
    search: str = Query(""),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    db: Session = Depends(get_db),
):
    q = db.query(SerialNumber).options(
        joinedload(SerialNumber.product), joinedload(SerialNumber.lot), joinedload(SerialNumber.location),
    )
    if product_id:
        q = q.filter(SerialNumber.product_id == product_id)
    if status:
        q = q.filter(SerialNumber.status == status)
    if location_id:
        q = q.filter(SerialNumber.location_id == location_id)
    if search:
        like = f"%{search}%"
        q = q.filter(SerialNumber.serial_number.ilike(like))
    total = q.count()
    items = q.order_by(SerialNumber.created_at.desc()).offset(skip).limit(limit).all()
    return {"items": [SerialNumberOut.model_validate(s) for s in items], "total": total,
            "page": (skip // limit) + 1, "pages": max(ceil(total / limit), 1)}


@router.get("/{serial_id}", response_model=SerialNumberOut)
def get_serial_number(serial_id: int, db: Session = Depends(get_db)):
    return _load_serial(db, serial_id)


@router.get("/{serial_id}/movements", response_model=list[StockMovementOut])
def serial_movements(serial_id: int, db: Session = Depends(get_db)):
    _load_serial(db, serial_id)
    return db.query(StockMovement).options(
        joinedload(StockMovement.product), joinedload(StockMovement.user)
    ).filter(StockMovement.serial_id == serial_id).order_by(StockMovement.created_at.desc()).all()
