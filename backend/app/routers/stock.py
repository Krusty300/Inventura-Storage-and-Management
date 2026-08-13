from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload
from app.database import get_db
from app.models.product import Product
from app.models.location import Location
from app.models.lot import Lot
from app.models.lpn import LPN
from app.models.serial_number import SerialNumber
from app.models.stock_line import StockLine
from app.models.stock_movement import StockMovement
from app.models.user import User
from app.schemas.stock_movement import (
    StockMovementAdjust,
    StockMovementCreate,
    StockMovementOut,
    StockMovementQuarantine,
    StockMovementSerialTransfer,
    StockMovementTransfer,
    StockMovementUnallocatedMove,
    StockMovementUpdate,
)
from app.services import inventory
from app.services.auth import get_current_user, require_permission
from app.services.notify import notify_expiring, notify_low_stock
from app.services.sequences import next_document_number
from app.utils import get_or_404, log_activity, broadcast_change, require_active_location

router = APIRouter(prefix="/api/stock-movements", tags=["stock-movements"], dependencies=[Depends(get_current_user)])


@router.get("")
def list_movements(search: str = Query(""), skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    q = db.query(StockMovement).options(
        joinedload(StockMovement.product), joinedload(StockMovement.user),
        joinedload(StockMovement.from_location), joinedload(StockMovement.to_location),
    )
    if search:
        like = f"%{search}%"
        q = q.join(StockMovement.product).filter(
            Product.name.ilike(like) | Product.sku.ilike(like) | StockMovement.reference.ilike(like) | StockMovement.notes.ilike(like)
        )
    total = q.count()
    items = q.order_by(StockMovement.created_at.desc()).offset(skip).limit(limit).all()
    return {"items": [StockMovementOut.model_validate(m) for m in items], "total": total, "page": (skip // limit) + 1, "pages": max(ceil(total / limit), 1)}


@router.get("/locations")
def product_stock_locations(
    product_id: int = Query(...),
    include_quarantined: bool = False,
    db: Session = Depends(get_db),
):
    """Locations that currently hold stock of a product, for the transfer modal.

    Returns each location with its on-hand quantity and a per-lot breakdown so
    the UI can pre-fill the source location dropdown from the selected product.
    With ``include_quarantined=True``, stock held in quarantined lots is counted
    too (e.g. LPN-ing up stock already sitting in a quarantine area); each lot
    entry carries its ``lot_status`` so callers can tell the two apart.
    """
    get_or_404(Product, product_id, db)
    if include_quarantined:
        lot_filter = Lot.status.in_(("in_stock", "quarantined"))
    else:
        lot_filter = Lot.status == "in_stock"
    stock = (
        db.query(
            StockLine.location_id,
            StockLine.lot_id,
            func.coalesce(func.sum(StockLine.quantity), 0).label("quantity"),
        )
        .outerjoin(Lot, StockLine.lot_id == Lot.id)
        .filter(
            StockLine.product_id == product_id,
            StockLine.quantity > 0,
            (StockLine.lot_id.is_(None)) | lot_filter,
        )
        .group_by(StockLine.location_id, StockLine.lot_id)
        .all()
    )
    location_ids = {r.location_id for r in stock if r.location_id is not None}
    locations = {
        l.id: l
        for l in db.query(Location).filter(Location.id.in_(location_ids)).all()
    } if location_ids else {}
    lot_ids = {r.lot_id for r in stock if r.lot_id is not None}
    lots = {
        l.id: l
        for l in db.query(Lot).filter(Lot.id.in_(lot_ids)).all()
    } if lot_ids else {}

    by_location: dict[int, dict] = {}
    unallocated = 0
    for row in stock:
        if row.location_id is None:
            unallocated += int(row.quantity or 0)
            continue
        entry = by_location.setdefault(row.location_id, {
            "location_id": row.location_id,
            "path": "",
            "is_active": False,
            "quantity": 0,
            "lots": [],
        })
        qty = int(row.quantity or 0)
        entry["quantity"] += qty
        if row.lot_id is not None:
            lot = lots.get(row.lot_id)
            entry["lots"].append({
                "lot_id": row.lot_id,
                "lot_number": lot.lot_number if lot else "",
                "lot_status": lot.status if lot else "",
                "quantity": qty,
            })

    result = []
    for loc_id, entry in by_location.items():
        loc = locations.get(loc_id)
        entry["path"] = loc.path if loc else ""
        entry["is_active"] = loc.is_active if loc else False
        entry["lots"].sort(key=lambda x: x["lot_number"])
        result.append(entry)
    result.sort(key=lambda x: x["path"].lower())
    return {"locations": result, "unallocated": unallocated}


@router.get("/quarantined-locations")
def product_quarantined_locations(product_id: int = Query(...), lot_id: int | None = None, db: Session = Depends(get_db)):
    """Locations holding quarantined stock of a product (optionally a single lot).

    Loose (non-LPN) quarantined stock only, matching what the quarantined-move
    endpoint can relocate. Bulk units come from stock lines in quarantined lots;
    serialized units are listed individually, so their locations are added from
    ``quarantined`` serial numbers. Powers the Move Quarantined Stock picker.
    """
    get_or_404(Product, product_id, db)
    if lot_id is not None:
        get_or_404(Lot, lot_id, db)
    q = (
        db.query(
            StockLine.location_id,
            StockLine.lot_id,
            func.coalesce(func.sum(StockLine.quantity), 0).label("quantity"),
        )
        .join(Lot, StockLine.lot_id == Lot.id)
        .filter(
            StockLine.product_id == product_id,
            StockLine.quantity > 0,
            StockLine.lpn_id.is_(None),
            StockLine.location_id.isnot(None),
            Lot.status == "quarantined",
        )
    )
    if lot_id is not None:
        q = q.filter(StockLine.lot_id == lot_id)
    rows = q.group_by(StockLine.location_id, StockLine.lot_id).all()

    serial_q = (
        db.query(
            SerialNumber.location_id,
            SerialNumber.lot_id,
            func.count(SerialNumber.id).label("count"),
        )
        .filter(
            SerialNumber.product_id == product_id,
            SerialNumber.status == inventory.SERIAL_STATUS_QUARANTINED,
            SerialNumber.lpn_id.is_(None),
            SerialNumber.location_id.isnot(None),
        )
    )
    if lot_id is not None:
        serial_q = serial_q.filter(SerialNumber.lot_id == lot_id)
    serial_rows = serial_q.group_by(SerialNumber.location_id, SerialNumber.lot_id).all()

    location_ids = {r.location_id for r in rows} | {r.location_id for r in serial_rows}
    locations = {
        l.id: l
        for l in db.query(Location).filter(Location.id.in_(location_ids)).all()
    } if location_ids else {}
    lot_ids = {r.lot_id for r in rows if r.lot_id is not None} | {r.lot_id for r in serial_rows if r.lot_id is not None}
    lots = {
        l.id: l
        for l in db.query(Lot).filter(Lot.id.in_(lot_ids)).all()
    } if lot_ids else {}

    by_location: dict[int, dict] = {}
    for row in rows:
        entry = by_location.setdefault(row.location_id, {
            "location_id": row.location_id,
            "path": "",
            "name": "",
            "quantity": 0,
            "lots": [],
        })
        qty = int(row.quantity or 0)
        entry["quantity"] += qty
        lot = lots.get(row.lot_id)
        entry["lots"].append({
            "lot_id": row.lot_id,
            "lot_number": lot.lot_number if lot else "",
            "lot_status": lot.status if lot else "",
            "quantity": qty,
        })
    for row in serial_rows:
        entry = by_location.setdefault(row.location_id, {
            "location_id": row.location_id,
            "path": "",
            "name": "",
            "quantity": 0,
            "lots": [],
        })
        count = int(row.count or 0)
        entry["quantity"] += count
        lot = lots.get(row.lot_id)
        entry["lots"].append({
            "lot_id": row.lot_id,
            "lot_number": lot.lot_number if lot else "",
            "lot_status": lot.status if lot else "",
            "quantity": count,
        })

    result = []
    for loc_id, entry in by_location.items():
        loc = locations.get(loc_id)
        entry["path"] = loc.path if loc else ""
        entry["name"] = loc.name if loc else ""
        entry["lots"].sort(key=lambda x: x["lot_number"])
        result.append(entry)
    result.sort(key=lambda x: x["path"].lower())
    return {"locations": result}


@router.post("", response_model=StockMovementOut, status_code=201)
def record_movement(data: StockMovementCreate, db: Session = Depends(get_db), user=Depends(require_permission("stock.record"))):
    product = get_or_404(Product, data.product_id, db)
    if not product.is_variant and db.query(Product).filter(Product.parent_id == product.id, Product.is_active == True).first():
        raise HTTPException(status_code=400, detail=f"'{product.display_name}' has variants - record movements on a specific variant")
    if product.is_serialized:
        raise HTTPException(status_code=400, detail="Serialized products must be managed through receipts")
    try:
        loc_id = require_active_location(db, product, data.location_id)
        reference = data.reference
        if not reference and data.movement_type == "return":
            reference = next_document_number(db, "return", "RET-")
        sm = inventory.post_journal_entry(
            db, product_id=product.id, user_id=user.id,
            quantity_change=data.quantity_change, movement_type=data.movement_type,
            from_location_id=loc_id if data.quantity_change < 0 else None,
            to_location_id=loc_id if data.quantity_change > 0 else None,
            reference=reference, notes=data.notes,
        )
    except inventory.InventoryError as e:
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    db.refresh(sm)
    log_activity(db, user.id, user.username, "create", "stock_movement", sm.id,
                 f"{data.movement_type} movement of {abs(data.quantity_change)} x '{product.display_name}'")
    notify_low_stock(db, product)
    notify_expiring(db, product)
    db.commit()
    broadcast_change("stock_movement", "created")
    return sm


@router.post("/transfer", status_code=201)
def transfer_stock(data: StockMovementTransfer, db: Session = Depends(get_db), user=Depends(require_permission("stock.record"))):
    product = get_or_404(Product, data.product_id, db)
    if not product.is_variant and db.query(Product).filter(Product.parent_id == product.id, Product.is_active == True).first():
        raise HTTPException(status_code=400, detail=f"'{product.display_name}' has variants - transfer a specific variant")
    if product.is_serialized:
        raise HTTPException(status_code=400, detail="Serialized items must be transferred by scanning their serial number")
    from_loc = get_or_404(Location, data.from_location_id, db)
    to_loc = get_or_404(Location, data.to_location_id, db)
    if not from_loc.is_active:
        raise HTTPException(status_code=400, detail=f"Source location '{from_loc.path}' is inactive")
    if not to_loc.is_active:
        raise HTTPException(status_code=400, detail=f"Destination location '{to_loc.path}' is inactive")
    if data.from_location_id == data.to_location_id:
        raise HTTPException(status_code=400, detail="Source and destination locations must differ")
    reference = next_document_number(db, "transfer", "TRF-")
    if data.lot_id is not None:
        lot = get_or_404(Lot, data.lot_id, db)
        if lot.status != "in_stock":
            raise HTTPException(
                status_code=400,
                detail=f"Lot '{lot.lot_number}' is {lot.status} and cannot be transferred. "
                "Release it (if quarantined) or dispose of it via a scrap/adjustment instead.",
            )
        if data.lpn_id is not None:
            line = db.query(StockLine).filter(
                StockLine.product_id == product.id,
                StockLine.location_id == from_loc.id,
                StockLine.lot_id == lot.id,
                StockLine.lpn_id == data.lpn_id,
            ).first()
            available = int(line.quantity) if line else 0
        else:
            available = db.query(func.coalesce(func.sum(StockLine.quantity), 0)).filter(
                StockLine.product_id == product.id,
                StockLine.location_id == from_loc.id,
                StockLine.lot_id == lot.id,
            ).scalar() or 0
        if available < data.quantity:
            raise HTTPException(
                status_code=400,
                detail=f"Lot '{lot.lot_number}' only has {available} on hand at '{from_loc.path}'",
            )
    else:
        if data.lpn_id is not None:
            available = db.query(func.coalesce(func.sum(StockLine.quantity), 0)).outerjoin(
                Lot, StockLine.lot_id == Lot.id
            ).filter(
                StockLine.product_id == product.id,
                StockLine.location_id == from_loc.id,
                StockLine.lpn_id == data.lpn_id,
                (StockLine.lot_id.is_(None)) | (Lot.status == "in_stock"),
            ).scalar() or 0
        else:
            available = db.query(func.coalesce(func.sum(StockLine.quantity), 0)).outerjoin(
                Lot, StockLine.lot_id == Lot.id
            ).filter(
                StockLine.product_id == product.id,
                StockLine.location_id == from_loc.id,
                (StockLine.lot_id.is_(None)) | (Lot.status == "in_stock"),
            ).scalar() or 0
        if available < data.quantity:
            blocked = inventory._blocked_lot_stock(
                db,
                product_id=product.id,
                location_id=None if data.lpn_id is not None else from_loc.id,
                lpn_id=data.lpn_id if data.lpn_id is not None else None,
            )
            if blocked:
                raise HTTPException(
                    status_code=400,
                    detail=f"Only {int(available)} sellable unit(s) on hand at '{from_loc.path}'. {inventory._blocked_lot_message(blocked)}",
                )
            raise HTTPException(
                status_code=400,
                detail=f"Only {int(available)} sellable unit(s) on hand at '{from_loc.path}'",
            )
    try:
        if data.lpn_id is not None:
            out, inbound = inventory.transfer_stock(
                db, product_id=product.id, user_id=user.id,
                quantity=data.quantity,
                from_location_id=data.from_location_id,
                to_location_id=data.to_location_id,
                lot_id=data.lot_id,
                lpn_id=data.lpn_id,
                reference_type="transfer", reference=reference,
                notes=data.notes,
            )
            movements = [out, inbound]
        else:
            # No LPN constraint: drain the location's stock across all LPN
            # identities (non-LPN first, then LPN-held) so the on-hand shown
            # in the transfer modal is fully moveable.
            movements = inventory.transfer_from_location(
                db, product_id=product.id, user_id=user.id,
                quantity=data.quantity,
                from_location_id=data.from_location_id,
                to_location_id=data.to_location_id,
                lot_id=data.lot_id,
                reference_type="transfer", reference=reference,
                notes=data.notes,
            )
            out, inbound = movements[0], movements[1]
    except inventory.InventoryError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    inventory.auto_quarantine(db, to_loc, movements)
    db.commit()
    log_activity(db, user.id, user.username, "create", "stock_movement", out.id,
                 f"Transfer {data.quantity} x '{product.display_name}' {reference} "
                 f"({out.from_location.name} -> {inbound.to_location.name})")
    notify_low_stock(db, product)
    db.commit()
    broadcast_change("stock_movement", "created")
    broadcast_change("product", "updated")
    return {
        "reference": reference,
        "outbound_id": out.id,
        "inbound_id": inbound.id,
        "movements": [StockMovementOut.model_validate(m) for m in movements],
    }


@router.post("/transfer-serial", status_code=201)
def transfer_serialized_stock(data: StockMovementSerialTransfer, db: Session = Depends(get_db), user=Depends(require_permission("stock.record"))):
    """Transfer serialized stock between locations by scanning individual serial numbers."""
    product = get_or_404(Product, data.product_id, db)
    if not product.is_serialized:
        raise HTTPException(status_code=400, detail=f"'{product.display_name}' is not serialized - use the quantity transfer instead")
    from_loc = get_or_404(Location, data.from_location_id, db)
    to_loc = get_or_404(Location, data.to_location_id, db)
    if not from_loc.is_active:
        raise HTTPException(status_code=400, detail=f"Source location '{from_loc.path}' is inactive")
    if not to_loc.is_active:
        raise HTTPException(status_code=400, detail=f"Destination location '{to_loc.path}' is inactive")
    if data.from_location_id == data.to_location_id:
        raise HTTPException(status_code=400, detail="Source and destination locations must differ")

    serials = db.query(SerialNumber).filter(SerialNumber.id.in_(data.serial_ids)).all()
    if len(serials) != len(data.serial_ids):
        raise HTTPException(status_code=400, detail="One or more serial numbers were not found")
    by_id = {s.id: s for s in serials}
    for serial_id in data.serial_ids:
        serial = by_id[serial_id]
        if serial.product_id != product.id:
            raise HTTPException(status_code=400, detail=f"Serial '{serial.serial_number}' does not belong to '{product.display_name}'")
        try:
            inventory.validate_serial_movable(serial)
        except inventory.InventoryError as e:
            raise HTTPException(status_code=400, detail=str(e))
        if serial.location_id != from_loc.id:
            raise HTTPException(status_code=400, detail=f"Serial '{serial.serial_number}' is not at '{from_loc.path}'")
        if serial.lpn_id is not None:
            lpn = db.query(LPN).filter(LPN.id == serial.lpn_id).first()
            lpn_label = lpn.lpn_number if lpn else str(serial.lpn_id)
            raise HTTPException(
                status_code=400,
                detail=f"Serial '{serial.serial_number}' is on LPN '{lpn_label}' - unload it from the LPN first",
            )

    reference = next_document_number(db, "transfer", "TRF-")
    movements: list[StockMovement] = []
    try:
        for serial_id in data.serial_ids:
            serial = by_id[serial_id]
            out, inbound = inventory.transfer_stock(
                db, product_id=product.id, user_id=user.id,
                quantity=1,
                from_location_id=from_loc.id,
                to_location_id=to_loc.id,
                lot_id=serial.lot_id,
                serial_id=serial.id,
                reference_type="transfer", reference=reference,
                notes=data.notes,
            )
            movements.extend([out, inbound])
    except inventory.InventoryError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    inventory.auto_quarantine(db, to_loc, movements)
    db.commit()
    log_activity(db, user.id, user.username, "create", "stock_movement", movements[0].id,
                 f"Transferred {len(data.serial_ids)} x '{product.display_name}' {reference} "
                 f"({from_loc.name} -> {to_loc.name}) by serial number")
    notify_low_stock(db, product)
    db.commit()
    broadcast_change("stock_movement", "created")
    broadcast_change("product", "updated")
    return {
        "reference": reference,
        "count": len(data.serial_ids),
        "movements": [StockMovementOut.model_validate(m) for m in movements],
    }


def _move_unallocated_serialized(
    db: Session, product: Product, to_loc: Location, serial_ids: list[int], notes: str, user: User
) -> dict:
    """Assign unallocated serialized units (no location) to a destination location.

    Serialized stock moves one unit at a time, so each selected serial is
    transferred individually and its location is set by the inbound leg.
    """
    if not serial_ids:
        raise HTTPException(status_code=400, detail="Select at least one serial number to move")
    serials = db.query(SerialNumber).filter(SerialNumber.id.in_(serial_ids)).all()
    if len(serials) != len(serial_ids):
        raise HTTPException(status_code=400, detail="One or more serial numbers were not found")
    by_id = {s.id: s for s in serials}
    allow_quarantined = to_loc.location_type == "quarantine"
    for sid in serial_ids:
        serial = by_id[sid]
        if serial.product_id != product.id:
            raise HTTPException(status_code=400, detail=f"Serial '{serial.serial_number}' does not belong to '{product.display_name}'")
        try:
            inventory.validate_serial_movable(serial, allow_quarantined=allow_quarantined)
        except inventory.InventoryError as e:
            raise HTTPException(status_code=400, detail=str(e))
        if serial.location_id is not None:
            raise HTTPException(status_code=400, detail=f"Serial '{serial.serial_number}' already has a location - transfer it instead")

    reference = next_document_number(db, "unallocated_move", "UNL-")
    movements: list[StockMovement] = []
    try:
        for sid in serial_ids:
            serial = by_id[sid]
            out, inbound = inventory.transfer_stock(
                db, product_id=product.id, user_id=user.id,
                quantity=1,
                from_location_id=None,
                to_location_id=to_loc.id,
                lot_id=serial.lot_id,
                serial_id=serial.id,
                reference_type="unallocated_move", reference=reference,
                notes=notes,
            )
            movements.extend([out, inbound])
    except inventory.InventoryError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    inventory.auto_quarantine(db, to_loc, movements)
    db.commit()
    log_activity(db, user.id, user.username, "create", "stock_movement", movements[0].id,
                 f"Moved {len(serial_ids)} unallocated x '{product.display_name}' to '{to_loc.path}' ({reference})")
    notify_low_stock(db, product)
    db.commit()
    broadcast_change("stock_movement", "created")
    broadcast_change("product", "updated")
    return {
        "reference": reference,
        "count": len(movements),
        "movements": [StockMovementOut.model_validate(m) for m in movements],
    }


@router.post("/unallocated-move", status_code=201)
def move_unallocated_stock(data: StockMovementUnallocatedMove, db: Session = Depends(get_db), user=Depends(require_permission("stock.record"))):
    """Move stock recorded with no location into a chosen destination location.

    Unallocated stock lines (location_id IS NULL) are not visible in any
    location view, so this lets an operator assign them to a real location.
    The move posts a matched transfer_out / transfer_in pair so the ledger
    stays consistent and the movements can be reverted like any transfer.
    Serialized units are moved individually by serial number.
    """
    product = get_or_404(Product, data.product_id, db)
    if not product.is_variant and db.query(Product).filter(Product.parent_id == product.id, Product.is_active == True).first():
        raise HTTPException(status_code=400, detail=f"'{product.display_name}' has variants - move stock on a specific variant")
    to_loc = get_or_404(Location, data.to_location_id, db)
    if not to_loc.is_active:
        raise HTTPException(status_code=400, detail=f"Destination location '{to_loc.path}' is inactive")

    if product.is_serialized:
        return _move_unallocated_serialized(db, product, to_loc, data.serial_ids or [], data.notes, user)

    if data.serial_ids:
        raise HTTPException(status_code=400, detail=f"'{product.display_name}' is not serialized - serial_ids cannot be used")

    if data.lot_id is not None:
        lot = get_or_404(Lot, data.lot_id, db)
        if lot.status not in ("in_stock", "quarantined"):
            raise HTTPException(
                status_code=400,
                detail=f"Lot '{lot.lot_number}' is {lot.status} and cannot be moved. Release it (if quarantined) or dispose of it via a scrap/adjustment instead.",
            )
        if lot.status == "quarantined" and to_loc.location_type != "quarantine":
            raise HTTPException(
                status_code=400,
                detail=f"Lot '{lot.lot_number}' is quarantined and can only be moved to a quarantine area.",
            )

    allow_quarantined = to_loc.location_type == "quarantine"
    if allow_quarantined:
        lot_status_filter = (StockLine.lot_id.is_(None)) | (Lot.status.in_(("in_stock", "quarantined")))
    else:
        lot_status_filter = (StockLine.lot_id.is_(None)) | (Lot.status == "in_stock")
    lines = (
        db.query(StockLine)
        .outerjoin(Lot, StockLine.lot_id == Lot.id)
        .filter(
            StockLine.product_id == product.id,
            StockLine.location_id.is_(None),
            StockLine.quantity > 0,
            lot_status_filter,
        )
        .order_by(StockLine.id)
        .all()
    )
    if data.lot_id is not None:
        lines = [l for l in lines if l.lot_id == data.lot_id]
    total = sum(l.quantity for l in lines)
    if data.quantity > total:
        blocked = inventory._blocked_lot_stock(db, product_id=product.id, include_quarantined=allow_quarantined)
        if blocked:
            raise HTTPException(
                status_code=400,
                detail=f"Only {total} movable unallocated unit(s) on hand for '{product.display_name}'. {inventory._blocked_lot_message(blocked)}",
            )
        raise HTTPException(status_code=400, detail=f"Only {total} unallocated unit(s) on hand for '{product.display_name}'")

    reference = next_document_number(db, "unallocated_move", "UNL-")
    movements: list[StockMovement] = []
    remaining = data.quantity
    try:
        for line in lines:
            if remaining <= 0:
                break
            take = min(line.quantity, remaining)
            if take <= 0:
                continue
            out, inbound = inventory.transfer_stock(
                db, product_id=product.id, user_id=user.id,
                quantity=take,
                from_location_id=None,
                to_location_id=to_loc.id,
                lot_id=line.lot_id,
                lpn_id=line.lpn_id,
                reference_type="unallocated_move", reference=reference,
                notes=data.notes,
            )
            movements.extend([out, inbound])
            remaining -= take
    except inventory.InventoryError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    inventory.auto_quarantine(db, to_loc, movements)
    db.commit()
    log_activity(db, user.id, user.username, "create", "stock_movement", movements[0].id,
                 f"Moved {data.quantity} unallocated x '{product.display_name}' to '{to_loc.path}' ({reference})")
    notify_low_stock(db, product)
    db.commit()
    broadcast_change("stock_movement", "created")
    broadcast_change("product", "updated")
    return {
        "reference": reference,
        "count": len(movements),
        "movements": [StockMovementOut.model_validate(m) for m in movements],
    }


@router.post("/quarantine", status_code=201)
def quarantine_stock(data: StockMovementQuarantine, db: Session = Depends(get_db), user=Depends(require_permission("stock.record"))):
    """Move stock into a quarantine-typed location and quarantine its lots.

    A first-class quarantine move: the destination must be a quarantine area,
    stock is moved loose, and the moved lot(s) are flipped to ``quarantined``
    so they stop being sellable and render with the quarantined design.
    Serialized units are moved individually and their serials are quarantined
    too. LPN-held and unallocated stock reach quarantine areas through the LPN
    move/unload and unallocated-move endpoints, which auto-quarantine on arrival.
    """
    product = get_or_404(Product, data.product_id, db)
    if not product.is_variant and db.query(Product).filter(Product.parent_id == product.id, Product.is_active == True).first():
        raise HTTPException(status_code=400, detail=f"'{product.display_name}' has variants - quarantine a specific variant")
    from_loc = get_or_404(Location, data.from_location_id, db)
    to_loc = get_or_404(Location, data.to_location_id, db)
    if not from_loc.is_active:
        raise HTTPException(status_code=400, detail=f"Source location '{from_loc.path}' is inactive")
    if not to_loc.is_active:
        raise HTTPException(status_code=400, detail=f"Quarantine area '{to_loc.path}' is inactive")
    if to_loc.location_type != "quarantine":
        raise HTTPException(status_code=400, detail=f"'{to_loc.path}' is not a quarantine area - pick a location with type 'quarantine'")
    if data.from_location_id == data.to_location_id:
        raise HTTPException(status_code=400, detail="Source and quarantine locations must differ")

    reference = next_document_number(db, "quarantine", "QAR-")
    movements: list[StockMovement] = []
    try:
        if product.is_serialized:
            if not data.serial_ids:
                raise HTTPException(status_code=400, detail="Select at least one serial number to quarantine")
            if data.lot_id is not None:
                raise HTTPException(status_code=400, detail="Select serial numbers instead of a lot for serialized products")
            serials = db.query(SerialNumber).filter(SerialNumber.id.in_(data.serial_ids)).all()
            if len(serials) != len(data.serial_ids):
                raise HTTPException(status_code=400, detail="One or more serial numbers were not found")
            by_id = {s.id: s for s in serials}
            for serial_id in data.serial_ids:
                serial = by_id[serial_id]
                if serial.product_id != product.id:
                    raise HTTPException(status_code=400, detail=f"Serial '{serial.serial_number}' does not belong to '{product.display_name}'")
                try:
                    inventory.validate_serial_movable(serial)
                except inventory.InventoryError as e:
                    raise HTTPException(status_code=400, detail=str(e))
                if serial.location_id != from_loc.id:
                    raise HTTPException(status_code=400, detail=f"Serial '{serial.serial_number}' is not at '{from_loc.path}'")
                if serial.lpn_id is not None:
                    lpn = db.query(LPN).filter(LPN.id == serial.lpn_id).first()
                    lpn_label = lpn.lpn_number if lpn else str(serial.lpn_id)
                    raise HTTPException(
                        status_code=400,
                        detail=f"Serial '{serial.serial_number}' is on LPN '{lpn_label}' - unload it from the LPN first",
                    )
            for serial_id in data.serial_ids:
                serial = by_id[serial_id]
                out, inbound = inventory.transfer_stock(
                    db, product_id=product.id, user_id=user.id,
                    quantity=1,
                    from_location_id=from_loc.id,
                    to_location_id=to_loc.id,
                    lot_id=serial.lot_id,
                    serial_id=serial.id,
                    reference_type="quarantine", reference=reference,
                    notes=data.notes,
                )
                movements.extend([out, inbound])
        else:
            if data.serial_ids:
                raise HTTPException(status_code=400, detail=f"'{product.display_name}' is not serialized - serial_ids cannot be used")
            if data.lot_id is not None:
                lot = get_or_404(Lot, data.lot_id, db)
                if lot.status != "in_stock":
                    raise HTTPException(
                        status_code=400,
                        detail=f"Lot '{lot.lot_number}' is {lot.status} and cannot be quarantined. "
                        "Release it (if quarantined) or dispose of it via a scrap/adjustment instead.",
                    )
            lines = (
                db.query(StockLine)
                .outerjoin(Lot, StockLine.lot_id == Lot.id)
                .filter(
                    StockLine.product_id == product.id,
                    StockLine.location_id == from_loc.id,
                    StockLine.lpn_id.is_(None),
                    StockLine.quantity > 0,
                    (StockLine.lot_id.is_(None)) | (Lot.status == "in_stock"),
                )
                .order_by(StockLine.id)
                .all()
            )
            if data.lot_id is not None:
                lines = [l for l in lines if l.lot_id == data.lot_id]
            total = sum(l.quantity for l in lines)
            if data.quantity > total:
                blocked = inventory._blocked_lot_stock(db, product_id=product.id, location_id=from_loc.id)
                if blocked:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Only {total} sellable unit(s) at '{from_loc.path}'. {inventory._blocked_lot_message(blocked)}",
                    )
                raise HTTPException(status_code=400, detail=f"Only {total} sellable unit(s) at '{from_loc.path}'")
            remaining = data.quantity
            for line in lines:
                if remaining <= 0:
                    break
                take = min(line.quantity, remaining)
                if take <= 0:
                    continue
                out, inbound = inventory.transfer_stock(
                    db, product_id=product.id, user_id=user.id,
                    quantity=take,
                    from_location_id=from_loc.id,
                    to_location_id=to_loc.id,
                    lot_id=line.lot_id,
                    lpn_id=None,
                    reference_type="quarantine", reference=reference,
                    notes=data.notes,
                )
                movements.extend([out, inbound])
                remaining -= take
    except inventory.InventoryError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

    inventory.auto_quarantine(db, to_loc, movements)
    db.commit()
    log_activity(db, user.id, user.username, "create", "stock_movement", movements[0].id,
                 f"Quarantined {data.quantity if not product.is_serialized else len(data.serial_ids)} x '{product.display_name}' "
                 f"at '{to_loc.path}' ({reference})")
    notify_low_stock(db, product)
    db.commit()
    broadcast_change("stock_movement", "created")
    broadcast_change("product", "updated")
    return {
        "reference": reference,
        "count": len(movements),
        "movements": [StockMovementOut.model_validate(m) for m in movements],
    }


@router.post("/quarantined-move", status_code=201)
def move_quarantined_stock(data: StockMovementQuarantine, db: Session = Depends(get_db), user=Depends(require_permission("stock.record"))):
    """Relocate already-quarantined stock between locations without releasing it.

    Posting a matched transfer pair keeps the lot(s) ``quarantined`` - nothing
    becomes sellable in the process. Use this to move quarantined stock into a
    quarantine area, between quarantine areas, or anywhere else in the warehouse.
    """
    product = get_or_404(Product, data.product_id, db)
    if not product.is_variant and db.query(Product).filter(Product.parent_id == product.id, Product.is_active == True).first():
        raise HTTPException(status_code=400, detail=f"'{product.display_name}' has variants - move quarantined stock on a specific variant")
    from_loc = get_or_404(Location, data.from_location_id, db)
    to_loc = get_or_404(Location, data.to_location_id, db)
    if not from_loc.is_active:
        raise HTTPException(status_code=400, detail=f"Source location '{from_loc.path}' is inactive")
    if not to_loc.is_active:
        raise HTTPException(status_code=400, detail=f"Destination location '{to_loc.path}' is inactive")
    if data.from_location_id == data.to_location_id:
        raise HTTPException(status_code=400, detail="Source and destination locations must differ")

    reference = next_document_number(db, "transfer", "TRF-")
    movements: list[StockMovement] = []
    try:
        if product.is_serialized:
            if not data.serial_ids:
                raise HTTPException(status_code=400, detail="Select at least one serial number to move")
            if data.lot_id is not None:
                raise HTTPException(status_code=400, detail="Select serial numbers instead of a lot for serialized products")
            serials = db.query(SerialNumber).filter(SerialNumber.id.in_(data.serial_ids)).all()
            if len(serials) != len(data.serial_ids):
                raise HTTPException(status_code=400, detail="One or more serial numbers were not found")
            by_id = {s.id: s for s in serials}
            for serial_id in data.serial_ids:
                serial = by_id[serial_id]
                if serial.product_id != product.id:
                    raise HTTPException(status_code=400, detail=f"Serial '{serial.serial_number}' does not belong to '{product.display_name}'")
                if serial.status != inventory.SERIAL_STATUS_QUARANTINED:
                    raise HTTPException(status_code=400, detail=f"Serial '{serial.serial_number}' is not quarantined (status: {serial.status})")
                if serial.location_id != from_loc.id:
                    raise HTTPException(status_code=400, detail=f"Serial '{serial.serial_number}' is not at '{from_loc.path}'")
                if serial.lpn_id is not None:
                    lpn = db.query(LPN).filter(LPN.id == serial.lpn_id).first()
                    lpn_label = lpn.lpn_number if lpn else str(serial.lpn_id)
                    raise HTTPException(
                        status_code=400,
                        detail=f"Serial '{serial.serial_number}' is on LPN '{lpn_label}' - unload it from the LPN first",
                    )
            for serial_id in data.serial_ids:
                serial = by_id[serial_id]
                out, inbound = inventory.transfer_stock(
                    db, product_id=product.id, user_id=user.id,
                    quantity=1,
                    from_location_id=from_loc.id,
                    to_location_id=to_loc.id,
                    lot_id=serial.lot_id,
                    serial_id=serial.id,
                    reference_type="transfer", reference=reference,
                    notes=data.notes,
                )
                movements.extend([out, inbound])
            # Transfer legs reset a serial to ``in_stock`` (inventory.post_journal_entry);
            # restore the quarantined status the move is meant to preserve.
            for serial_id in data.serial_ids:
                by_id[serial_id].status = inventory.SERIAL_STATUS_QUARANTINED
        else:
            if data.serial_ids:
                raise HTTPException(status_code=400, detail=f"'{product.display_name}' is not serialized - serial_ids cannot be used")
            if data.lot_id is not None:
                lot = get_or_404(Lot, data.lot_id, db)
                if lot.status != "quarantined":
                    raise HTTPException(
                        status_code=400,
                        detail=f"Lot '{lot.lot_number}' is {lot.status} and cannot be moved as quarantined. "
                        "Use the regular transfer for sellable stock.",
                    )
            lines = (
                db.query(StockLine)
                .outerjoin(Lot, StockLine.lot_id == Lot.id)
                .filter(
                    StockLine.product_id == product.id,
                    StockLine.location_id == from_loc.id,
                    StockLine.lpn_id.is_(None),
                    StockLine.quantity > 0,
                    Lot.status == "quarantined",
                )
                .order_by(StockLine.id)
                .all()
            )
            if data.lot_id is not None:
                lines = [l for l in lines if l.lot_id == data.lot_id]
            total = sum(l.quantity for l in lines)
            if data.quantity > total:
                suffix = f" for lot '{lot.lot_number}'" if data.lot_id is not None else ""
                raise HTTPException(
                    status_code=400,
                    detail=f"Only {total} quarantined unit(s) at '{from_loc.path}'{suffix}",
                )
            remaining = data.quantity
            for line in lines:
                if remaining <= 0:
                    break
                take = min(line.quantity, remaining)
                if take <= 0:
                    continue
                out, inbound = inventory.transfer_stock(
                    db, product_id=product.id, user_id=user.id,
                    quantity=take,
                    from_location_id=from_loc.id,
                    to_location_id=to_loc.id,
                    lot_id=line.lot_id,
                    lpn_id=None,
                    reference_type="transfer", reference=reference,
                    notes=data.notes,
                )
                movements.extend([out, inbound])
                remaining -= take
    except inventory.InventoryError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

    db.commit()
    log_activity(db, user.id, user.username, "create", "stock_movement", movements[0].id,
                 f"Moved quarantined {data.quantity if not product.is_serialized else len(data.serial_ids)} x '{product.display_name}' "
                 f"({from_loc.name} -> {to_loc.name}) {reference}")
    notify_low_stock(db, product)
    db.commit()
    broadcast_change("stock_movement", "created")
    broadcast_change("product", "updated")
    return {
        "reference": reference,
        "outbound_id": movements[0].id,
        "inbound_id": movements[1].id,
        "movements": [StockMovementOut.model_validate(m) for m in movements],
    }


@router.post("/adjust", status_code=201)
def adjust_stock(data: StockMovementAdjust, db: Session = Depends(get_db), user=Depends(require_permission("stock.adjust"))):
    product = get_or_404(Product, data.product_id, db)
    if not product.is_variant and db.query(Product).filter(Product.parent_id == product.id, Product.is_active == True).first():
        raise HTTPException(status_code=400, detail=f"'{product.display_name}' has variants - adjust stock on a specific variant")
    if product.is_serialized:
        raise HTTPException(status_code=400, detail="Serialized products are tracked per serial number and cannot be quantity-adjusted")
    if data.location_id is not None:
        loc_id = require_active_location(db, product, data.location_id)
        old_qty = inventory.on_hand(db, product_id=product.id, location_id=loc_id)
    else:
        old_qty = product.quantity
        loc_id = require_active_location(db, product)
    qty_change = data.new_quantity - old_qty
    if qty_change == 0:
        raise HTTPException(status_code=400, detail="New quantity is the same as current quantity")
    try:
        sm = inventory.post_journal_entry(
            db, product_id=product.id, user_id=user.id,
            quantity_change=qty_change, movement_type="adjustment",
            from_location_id=loc_id if qty_change < 0 else None,
            to_location_id=loc_id if qty_change > 0 else None,
            reference=f"Adjustment ({data.reason_code})",
            notes=data.notes,
        )
    except inventory.InventoryError as e:
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    db.refresh(sm)
    target = "the product default location"
    if data.location_id is not None:
        loc = db.get(Location, loc_id)
        target = f"location '{loc.path}'" if loc else f"location #{loc_id}"
    log_activity(db, user.id, user.username, "create", "stock_movement", sm.id,
                 f"Adjusted '{product.display_name}' at {target} from {old_qty} to {data.new_quantity} ({data.reason_code})")
    notify_low_stock(db, product)
    db.commit()
    broadcast_change("stock_movement", "created")
    broadcast_change("product", "updated")
    return {"id": sm.id, "product_id": product.id, "product_name": product.display_name, "quantity_change": qty_change,
            "new_quantity": data.new_quantity, "reason_code": data.reason_code, "location_id": loc_id}


@router.put("/{movement_id}", response_model=StockMovementOut)
def update_movement(movement_id: int, data: StockMovementUpdate, db: Session = Depends(get_db), user=Depends(require_permission("stock.update"))):
    sm = get_or_404(StockMovement, movement_id, db)
    if sm.movement_type == inventory.SHIP:
        raise HTTPException(status_code=400, detail="Shipped stock movements cannot be edited - stock was already shipped to the customer")
    updates = data.model_dump(exclude_unset=True)
    if sm.movement_type in (inventory.TRANSFER_OUT, inventory.TRANSFER_IN):
        new_qty_change = updates.get("quantity_change", sm.quantity_change)
        new_product_id = updates.get("product_id", sm.product_id)
        new_movement_type = updates.get("movement_type", sm.movement_type)
        if new_product_id != sm.product_id or new_qty_change != sm.quantity_change or new_movement_type != sm.movement_type:
            raise HTTPException(
                status_code=400,
                detail="Transfer movements belong to a matched pair and cannot be edited. Delete the transfer to revert it instead.",
            )
    old_qty_change = sm.quantity_change
    old_product_id = sm.product_id
    new_qty_change = updates.get("quantity_change", old_qty_change)
    new_product_id = updates.get("product_id", old_product_id)
    if new_product_id != old_product_id or new_qty_change != old_qty_change:
        old_product = get_or_404(Product, old_product_id, db)
        new_product = get_or_404(Product, new_product_id, db)
        old_loc = sm.to_location_id if old_qty_change > 0 else sm.from_location_id
        if old_loc is None:
            old_loc = require_active_location(db, old_product)
        new_loc = require_active_location(db, new_product, updates.get("location_id"))
        try:
            inventory.post_journal_entry(
                db, product_id=old_product_id, user_id=user.id,
                quantity_change=-old_qty_change, movement_type="adjustment",
                from_location_id=old_loc if old_qty_change > 0 else None,
                to_location_id=old_loc if old_qty_change < 0 else None,
                reference=f"Reversed {sm.id}", notes="Reversal of edited stock movement",
            )
            inventory.post_journal_entry(
                db, product_id=new_product_id, user_id=user.id,
                quantity_change=new_qty_change, movement_type="adjustment",
                from_location_id=new_loc if new_qty_change < 0 else None,
                to_location_id=new_loc if new_qty_change > 0 else None,
                reference=f"Applied {sm.id}", notes="Re-application of edited stock movement",
            )
        except inventory.InventoryError as e:
            raise HTTPException(status_code=400, detail=str(e))
    for k, v in updates.items():
        setattr(sm, k, v)
    db.commit()
    db.refresh(sm)
    log_activity(db, user.id, user.username, "update", "stock_movement", sm.id, f"Updated stock movement #{sm.id}")
    db.commit()
    broadcast_change("stock_movement", "updated")
    broadcast_change("product", "updated")
    return sm


@router.delete("/{movement_id}")
def delete_movement(movement_id: int, db: Session = Depends(get_db), user=Depends(require_permission("stock.delete"))):
    sm = get_or_404(StockMovement, movement_id, db)
    if sm.movement_type == inventory.SHIP:
        raise HTTPException(status_code=400, detail="Shipped stock movements cannot be deleted - stock was already shipped to the customer")
    legs = [sm]
    if sm.movement_type in (inventory.TRANSFER_OUT, inventory.TRANSFER_IN):
        other = db.get(StockMovement, sm.transfer_id) if sm.transfer_id else None
        if other and other.movement_type in (inventory.TRANSFER_OUT, inventory.TRANSFER_IN) and other.id != sm.id:
            legs = [sm, other]
    try:
        for leg in legs:
            if leg.movement_type == inventory.TRANSFER_OUT:
                inventory.post_journal_entry(
                    db, product_id=leg.product_id, user_id=user.id,
                    quantity_change=-leg.quantity_change, movement_type="adjustment",
                    to_location_id=leg.from_location_id,
                    lot_id=leg.lot_id, lpn_id=leg.lpn_id, serial_id=leg.serial_id,
                    reference=f"Reversed {leg.id}", notes="Deleted transfer movement reversal",
                )
            elif leg.movement_type == inventory.TRANSFER_IN:
                if leg.serial_id is not None:
                    continue  # the paired transfer_out reversal already restores the serial's location
                inventory.post_journal_entry(
                    db, product_id=leg.product_id, user_id=user.id,
                    quantity_change=-leg.quantity_change, movement_type="adjustment",
                    from_location_id=leg.to_location_id,
                    lot_id=leg.lot_id, lpn_id=leg.lpn_id,
                    reference=f"Reversed {leg.id}", notes="Deleted transfer movement reversal",
                )
            else:
                product = get_or_404(Product, leg.product_id, db)
                loc_id = require_active_location(db, product)
                inventory.post_journal_entry(
                    db, product_id=leg.product_id, user_id=user.id,
                    quantity_change=-leg.quantity_change, movement_type="adjustment",
                    from_location_id=loc_id if leg.quantity_change > 0 else None,
                    to_location_id=loc_id if leg.quantity_change < 0 else None,
                    reference=f"Reversed {leg.id}", notes="Deleted stock movement reversal",
                )
    except inventory.InventoryError as e:
        raise HTTPException(status_code=400, detail=str(e))
    for leg in legs:
        db.delete(leg)
    db.commit()
    log_activity(db, user.id, user.username, "delete", "stock_movement", movement_id,
                 f"Deleted stock movement #{movement_id}" + (f" and its paired movement #{sm.transfer_id}" if len(legs) > 1 else ""))
    db.commit()
    broadcast_change("stock_movement", "deleted")
    broadcast_change("product", "updated")
