from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models import LPN, Location, SerialNumber, StockLine, StockMovement
from app.schemas.lpn import LPNCreate, LPNOut, LPNUpdate
from app.services import inventory
from app.services.auth import get_current_user, require_permission
from app.services.sequences import next_document_number
from app.utils import get_or_404, log_activity, broadcast_change

router = APIRouter(prefix="/api/lpns", tags=["lpns"], dependencies=[Depends(get_current_user)])


def _load_lpn(db: Session, lpn_id: int) -> LPN:
    return get_or_404(LPN, lpn_id, db, options=[
        joinedload(LPN.location), joinedload(LPN.stock_lines).joinedload(StockLine.product),
        joinedload(LPN.stock_lines).joinedload(StockLine.lot),
        joinedload(LPN.serial_numbers).joinedload(SerialNumber.product),
        joinedload(LPN.serial_numbers).joinedload(SerialNumber.lot),
        joinedload(LPN.serial_numbers).joinedload(SerialNumber.location),
    ])


def _serialize_lpn(db: Session, lpn: LPN) -> dict:
    contents = []
    total_qty = 0
    for sl in lpn.stock_lines:
        total_qty += sl.quantity
        contents.append({
            "product_id": sl.product_id,
            "product_name": sl.product.display_name if sl.product else "",
            "lot_id": sl.lot_id,
            "lot_number": sl.lot.lot_number if sl.lot else "",
            "quantity": sl.quantity,
        })
    serials = []
    for s in lpn.serial_numbers:
        serials.append({
            "serial_id": s.id,
            "product_id": s.product_id,
            "product_name": s.product_name,
            "serial_number": s.serial_number,
            "lot_number": s.lot_number,
            "status": s.status,
            "location_name": s.location_name,
        })
    return {
        "id": lpn.id,
        "lpn_number": lpn.lpn_number,
        "lpn_type": lpn.lpn_type,
        "location_id": lpn.location_id,
        "status": lpn.status,
        "created_at": lpn.created_at,
        "location_name": lpn.location_name,
        "content_count": len(contents) + len(serials),
        "total_quantity": total_qty,
        "contents": contents,
        "serials": serials,
    }


