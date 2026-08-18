from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from app.constants import MAX_PAGE_SIZE
from app.database import get_db
from app.models.lot import Lot
from app.models.lot_link import LotLink
from app.models.product import Product
from app.models.serial_number import SerialNumber
from app.models.stock_line import StockLine
from app.models.stock_movement import StockMovement
from app.models.supplier import Supplier
from app.schemas.lot import LOT_STATUSES, LotOut, LotUpdate
from app.schemas.stock_movement import StockMovementOut
from app.services import inventory
from app.services.auth import require_permission
from app.services.csv_export import csv_response
from app.utils import get_or_404, log_activity, broadcast_change

router = APIRouter(prefix="/api/lots", tags=["lots"], dependencies=[Depends(require_permission("lots.view"))])

# Controlled status transitions. A lot can only move between states along these
# edges; QC failures quarantine, and a release restores sellable stock. The
# ``sold`` state is derived automatically when a serialized lot is fully
# shipped (and reverted on refund), so it has no manual transitions.
ALLOWED_LOT_TRANSITIONS = {
    "in_stock": {"quarantined", "expired"},
    "quarantined": {"in_stock", "expired"},
    "expired": set(),
    "sold": set(),
}


def _load_lot(db: Session, lot_id: int) -> Lot:
    return get_or_404(Lot, lot_id, db, options=[
        joinedload(Lot.product), joinedload(Lot.supplier),
        joinedload(Lot.stock_lines).joinedload(StockLine.location),
        joinedload(Lot.serial_numbers).joinedload(SerialNumber.location),
    ])


@router.get("")
def list_lots(
    product_id: int | None = None,
    status: str | None = None,
    search: str = Query(""),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=MAX_PAGE_SIZE),
    db: Session = Depends(get_db),
):
    inventory.expire_overdue_lots(db)
    q = db.query(Lot).options(
        joinedload(Lot.product), joinedload(Lot.supplier),
        joinedload(Lot.stock_lines).joinedload(StockLine.location),
        joinedload(Lot.serial_numbers).joinedload(SerialNumber.location),
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


@router.get("/export")
def export_lots(
    product_id: int | None = None,
    status: str | None = None,
    search: str = Query(""),
    db: Session = Depends(get_db),
):
    q = db.query(Lot).options(
        joinedload(Lot.product), joinedload(Lot.supplier),
        joinedload(Lot.stock_lines).joinedload(StockLine.location),
        joinedload(Lot.serial_numbers).joinedload(SerialNumber.location),
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
    lots = q.order_by(Lot.created_at.desc()).all()
    return csv_response(
        "lots_report",
        ["Lot #", "Product", "SKU", "Supplier", "Status", "Expiry", "Received", "On Hand", "Stock Lines", "Serials", "Created"],
        [[
            l.lot_number,
            l.product.display_name if l.product else "",
            l.product.sku if l.product else "",
            l.supplier.name if l.supplier else "",
            l.status,
            l.expiry_date.strftime("%Y-%m-%d") if l.expiry_date else "",
            l.received_date.strftime("%Y-%m-%d") if l.received_date else "",
            l.on_hand,
            len(l.stock_lines),
            len(l.serial_numbers),
            l.created_at.strftime("%Y-%m-%d %H:%M") if l.created_at else "",
        ] for l in lots],
    )


@router.get("/{lot_id}", response_model=LotOut)
def get_lot(lot_id: int, db: Session = Depends(get_db)):
    return _load_lot(db, lot_id)


@router.put("/{lot_id}", response_model=LotOut)
def update_lot(lot_id: int, data: LotUpdate, db: Session = Depends(get_db), user=Depends(require_permission("lots.update"))):
    lot = _load_lot(db, lot_id)
    updates = data.model_dump(exclude_unset=True)
    if updates.get("supplier_id") is not None:
        get_or_404(Supplier, updates["supplier_id"], db)
    prior_status = lot.status
    if "status" in updates and updates["status"] != prior_status:
        allowed = ALLOWED_LOT_TRANSITIONS.get(prior_status, set())
        if updates["status"] not in allowed:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid lot transition: '{prior_status}' -> '{updates['status']}' (allowed: {sorted(allowed) or 'none'})",
            )
    for k, v in updates.items():
        setattr(lot, k, v)
    if lot.status == "quarantined" and prior_status != "quarantined":
        # Quarantining a serialized lot must also quarantine its serials so
        # serialized units are not left as in-stock inside a blocked lot.
        inventory.quarantine_lot_serials(db, lot)
    if prior_status == "quarantined" and lot.status == "in_stock":
        # Releasing a quarantined lot must also release its quarantined serials
        # so serialized units are not left permanently stuck in quarantine.
        inventory.release_lot_serials(
            db, lot, user_id=user.id,
            reference=f"Lot '{lot.lot_number}' released",
            notes="Lot released from quarantine - serials restored to in stock",
        )
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
