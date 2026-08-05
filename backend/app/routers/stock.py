from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload
from app.database import get_db
from app.models.product import Product
from app.models.location import Location
from app.models.lot import Lot
from app.models.stock_line import StockLine
from app.models.stock_movement import StockMovement
from app.schemas.stock_movement import StockMovementAdjust, StockMovementCreate, StockMovementOut, StockMovementTransfer, StockMovementUpdate
from app.services import inventory
from app.services.auth import get_current_user, require_permission
from app.services.notify import notify_expiring, notify_low_stock
from app.services.sequences import next_document_number
from app.utils import get_or_404, log_activity, broadcast_change

router = APIRouter(prefix="/api/stock-movements", tags=["stock-movements"], dependencies=[Depends(get_current_user)])


@router.get("")
def list_movements(search: str = Query(""), skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    q = db.query(StockMovement).options(
        joinedload(StockMovement.product), joinedload(StockMovement.user)
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
def product_stock_locations(product_id: int = Query(...), db: Session = Depends(get_db)):
    """Locations that currently hold stock of a product, for the transfer modal.

    Returns each location with its on-hand quantity and a per-lot breakdown so
    the UI can pre-fill the source location dropdown from the selected product.
    """
    get_or_404(Product, product_id, db)
    stock = (
        db.query(
            StockLine.location_id,
            StockLine.lot_id,
            func.coalesce(func.sum(StockLine.quantity), 0).label("quantity"),
        )
        .filter(StockLine.product_id == product_id, StockLine.quantity > 0)
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
    for row in stock:
        if row.location_id is None:
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
    return result


@router.post("", response_model=StockMovementOut, status_code=201)
def record_movement(data: StockMovementCreate, db: Session = Depends(get_db), user=Depends(require_permission("stock.record"))):
    product = get_or_404(Product, data.product_id, db)
    if not product.is_variant and db.query(Product).filter(Product.parent_id == product.id, Product.is_active == True).first():
        raise HTTPException(status_code=400, detail=f"'{product.display_name}' has variants - record movements on a specific variant")
    if product.is_serialized:
        raise HTTPException(status_code=400, detail="Serialized products must be managed through receipts")
    try:
        sm = inventory.post_journal_entry(
            db, product_id=product.id, user_id=user.id,
            quantity_change=data.quantity_change, movement_type=data.movement_type,
            reference=data.reference, notes=data.notes,
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
    get_or_404(Location, data.from_location_id, db)
    get_or_404(Location, data.to_location_id, db)
    if data.from_location_id == data.to_location_id:
        raise HTTPException(status_code=400, detail="Source and destination locations must differ")
    reference = next_document_number(db, "transfer", "TRF-")
    try:
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
        inbound.transfer_id = out.id
    except inventory.InventoryError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
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
        "movements": [StockMovementOut.model_validate(out), StockMovementOut.model_validate(inbound)],
    }


@router.post("/adjust", status_code=201)
def adjust_stock(data: StockMovementAdjust, db: Session = Depends(get_db), user=Depends(require_permission("stock.adjust"))):
    product = get_or_404(Product, data.product_id, db)
    if not product.is_variant and db.query(Product).filter(Product.parent_id == product.id, Product.is_active == True).first():
        raise HTTPException(status_code=400, detail=f"'{product.display_name}' has variants - adjust stock on a specific variant")
    old_qty = product.quantity
    qty_change = data.new_quantity - old_qty
    if qty_change == 0:
        raise HTTPException(status_code=400, detail="New quantity is the same as current quantity")
    try:
        sm = inventory.post_journal_entry(
            db, product_id=product.id, user_id=user.id,
            quantity_change=qty_change, movement_type="adjustment",
            reference=f"Adjustment ({data.reason_code})",
            notes=data.notes,
        )
    except inventory.InventoryError as e:
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    db.refresh(sm)
    log_activity(db, user.id, user.username, "create", "stock_movement", sm.id,
                 f"Adjusted '{product.display_name}' from {old_qty} to {data.new_quantity} ({data.reason_code})")
    notify_low_stock(db, product)
    db.commit()
    broadcast_change("stock_movement", "created")
    broadcast_change("product", "updated")
    return {"id": sm.id, "product_id": product.id, "product_name": product.display_name, "quantity_change": qty_change,
            "new_quantity": data.new_quantity, "reason_code": data.reason_code}


@router.put("/{movement_id}", response_model=StockMovementOut)
def update_movement(movement_id: int, data: StockMovementUpdate, db: Session = Depends(get_db), user=Depends(require_permission("stock.update"))):
    sm = get_or_404(StockMovement, movement_id, db)
    updates = data.model_dump(exclude_unset=True)
    old_qty_change = sm.quantity_change
    old_product_id = sm.product_id
    new_qty_change = updates.get("quantity_change", old_qty_change)
    new_product_id = updates.get("product_id", old_product_id)
    if new_product_id != old_product_id or new_qty_change != old_qty_change:
        get_or_404(Product, old_product_id, db)
        get_or_404(Product, new_product_id, db)
        try:
            inventory.post_journal_entry(
                db, product_id=old_product_id, user_id=user.id,
                quantity_change=-old_qty_change, movement_type="adjustment",
                reference=f"Reversed {sm.id}", notes="Reversal of edited stock movement",
            )
            inventory.post_journal_entry(
                db, product_id=new_product_id, user_id=user.id,
                quantity_change=new_qty_change, movement_type="adjustment",
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
    try:
        inventory.post_journal_entry(
            db, product_id=sm.product_id, user_id=user.id,
            quantity_change=-sm.quantity_change, movement_type="adjustment",
            reference=f"Reversed {sm.id}", notes="Deleted stock movement reversal",
        )
    except inventory.InventoryError as e:
        raise HTTPException(status_code=400, detail=str(e))
    db.delete(sm)
    db.commit()
    log_activity(db, user.id, user.username, "delete", "stock_movement", movement_id, f"Deleted stock movement #{movement_id}")
    db.commit()
    broadcast_change("stock_movement", "deleted")
    broadcast_change("product", "updated")
