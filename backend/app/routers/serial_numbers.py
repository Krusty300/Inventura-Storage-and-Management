from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from app.constants import MAX_PAGE_SIZE_LOOKUP
from app.database import get_db
from app.models.serial_number import SerialNumber
from app.models.stock_movement import StockMovement
from app.schemas.serial_number import SerialNumberOut, SerialStatusUpdate
from app.schemas.stock_movement import StockMovementOut
from app.services import inventory
from app.services.auth import require_permission
from app.services.csv_export import csv_response
from app.utils import get_or_404, log_activity, broadcast_change

router = APIRouter(prefix="/api/serial-numbers", tags=["serial-numbers"], dependencies=[Depends(require_permission("serial_numbers.view"))])


def _load_serial(db: Session, serial_id: int) -> SerialNumber:
    return get_or_404(SerialNumber, serial_id, db, options=[
        joinedload(SerialNumber.product), joinedload(SerialNumber.lot), joinedload(SerialNumber.location),
    ])


def _latest_references(db: Session, serial_ids: list[int]) -> dict[int, str]:
    """Map of serial_id -> latest work-order reference (issue/release) for it."""
    if not serial_ids:
        return {}
    rows = (
        db.query(StockMovement.serial_id, StockMovement.reference)
        .filter(
            StockMovement.serial_id.in_(serial_ids),
            StockMovement.movement_type.in_([inventory.ISSUE, inventory.BACKFLUSH, inventory.RELEASE]),
            StockMovement.reference_type == "work_order",
            StockMovement.reference != "",
        )
        .order_by(StockMovement.created_at.desc(), StockMovement.id.desc())
        .all()
    )
    refs: dict[int, str] = {}
    for serial_id, reference in rows:
        refs.setdefault(int(serial_id), reference)
    return refs


