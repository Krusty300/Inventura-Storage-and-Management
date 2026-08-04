from datetime import date
from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models.lot import Lot
from app.models.lot_link import LotLink
from app.models.product import Product
from app.models.stock_movement import StockMovement
from app.models.supplier import Supplier
from app.schemas.lot import LOT_STATUSES, LotOut, LotUpdate
from app.schemas.stock_movement import StockMovementOut
from app.services.auth import get_current_user, require_permission
from app.utils import get_or_404, log_activity, broadcast_change

router = APIRouter(prefix="/api/lots", tags=["lots"], dependencies=[Depends(get_current_user)])

# Controlled status transitions. A lot can only move between states along these
# edges; QC failures quarantine, and a release restores sellable stock.
ALLOWED_LOT_TRANSITIONS = {
    "in_stock": {"quarantined", "expired"},
    "quarantined": {"in_stock", "expired"},
    "expired": set(),
}


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
    if "status" in updates and updates["status"] != lot.status:
        allowed = ALLOWED_LOT_TRANSITIONS.get(lot.status, set())
        if updates["status"] not in allowed:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid lot transition: '{lot.status}' -> '{updates['status']}' (allowed: {sorted(allowed) or 'none'})",
            )
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


def _genealogy_lot_row(lot: Lot, quantity: int, work_order_id: int | None, wo_number: str) -> dict:
    return {
        "lot_id": lot.id,
        "lot_number": lot.lot_number,
        "product_id": lot.product_id,
        "product_name": lot.product_name,
        "status": lot.status,
        "quantity": quantity,
        "work_order_id": work_order_id,
        "wo_number": wo_number,
    }


@router.get("/{lot_id}/genealogy")
def lot_genealogy(lot_id: int, db: Session = Depends(get_db)):
    """Parents, children, and all downstream (recall) lots for a lot.

    ``affected`` walks the child links breadth-first so a recall starting at a
    raw material lot lists every finished good that consumed it transitively.
    """
    lot = _load_lot(db, lot_id)
    parents = []
    for link in db.query(LotLink).options(
        joinedload(LotLink.parent), joinedload(LotLink.work_order)
    ).filter(LotLink.child_lot_id == lot_id).all():
        parents.append(_genealogy_lot_row(
            link.parent, link.quantity, link.work_order_id,
            link.work_order.wo_number if link.work_order else "",
        ))
    children = []
    for link in db.query(LotLink).options(
        joinedload(LotLink.child), joinedload(LotLink.work_order)
    ).filter(LotLink.parent_lot_id == lot_id).all():
        children.append(_genealogy_lot_row(
            link.child, link.quantity, link.work_order_id,
            link.work_order.wo_number if link.work_order else "",
        ))

    affected = []
    visited = {lot.id}
    queue = [(link.child, link.quantity) for link in lot.child_links]
    depth = 1
    max_depth = 12
    while queue and depth <= max_depth:
        next_queue = []
        for child, quantity in queue:
            if child.id in visited:
                continue
            visited.add(child.id)
            affected.append({
                "lot_id": child.id,
                "lot_number": child.lot_number,
                "product_id": child.product_id,
                "product_name": child.product_name,
                "status": child.status,
                "quantity": quantity,
                "depth": depth,
            })
            for cl in child.child_links:
                next_queue.append((cl.child, cl.quantity))
        queue = next_queue
        depth += 1

    return {
        "lot_id": lot.id,
        "lot_number": lot.lot_number,
        "product_id": lot.product_id,
        "product_name": lot.product_name,
        "status": lot.status,
        "on_hand": lot.on_hand,
        "serial_count": lot.serial_count,
        "parents": parents,
        "children": children,
        "affected": affected,
    }