@router.get("")
def list_lpns(
    search: str = Query(""),
    location_id: int | None = None,
    status: str | None = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    q = db.query(LPN).options(
        joinedload(LPN.location), joinedload(LPN.stock_lines),
        joinedload(LPN.serial_numbers).joinedload(SerialNumber.product),
        joinedload(LPN.serial_numbers).joinedload(SerialNumber.lot),
        joinedload(LPN.serial_numbers).joinedload(SerialNumber.location),
    )
    if search:
        like = f"%{search}%"
        q = q.filter(LPN.lpn_number.ilike(like))
    if location_id:
        q = q.filter(LPN.location_id == location_id)
    if status:
        q = q.filter(LPN.status == status)
    total = q.count()
    items = q.order_by(LPN.created_at.desc()).offset(skip).limit(limit).all()
    return {"items": [_serialize_lpn(db, l) for l in items], "total": total,
            "page": (skip // limit) + 1, "pages": max(ceil(total / limit), 1)}


@router.get("/{lpn_id}", response_model=LPNOut)
def get_lpn(lpn_id: int, db: Session = Depends(get_db)):
    return _serialize_lpn(db, _load_lpn(db, lpn_id))


@router.get("/{lpn_id}/contents", response_model=LPNOut)
def lpn_contents(lpn_id: int, db: Session = Depends(get_db)):
    return _serialize_lpn(db, _load_lpn(db, lpn_id))


@router.post("", response_model=LPNOut, status_code=201)
def create_lpn(data: LPNCreate, db: Session = Depends(get_db), user=Depends(require_permission("lpns.create"))):
    if data.location_id is not None:
        get_or_404(Location, data.location_id, db)
    lpn_number = (data.lpn_number or "").strip() or next_document_number(db, "lpn", "LPN-")
    if db.query(LPN).filter(LPN.lpn_number == lpn_number).first():
        raise HTTPException(status_code=400, detail=f"LPN '{lpn_number}' already exists")
    lpn = LPN(lpn_number=lpn_number, lpn_type=data.lpn_type, location_id=data.location_id)
    db.add(lpn)
    db.commit()
    db.refresh(lpn)
    log_activity(db, user.id, user.username, "create", "lpn", lpn.id, f"Created LPN '{lpn.lpn_number}'")
    db.commit()
    broadcast_change("lpn", "created")
    return _serialize_lpn(db, _load_lpn(db, lpn.id))


@router.put("/{lpn_id}", response_model=LPNOut)
def update_lpn(lpn_id: int, data: LPNUpdate, db: Session = Depends(get_db), user=Depends(require_permission("lpns.update"))):
    lpn = _load_lpn(db, lpn_id)
    updates = data.model_dump(exclude_unset=True)
    if "location_id" in updates and updates["location_id"] is not None:
        get_or_404(Location, updates["location_id"], db)
    for k, v in updates.items():
        setattr(lpn, k, v)
    db.commit()
    lpn = _load_lpn(db, lpn.id)
    log_activity(db, user.id, user.username, "update", "lpn", lpn.id, f"Updated LPN '{lpn.lpn_number}'")
    db.commit()
    broadcast_change("lpn", "updated")
    return _serialize_lpn(db, lpn)


@router.post("/{lpn_id}/move", response_model=LPNOut)
def move_lpn(lpn_id: int, to_location_id: int, db: Session = Depends(get_db), user=Depends(require_permission("lpns.update"))):
    lpn = _load_lpn(db, lpn_id)
    target = get_or_404(Location, to_location_id, db)
    if lpn.location_id == to_location_id:
        raise HTTPException(status_code=400, detail="LPN is already at this location")
    try:
        for sl in lpn.stock_lines:
            dest = inventory.get_or_create_stock_line(
                db, product_id=sl.product_id, location_id=to_location_id,
                lot_id=sl.lot_id, lpn_id=lpn.id,
            )
            if dest.id == sl.id:
                continue
            dest.quantity += sl.quantity
            db.delete(sl)
        for serial in db.query(SerialNumber).filter(SerialNumber.lpn_id == lpn.id).all():
            serial.location_id = to_location_id
        lpn.location_id = to_location_id
        db.flush()
        for sl in db.query(StockLine).filter(StockLine.lpn_id == lpn.id).all():
            sl.product.quantity = inventory.on_hand(db, product_id=sl.product_id)
    except inventory.InventoryError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    lpn = _load_lpn(db, lpn.id)
    log_activity(db, user.id, user.username, "move", "lpn", lpn.id,
                 f"Moved LPN '{lpn.lpn_number}' to {target.path}")
    db.commit()
    broadcast_change("lpn", "updated")
    broadcast_change("stock_movement", "created")
    return _serialize_lpn(db, lpn)


@router.delete("/{lpn_id}")
def delete_lpn(lpn_id: int, db: Session = Depends(get_db), user=Depends(require_permission("lpns.delete"))):
    lpn = _load_lpn(db, lpn_id)
    if lpn.stock_lines:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete LPN '{lpn.lpn_number}' - it still has stock on hand. Move its contents out or sell them first.",
        )
    has_serials = db.query(SerialNumber).filter(SerialNumber.lpn_id == lpn.id).first() is not None
    if has_serials:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete LPN '{lpn.lpn_number}' - it still has serial numbers assigned.",
        )
    # Detach historical movements from the LPN so the ledger is preserved.
    db.query(StockMovement).filter(StockMovement.lpn_id == lpn.id).update({"lpn_id": None})
    number = lpn.lpn_number
    db.delete(lpn)
    db.commit()
    log_activity(db, user.id, user.username, "delete", "lpn", lpn_id, f"Deleted LPN '{number}'")
    db.commit()
    broadcast_change("lpn", "deleted")
    return {"deleted": lpn_id}
