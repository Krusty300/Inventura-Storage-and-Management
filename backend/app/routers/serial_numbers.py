from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from app.constants import MAX_PAGE_SIZE
from app.database import get_db
from app.models.serial_number import SerialNumber
from app.models.stock_movement import StockMovement
from app.schemas.serial_number import SerialNumberOut, SerialStatusUpdate
from app.schemas.stock_movement import StockMovementOut
from app.services import inventory
from app.services.auth import get_current_user, require_permission
from app.utils import get_or_404, log_activity, broadcast_change

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
    no_location: bool = Query(False),
    search: str = Query(""),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=MAX_PAGE_SIZE),
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
    if no_location:
        q = q.filter(SerialNumber.location_id.is_(None))
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


@router.put("/{serial_id}/status", response_model=SerialNumberOut)
def update_serial_status(serial_id: int, data: SerialStatusUpdate, db: Session = Depends(get_db),
                         user=Depends(require_permission("serial_numbers.update"))):
    """Toggle an individual serial between in_stock and inactive.

    Only in_stock <-> inactive is allowed; terminal states (sold, scrapped) and
    process states (reserved, quarantined) are managed by their own flows. Each
    toggle is written to the ledger as a deactivate/activate movement.
    """
    serial = _load_serial(db, serial_id)
    if data.status not in (inventory.SERIAL_STATUS_IN_STOCK, inventory.SERIAL_STATUS_INACTIVE):
        raise HTTPException(status_code=400, detail="Serial status can only be toggled between 'in_stock' and 'inactive'")
    if data.status == inventory.SERIAL_STATUS_INACTIVE:
        if serial.status == inventory.SERIAL_STATUS_INACTIVE:
            raise HTTPException(status_code=400, detail=f"Serial '{serial.serial_number}' is already inactive")
        if serial.status != inventory.SERIAL_STATUS_IN_STOCK:
            raise HTTPException(status_code=400, detail=f"Only in-stock serials can be deactivated (current: {serial.status})")
        inventory.post_journal_entry(
            db, product_id=serial.product_id, user_id=user.id, quantity_change=-1,
            movement_type=inventory.DEACTIVATE, from_location_id=serial.location_id,
            lot_id=serial.lot_id, serial_id=serial.id,
            reference_type="serial", reference=f"Serial {serial.serial_number} deactivated",
            notes="Serial unit manually deactivated",
        )
    else:
        if serial.status != inventory.SERIAL_STATUS_INACTIVE:
            raise HTTPException(status_code=400, detail=f"Only inactive serials can be activated (current: {serial.status})")
        inventory.post_journal_entry(
            db, product_id=serial.product_id, user_id=user.id, quantity_change=+1,
            movement_type=inventory.ACTIVATE, to_location_id=serial.location_id,
            lot_id=serial.lot_id, serial_id=serial.id,
            reference_type="serial", reference=f"Serial {serial.serial_number} activated",
            notes="Serial unit manually activated",
        )
    db.commit()
    serial = _load_serial(db, serial_id)
    action = "Deactivated" if data.status == inventory.SERIAL_STATUS_INACTIVE else "Activated"
    log_activity(db, user.id, user.username, "update", "serial_number", serial.id,
                 f"{action} serial '{serial.serial_number}'")
    db.commit()
    broadcast_change("product", "updated")
    broadcast_change("stock_movement", "created")
    return serial


@router.get("/{serial_id}/movements", response_model=list[StockMovementOut])
def serial_movements(serial_id: int, db: Session = Depends(get_db)):
    _load_serial(db, serial_id)
    return db.query(StockMovement).options(
        joinedload(StockMovement.product), joinedload(StockMovement.user)
    ).filter(StockMovement.serial_id == serial_id).order_by(StockMovement.created_at.desc()).all()
