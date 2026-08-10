from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models import LPN, Location, Lot, Product, SerialNumber, StockLine, StockMovement
from app.schemas.lpn import LPNCreate, LPNLoadIn, LPNOut, LPNUnloadIn, LPNUpdate
from app.schemas.stock_movement import StockMovementOut
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


@router.get("/{lpn_id}/movements", response_model=list[StockMovementOut])
def lpn_movements(
    lpn_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    """Ledger activity for an LPN: loads, unloads, receipts, shipment picks,
    and moves, newest first."""
    get_or_404(LPN, lpn_id, db)
    return db.query(StockMovement).options(
        joinedload(StockMovement.product),
        joinedload(StockMovement.user),
        joinedload(StockMovement.from_location),
        joinedload(StockMovement.to_location),
        joinedload(StockMovement.lot),
        joinedload(StockMovement.serial_number),
    ).filter(StockMovement.lpn_id == lpn_id).order_by(
        StockMovement.created_at.desc(), StockMovement.id.desc()
    ).offset(skip).limit(limit).all()


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
    moving_to_quarantine = target.location_type == "quarantine"
    blocked: list[tuple[str, str]] = []
    for sl in lpn.stock_lines:
        if sl.lot is not None and (sl.lot.status not in ("in_stock", "quarantined") or (sl.lot.status == "quarantined" and not moving_to_quarantine)):
            blocked.append((sl.lot.lot_number, sl.lot.status))
    for serial in db.query(SerialNumber).filter(SerialNumber.lpn_id == lpn.id).all():
        if serial.lot is not None and (serial.lot.status not in ("in_stock", "quarantined") or (serial.lot.status == "quarantined" and not moving_to_quarantine)):
            blocked.append((serial.lot.lot_number, serial.lot.status))
    if blocked:
        details = ", ".join(f"'{num}' ({status})" for num, status in dict.fromkeys(blocked))
        raise HTTPException(
            status_code=400,
            detail=f"LPN '{lpn.lpn_number}' holds stock from lot(s) that cannot be moved to '{target.path}': {details}. Quarantined stock can only be moved to a quarantine area; expired stock must be unloaded and disposed of first.",
        )
    reference = next_document_number(db, "lpn_move", "MOV-")
    movements: list[StockMovement] = []
    try:
        for sl in lpn.stock_lines:
            movements.extend(inventory.transfer_stock(
                db, product_id=sl.product_id, user_id=user.id, quantity=sl.quantity,
                from_location_id=lpn.location_id, to_location_id=to_location_id,
                lot_id=sl.lot_id, lpn_id=lpn.id,
                reference_type="lpn_move", reference=reference,
                notes=f"Moved LPN '{lpn.lpn_number}' to {target.path}",
            ))
        for serial in db.query(SerialNumber).filter(SerialNumber.lpn_id == lpn.id).all():
            movements.extend(inventory.transfer_stock(
                db, product_id=serial.product_id, user_id=user.id, quantity=1,
                from_location_id=lpn.location_id, to_location_id=to_location_id,
                lot_id=serial.lot_id, serial_id=serial.id, lpn_id=lpn.id,
                reference_type="lpn_move", reference=reference,
                notes=f"Moved LPN '{lpn.lpn_number}' to {target.path}",
            ))
        lpn.location_id = to_location_id
        db.flush()
    except inventory.InventoryError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    inventory.auto_quarantine(db, target, movements)
    db.commit()
    lpn = _load_lpn(db, lpn.id)
    log_activity(db, user.id, user.username, "move", "lpn", lpn.id,
                 f"Moved LPN '{lpn.lpn_number}' to {target.path} ({reference})")
    db.commit()
    broadcast_change("lpn", "updated")
    broadcast_change("stock_movement", "created")
    return _serialize_lpn(db, lpn)


def _validate_load_product(db: Session, product_id: int):
    product = get_or_404(Product, product_id, db)
    if not product.is_active:
        raise HTTPException(status_code=400, detail=f"'{product.display_name}' is inactive")
    if not product.is_variant and db.query(Product).filter(Product.parent_id == product.id, Product.is_active == True).first():
        raise HTTPException(status_code=400, detail=f"'{product.display_name}' has variants - manage stock on a specific variant")
    return product


def _serialized_move_pair(
    db: Session,
    *,
    product: Product,
    user_id: int,
    serial: SerialNumber,
    from_location_id: int,
    to_location_id: int,
    inbound_lpn_id: int | None,
    reference_type: str,
    reference: str,
    notes: str,
) -> list[StockMovement]:
    out = inventory.post_journal_entry(
        db, product_id=product.id, user_id=user_id,
        quantity_change=-1, movement_type=inventory.TRANSFER_OUT,
        from_location_id=from_location_id, to_location_id=to_location_id,
        lot_id=serial.lot_id, serial_id=serial.id, lpn_id=serial.lpn_id,
        reference_type=reference_type, reference=reference, notes=notes,
    )
    inbound = inventory.post_journal_entry(
        db, product_id=product.id, user_id=user_id,
        quantity_change=1, movement_type=inventory.TRANSFER_IN,
        from_location_id=from_location_id, to_location_id=to_location_id,
        lot_id=serial.lot_id, serial_id=serial.id, lpn_id=inbound_lpn_id,
        reference_type=reference_type, reference=reference, notes=notes,
    )
    out.transfer_id = inbound.id
    inbound.transfer_id = out.id
    return [out, inbound]


@router.post("/{lpn_id}/items", response_model=LPNOut, status_code=201)
def load_lpn(lpn_id: int, data: LPNLoadIn, db: Session = Depends(get_db), user=Depends(require_permission("lpns.update"))):
    """Load stock into an LPN from the location it sits at.

    Non-serialized products take a `quantity` (optionally per lot); serialized
    products take `serial_ids`. Inbound legs carry the LPN so stock lines and
    serial numbers land on the LPN.
    """
    lpn = _load_lpn(db, lpn_id)
    if lpn.status != "active":
        raise HTTPException(status_code=400, detail=f"LPN '{lpn.lpn_number}' is {lpn.status}")
    product = _validate_load_product(db, data.product_id)
    if data.lot_id is not None:
        get_or_404(Lot, data.lot_id, db)
    if lpn.location_id is not None and lpn.location_id != data.from_location_id:
        raise HTTPException(status_code=400, detail=f"LPN '{lpn.lpn_number}' is at '{lpn.location_name}' - load stock from that location")
    src = get_or_404(Location, data.from_location_id, db)
    if not src.is_active:
        raise HTTPException(status_code=400, detail=f"Location '{src.path}' is inactive")
    allow_quarantined = src.location_type == "quarantine"

    reference = next_document_number(db, "lpn_load", "LOD-")
    movements: list[StockMovement] = []
    try:
        if product.is_serialized:
            if not data.serial_ids:
                raise HTTPException(status_code=400, detail=f"'{product.display_name}' is serialized - provide serial_ids")
            if data.quantity is not None:
                raise HTTPException(status_code=400, detail=f"'{product.display_name}' is serialized - load by serial number, not quantity")
            serials = db.query(SerialNumber).filter(SerialNumber.id.in_(data.serial_ids)).all()
            if len(serials) != len(data.serial_ids):
                raise HTTPException(status_code=400, detail="One or more serial numbers were not found")
            by_id = {s.id: s for s in serials}
            for serial_id in data.serial_ids:
                serial = by_id[serial_id]
                if serial.product_id != product.id:
                    raise HTTPException(status_code=400, detail=f"Serial '{serial.serial_number}' does not belong to '{product.display_name}'")
                if serial.status == inventory.SERIAL_STATUS_QUARANTINED and not allow_quarantined:
                    raise HTTPException(status_code=400, detail=f"Serial '{serial.serial_number}' is quarantined - it can only be loaded into an LPN in a quarantine area")
                if serial.status not in (inventory.SERIAL_STATUS_IN_STOCK, inventory.SERIAL_STATUS_QUARANTINED):
                    raise HTTPException(status_code=400, detail=f"Serial '{serial.serial_number}' is not in stock (status: {serial.status})")
                if serial.lot is not None and serial.lot.status not in ("in_stock", "quarantined"):
                    raise HTTPException(
                        status_code=400,
                        detail=f"Serial '{serial.serial_number}' belongs to lot '{serial.lot.lot_number}' which is {serial.lot.status} - it cannot be loaded into an LPN",
                    )
                if serial.location_id != src.id:
                    raise HTTPException(status_code=400, detail=f"Serial '{serial.serial_number}' is not at '{src.path}'")
                if serial.lpn_id is not None:
                    raise HTTPException(status_code=400, detail=f"Serial '{serial.serial_number}' is already assigned to an LPN")
            if lpn.location_id is None:
                lpn.location_id = src.id
                db.flush()
            for serial in serials:
                movements.extend(_serialized_move_pair(
                    db, product=product, user_id=user.id, serial=serial,
                    from_location_id=src.id, to_location_id=src.id,
                    inbound_lpn_id=lpn.id, reference_type="lpn_load", reference=reference,
                    notes=f"Loaded into LPN '{lpn.lpn_number}'",
                ))
        else:
            if data.serial_ids:
                raise HTTPException(status_code=400, detail=f"'{product.display_name}' is not serialized - use quantity")
            if not data.quantity or data.quantity <= 0:
                raise HTTPException(status_code=400, detail="quantity must be positive")
            if lpn.location_id is None:
                lpn.location_id = src.id
                db.flush()
            movements = inventory.load_into_lpn(
                db, product_id=product.id, user_id=user.id,
                quantity=data.quantity, location_id=src.id, lot_id=data.lot_id,
                lpn_id=lpn.id, reference=reference,
                include_quarantined=allow_quarantined,
                notes=f"Loaded into LPN '{lpn.lpn_number}'",
            )
    except inventory.InventoryError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    inventory.auto_quarantine(db, src, movements)
    db.commit()
    lpn = _load_lpn(db, lpn.id)
    log_activity(db, user.id, user.username, "load", "lpn", lpn.id,
                 f"Loaded {data.quantity or len(data.serial_ids or [])} x '{product.display_name}' into LPN '{lpn.lpn_number}' ({reference})")
    db.commit()
    broadcast_change("lpn", "updated")
    broadcast_change("stock_movement", "created")
    return _serialize_lpn(db, lpn)


@router.post("/{lpn_id}/unload", response_model=LPNOut, status_code=201)
def unload_lpn(lpn_id: int, data: LPNUnloadIn, db: Session = Depends(get_db), user=Depends(require_permission("lpns.update"))):
    """Remove stock from an LPN to loose stock at a destination location.

    Non-serialized products take a `quantity` (optionally per lot); serialized
    products take `serial_ids`. Outbound legs carry the LPN; inbound legs land
    without it so the stock leaves the LPN.
    """
    lpn = _load_lpn(db, lpn_id)
    if lpn.status != "active":
        raise HTTPException(status_code=400, detail=f"LPN '{lpn.lpn_number}' is {lpn.status}")
    product = _validate_load_product(db, data.product_id)
    if data.lot_id is not None:
        get_or_404(Lot, data.lot_id, db)
    if lpn.location_id is None:
        raise HTTPException(status_code=400, detail=f"LPN '{lpn.lpn_number}' has no location assigned")
    dest = get_or_404(Location, data.to_location_id, db)
    if not dest.is_active:
        raise HTTPException(status_code=400, detail=f"Location '{dest.path}' is inactive")
    allow_quarantined = dest.location_type == "quarantine"

    reference = next_document_number(db, "lpn_unload", "ULD-")
    movements: list[StockMovement] = []
    try:
        if product.is_serialized:
            if not data.serial_ids:
                raise HTTPException(status_code=400, detail=f"'{product.display_name}' is serialized - provide serial_ids")
            if data.quantity is not None:
                raise HTTPException(status_code=400, detail=f"'{product.display_name}' is serialized - unload by serial number, not quantity")
            serials = db.query(SerialNumber).filter(SerialNumber.id.in_(data.serial_ids)).all()
            if len(serials) != len(data.serial_ids):
                raise HTTPException(status_code=400, detail="One or more serial numbers were not found")
            by_id = {s.id: s for s in serials}
            for serial_id in data.serial_ids:
                serial = by_id[serial_id]
                if serial.product_id != product.id:
                    raise HTTPException(status_code=400, detail=f"Serial '{serial.serial_number}' does not belong to '{product.display_name}'")
                if serial.lpn_id != lpn.id:
                    raise HTTPException(status_code=400, detail=f"Serial '{serial.serial_number}' is not in LPN '{lpn.lpn_number}'")
                if serial.status == inventory.SERIAL_STATUS_QUARANTINED and not allow_quarantined:
                    raise HTTPException(status_code=400, detail=f"Serial '{serial.serial_number}' is quarantined - it can only be unloaded to a quarantine area")
                if serial.status not in (inventory.SERIAL_STATUS_IN_STOCK, inventory.SERIAL_STATUS_QUARANTINED):
                    raise HTTPException(status_code=400, detail=f"Serial '{serial.serial_number}' is not in stock (status: {serial.status})")
            for serial in serials:
                movements.extend(_serialized_move_pair(
                    db, product=product, user_id=user.id, serial=serial,
                    from_location_id=lpn.location_id, to_location_id=dest.id,
                    inbound_lpn_id=None, reference_type="lpn_unload", reference=reference,
                    notes=f"Unloaded from LPN '{lpn.lpn_number}'",
                ))
        else:
            if data.serial_ids:
                raise HTTPException(status_code=400, detail=f"'{product.display_name}' is not serialized - use quantity")
            if not data.quantity or data.quantity <= 0:
                raise HTTPException(status_code=400, detail="quantity must be positive")
            movements = inventory.unload_from_lpn(
                db, product_id=product.id, user_id=user.id,
                quantity=data.quantity, location_id=lpn.location_id, lot_id=data.lot_id,
                lpn_id=lpn.id, to_location_id=dest.id, reference=reference,
                include_quarantined=allow_quarantined,
                notes=f"Unloaded from LPN '{lpn.lpn_number}'",
            )
    except inventory.InventoryError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    inventory.auto_quarantine(db, dest, movements)
    db.commit()
    lpn = _load_lpn(db, lpn.id)
    log_activity(db, user.id, user.username, "unload", "lpn", lpn.id,
                 f"Unloaded {data.quantity or len(data.serial_ids or [])} x '{product.display_name}' from LPN '{lpn.lpn_number}' ({reference})")
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
