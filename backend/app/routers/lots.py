from datetime import date
from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models.lot import Lot
from app.models.product import Product
from app.models.stock_movement import StockMovement
from app.models.supplier import Supplier
from app.schemas.lot import LOT_STATUSES, LotOut, LotUpdate
from app.schemas.stock_movement import StockMovementOut
from app.services.auth import get_current_user, require_permission
from app.utils import get_or_404, log_activity, broadcast_change

router = APIRouter(prefix="/api/lots", tags=["lots"], dependencies=[Depends(get_current_user)])


def _load_lot(db: Session, lot_id: int) -> Lot:
    return get_or_404(Lot, lot_id, db, options=[
        joinedload(Lot.product), joinedload(Lot.supplier),
        joinedload(Lot.stock_lines), joinedload(Lot.serial_numbers),
    ])


@router.get("")
def list_lots(
    product_id: int | None = None,
    status: str | None = None,
    search: str = Query(""),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    db: Session = Depends(get_db),
):
    q = db.query(Lot).options(
        joinedload(Lot.product), joinedload(Lot.supplier),
        joinedload(Lot.stock_lines), joinedload(Lot.serial_numbers),
    )
    if product_id:
        q = q.filter(Lot.product_id == product_id)
    if status:
        if status not in LOT_STATUSES:
            raise HTTPException(status_code=400, detail=f"status must be one of {LOT_STATUSES}")
        q = q.filter(Lot.status == status)
    if search:
        like = f"%{search}%"
        q = q.join(Lot.product).filter(
            Lot.lot_number.ilike(like) | Product.name.ilike(like) | Product.sku.ilike(like)
        )
    total = q.count()
    items = q.order_by(Lot.created_at.desc()).offset(skip).limit(limit).all()
    return {"items": [LotOut.model_validate(l) for l in items], "total": total,
            "page": (skip // limit) + 1, "pages": max(ceil(total / limit), 1)}


@router.get("/{lot_id}", response_model=LotOut)
def get_lot(lot_id: int, db: Session = Depends(get_db)):
    return _load_lot(db, lot_id)


@router.put("/{lot_id}", response_model=LotOut)
def update_lot(lot_id: int, data: LotUpdate, db: Session = Depends(get_db), user=Depends(require_permission("lots.update"))):
    lot = _load_lot(db, lot_id)
    updates = data.model_dump(exclude_unset=True)
    if updates.get("supplier_id") is not None:
        get_or_404(Supplier, updates["supplier_id"], db)
    for k, v in updates.items():
        setattr(lot, k, v)
    db.commit()
    db.refresh(lot)
    log_activity(db, user.id, user.username, "update", "lot", lot.id,
                 f"Updated lot '{lot.lot_number}' (status: {lot.status})")
    db.commit()
    broadcast_change("lot", "updated")
    return _load_lot(db, lot.id)


@router.get("/{lot_id}/movements", response_model=list[StockMovementOut])
def lot_movements(lot_id: int, db: Session = Depends(get_db)):
    _load_lot(db, lot_id)
    return db.query(StockMovement).options(
        joinedload(StockMovement.product), joinedload(StockMovement.user)
    ).filter(StockMovement.lot_id == lot_id).order_by(StockMovement.created_at.desc()).all()