@router.get("")
def list_serial_numbers(
    product_id: int | None = None,
    lot_id: int | None = None,
    status: str | None = None,
    location_id: int | None = None,
    no_location: bool = Query(False),
    search: str = Query(""),
    sort: str = Query("created_at"),
    order: str = Query("desc"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=MAX_PAGE_SIZE_LOOKUP),
    db: Session = Depends(get_db),
):
    SORTABLE = {"serial_number", "status", "lot_id", "created_at", "sold_at", "product_id"}
    if sort not in SORTABLE:
        raise HTTPException(status_code=400, detail=f"sort must be one of {sorted(SORTABLE)}")
    if order not in ("asc", "desc"):
        raise HTTPException(status_code=400, detail="order must be 'asc' or 'desc'")
    col = getattr(SerialNumber, sort)
    sort_col = col.asc() if order == "asc" else col.desc()
    q = db.query(SerialNumber).options(
        joinedload(SerialNumber.product), joinedload(SerialNumber.lot), joinedload(SerialNumber.location),
    )
    if product_id:
        q = q.filter(SerialNumber.product_id == product_id)
    if lot_id:
        q = q.filter(SerialNumber.lot_id == lot_id)
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
    items = q.order_by(sort_col).offset(skip).limit(limit).all()
    refs = _latest_references(db, [s.id for s in items])
    for s in items:
        s.reference = refs.get(s.id, "")
    return {"items": [SerialNumberOut.model_validate(s) for s in items], "total": total,
            "page": (skip // limit) + 1, "pages": max(ceil(total / limit), 1)}


@router.get("/export")
def export_serial_numbers(
    product_id: int | None = None,
    lot_id: int | None = None,
    status: str | None = None,
    location_id: int | None = None,
    no_location: bool = Query(False),
    search: str = Query(""),
    sort: str = Query("created_at"),
    order: str = Query("desc"),
    db: Session = Depends(get_db),
):
    SORTABLE = {"serial_number", "status", "lot_id", "created_at", "sold_at", "product_id"}
    if sort not in SORTABLE:
        raise HTTPException(status_code=400, detail=f"sort must be one of {sorted(SORTABLE)}")
    if order not in ("asc", "desc"):
        raise HTTPException(status_code=400, detail="order must be 'asc' or 'desc'")
    col = getattr(SerialNumber, sort)
    sort_col = col.asc() if order == "asc" else col.desc()
    q = db.query(SerialNumber).options(
        joinedload(SerialNumber.product), joinedload(SerialNumber.lot), joinedload(SerialNumber.location),
    )
    if product_id:
        q = q.filter(SerialNumber.product_id == product_id)
    if lot_id:
        q = q.filter(SerialNumber.lot_id == lot_id)
    if status:
        q = q.filter(SerialNumber.status == status)
    if location_id:
        q = q.filter(SerialNumber.location_id == location_id)
    if no_location:
        q = q.filter(SerialNumber.location_id.is_(None))
    if search:
        like = f"%{search}%"
        q = q.filter(SerialNumber.serial_number.ilike(like))
    serials = q.order_by(sort_col).all()
    return csv_response(
        "serial_numbers_report",
        ["Serial #", "Product", "SKU", "Status", "Location", "Lot", "Created"],
        [[
            s.serial_number,
            s.product_name,
            s.product.sku if s.product else "",
            s.status,
            s.location_name,
            s.lot_number,
            s.created_at.strftime("%Y-%m-%d %H:%M") if s.created_at else "",
        ] for s in serials],
    )


@router.get("/{serial_id}", response_model=SerialNumberOut)
def get_serial_number(serial_id: int, db: Session = Depends(get_db)):
    serial = _load_serial(db, serial_id)
    serial.reference = _latest_references(db, [serial.id]).get(serial.id, "")
    return serial


@router.put("/{serial_id}/status", response_model=SerialNumberOut)
def update_serial_status(serial_id: int, data: SerialStatusUpdate, db: Session = Depends(get_db),
                         user=Depends(require_permission("serial_numbers.update"))):
    """Toggle an individual serial between in_stock and inactive, or release it
    from quarantine.

    ``in_stock <-> inactive`` and ``quarantined -> in_stock`` are allowed;
    terminal states (sold, scrapped) and process states (reserved, quarantined)
    are otherwise managed by their own flows. Each toggle is written to the
    ledger as a deactivate/activate/release movement.
    """
    serial = _load_serial(db, serial_id)
    lot = serial.lot
    lot_was_quarantined = lot is not None and lot.status == inventory.SERIAL_STATUS_QUARANTINED
    allowed = {inventory.SERIAL_STATUS_IN_STOCK, inventory.SERIAL_STATUS_INACTIVE}
    if data.status == inventory.SERIAL_STATUS_IN_STOCK and serial.status == inventory.SERIAL_STATUS_QUARANTINED:
        movement = inventory.release_serial_from_quarantine(
            db, serial=serial, user_id=user.id,
            reference=f"Serial {serial.serial_number} released",
            notes="Serial unit manually released from quarantine",
        )
        db.commit()
        serial = _load_serial(db, serial_id)
        log_activity(db, user.id, user.username, "update", "serial_number", serial.id,
                     f"Released serial '{serial.serial_number}' from quarantine (movement {movement.id})")
        if lot_was_quarantined and serial.lot is not None and serial.lot.status == inventory.SERIAL_STATUS_IN_STOCK:
            log_activity(db, user.id, user.username, "update", "lot", serial.lot.id,
                         f"Lot '{serial.lot.lot_number}' released - last quarantined serial '{serial.serial_number}' released")
        db.commit()
        broadcast_change("product", "updated")
        broadcast_change("lot", "updated")
        broadcast_change("stock_movement", "created")
        broadcast_change("serial_number", "updated")
        return serial
    if data.status not in allowed:
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
    broadcast_change("serial_number", "updated")
    return serial


@router.post("/{serial_id}/release", response_model=SerialNumberOut)
def release_serial(serial_id: int, db: Session = Depends(get_db),
                   user=Depends(require_permission("serial_numbers.update"))):
    """Return a reserved or quarantined serial to ``in_stock``.

    Reserved serials (issued to a work order) go back to the location they were
    issued from; quarantined serials are released in place. Only ``reserved``
    and ``quarantined`` serials can be released this way.
    """
    serial = _load_serial(db, serial_id)
    lot = serial.lot
    lot_was_quarantined = lot is not None and lot.status == inventory.SERIAL_STATUS_QUARANTINED
    if serial.status == inventory.SERIAL_STATUS_RESERVED:
        movement = inventory.release_serial_from_reserved(
            db, serial=serial, user_id=user.id,
            reference=f"Serial {serial.serial_number} released",
            notes="Serial unit released from work order",
        )
    elif serial.status == inventory.SERIAL_STATUS_QUARANTINED:
        movement = inventory.release_serial_from_quarantine(
            db, serial=serial, user_id=user.id,
            reference=f"Serial {serial.serial_number} released",
            notes="Serial unit manually released from quarantine",
        )
    else:
        raise HTTPException(status_code=400, detail=f"Only reserved or quarantined serials can be released (current: {serial.status})")
    db.commit()
    serial = _load_serial(db, serial_id)
    log_activity(db, user.id, user.username, "update", "serial_number", serial.id,
                 f"Released serial '{serial.serial_number}' (movement {movement.id})")
    if lot_was_quarantined and serial.lot is not None and serial.lot.status == inventory.SERIAL_STATUS_IN_STOCK:
        log_activity(db, user.id, user.username, "update", "lot", serial.lot.id,
                     f"Lot '{serial.lot.lot_number}' released - last quarantined serial '{serial.serial_number}' released")
    db.commit()
    broadcast_change("product", "updated")
    broadcast_change("lot", "updated")
    broadcast_change("stock_movement", "created")
    broadcast_change("work_order", "updated")
    return serial


@router.get("/{serial_id}/movements", response_model=list[StockMovementOut])
def serial_movements(serial_id: int, db: Session = Depends(get_db)):
    _load_serial(db, serial_id)
    return db.query(StockMovement).options(
        joinedload(StockMovement.product), joinedload(StockMovement.user)
    ).filter(StockMovement.serial_id == serial_id).order_by(StockMovement.created_at.desc()).all()
