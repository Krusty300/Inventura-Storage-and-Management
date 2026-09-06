from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from app.constants import MAX_PAGE_SIZE
from app.database import get_db
from app.models import Location, Product, Kit, KitItem
from app.schemas.kit import KitAssemble, KitCreate, KitDisassemble, KitOut, KitUpdate
from app.services import inventory
from app.services.auth import require_permission
from app.utils import get_or_404, log_activity, broadcast_change

router = APIRouter(prefix="/api/kits", tags=["kits"], dependencies=[Depends(require_permission("kit.view"))])


def _load_kit(db: Session, kit_id: int) -> Kit:
    return get_or_404(Kit, kit_id, db, options=[
        joinedload(Kit.product), joinedload(Kit.items).joinedload(KitItem.product),
    ])


def _validate_product(db: Session, product_id: int) -> Product:
    product = get_or_404(Product, product_id, db)
    if not product.is_active:
        raise HTTPException(status_code=400, detail=f"'{product.display_name}' is inactive")
    if product.is_variant or product.parent_id is not None:
        raise HTTPException(status_code=400, detail=f"'{product.display_name}' is a variant - use the parent product")
    if product.variants:
        raise HTTPException(status_code=400, detail=f"'{product.display_name}' has variants - assemble a specific variant")
    return product


def _has_cycle(db: Session, output_id: int, component_ids: list[int], exclude_kit_id: int | None = None) -> str | None:
    """Return the first product involved in a kit cycle, or None.

    A cycle exists if `output_id` is required (directly or transitively) to
    make any of `component_ids`. Walks the existing kit graph upward from each
    component, ignoring items belonging to `exclude_kit_id` (about to be replaced).
    """
    item_rows = (
        db.query(KitItem.product_id, Kit.product_id)
        .join(Kit, KitItem.kit_id == Kit.id)
        .filter(Kit.is_active == True)
    )
    if exclude_kit_id is not None:
        item_rows = item_rows.filter(Kit.id != exclude_kit_id)
    edges: dict[int, set[int]] = {}
    for component_id, kit_product_id in item_rows.all():
        edges.setdefault(kit_product_id, set()).add(component_id)

    for cid in component_ids:
        if cid == output_id:
            return output_id
        stack = [cid]
        visited: set[int] = set()
        while stack:
            cur = stack.pop()
            if cur == output_id:
                return cid
            if cur in visited:
                continue
            visited.add(cur)
            for nxt in edges.get(cur, ()):
                stack.append(nxt)
    return None


def _validate_items(db: Session, output_id: int, items, exclude_kit_id: int | None = None) -> None:
    if not items:
        raise HTTPException(status_code=400, detail="A kit requires at least one component")
    component_ids: list[int] = []
    seen: set[int] = set()
    for item in items:
        if item.product_id in seen:
            raise HTTPException(status_code=400, detail="Each component may only appear once in a kit")
        seen.add(item.product_id)
        component_ids.append(item.product_id)
        _validate_product(db, item.product_id)
    cycle = _has_cycle(db, output_id, component_ids, exclude_kit_id=exclude_kit_id)
    if cycle is not None:
        raise HTTPException(status_code=400, detail="Kit cycle detected - this component chain is circular")


def _validate_discount_type(discount_type: str, discount_value: float) -> None:
    if discount_type not in ("fixed", "percentage"):
        raise HTTPException(status_code=400, detail="discount_type must be 'fixed' or 'percentage'")
    if discount_type == "percentage" and not (0 <= discount_value <= 100):
        raise HTTPException(status_code=400, detail="Percentage discount must be between 0 and 100")


def _save_items(db: Session, kit: Kit, items) -> None:
    kit.items.clear()
    db.flush()
    for idx, item in enumerate(items):
        db.add(KitItem(
            kit_id=kit.id,
            product_id=item.product_id,
            quantity=item.quantity,
            position=item.position or idx,
        ))


@router.get("")
def list_kits(
    product_id: int | None = None,
    is_active: bool | None = None,
    search: str = Query(""),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=MAX_PAGE_SIZE),
    db: Session = Depends(get_db),
):
    q = db.query(Kit).options(joinedload(Kit.product), joinedload(Kit.items).joinedload(KitItem.product))
    if product_id:
        q = q.filter(Kit.product_id == product_id)
    if is_active is not None:
        q = q.filter(Kit.is_active == is_active)
    if search:
        like = f"%{search}%"
        q = q.join(Kit.product, isouter=True).filter(
            Product.name.ilike(like) | Product.sku.ilike(like) | Kit.name.ilike(like)
        )
    total = q.count()
    items = q.order_by(Kit.updated_at.desc()).offset(skip).limit(limit).all()
    return {"items": [KitOut.model_validate(k) for k in items], "total": total,
            "page": (skip // limit) + 1, "pages": max(ceil(total / limit), 1)}


@router.get("/{kit_id}", response_model=KitOut)
def get_kit(kit_id: int, db: Session = Depends(get_db)):
    return _load_kit(db, kit_id)


@router.post("", response_model=KitOut, status_code=201)
def create_kit(data: KitCreate, db: Session = Depends(get_db), user=Depends(require_permission("kit.create"))):
    output = _validate_product(db, data.product_id)
    _validate_items(db, data.product_id, data.items)
    _validate_discount_type(data.discount_type, data.discount_value)
    kit = Kit(
        product_id=data.product_id,
        name=data.name or f"{output.display_name} Kit",
        description=data.description or "",
        version=data.version or "",
        discount_type=data.discount_type,
        discount_value=data.discount_value,
    )
    db.add(kit)
    db.flush()
    _save_items(db, kit, data.items)
    db.commit()
    kit = _load_kit(db, kit.id)
    log_activity(db, user.id, user.username, "create", "kit", kit.id, f"Created kit '{kit.name}' for '{kit.product_name}'")
    db.commit()
    broadcast_change("kit", "created")
    return kit


@router.put("/{kit_id}", response_model=KitOut)
def update_kit(kit_id: int, data: KitUpdate, db: Session = Depends(get_db), user=Depends(require_permission("kit.update"))):
    kit = _load_kit(db, kit_id)
    updates = data.model_dump(exclude_unset=True)
    if "items" in updates:
        _validate_items(db, kit.product_id, data.items, exclude_kit_id=kit.id)
    if "discount_type" in updates or "discount_value" in updates:
        dtype = updates.get("discount_type", kit.discount_type)
        dval = updates.get("discount_value", kit.discount_value)
        _validate_discount_type(dtype, dval)
    for k, v in updates.items():
        if k == "items":
            continue
        setattr(kit, k, v)
    if "items" in updates:
        db.flush()
        _save_items(db, kit, data.items)
    db.commit()
    kit = _load_kit(db, kit.id)
    log_activity(db, user.id, user.username, "update", "kit", kit.id, f"Updated kit '{kit.name}'")
    db.commit()
    broadcast_change("kit", "updated")
    return kit


@router.delete("/{kit_id}", status_code=204)
def delete_kit(kit_id: int, db: Session = Depends(get_db), user=Depends(require_permission("kit.delete"))):
    kit = _load_kit(db, kit_id)
    db.delete(kit)
    db.commit()
    log_activity(db, user.id, user.username, "delete", "kit", kit.id, f"Deleted kit '{kit.name}'")
    db.commit()
    broadcast_change("kit", "deleted")


def _assemble_components(db: Session, kit: Kit, quantity: int, location_id: int | None, user_id: int, reference: str) -> None:
    """Consume `quantity` sets of component stock into the kit's output product."""
    for item in kit.items:
        product = db.get(Product, item.product_id)
        needed = item.quantity * quantity
        if product and product.is_serialized:
            serials = inventory.allocate_serials(db, product_id=item.product_id, quantity=needed)
            for serial in serials:
                inventory.post_journal_entry(
                    db,
                    product_id=item.product_id,
                    user_id=user_id,
                    quantity_change=-1,
                    movement_type=inventory.BACKFLUSH,
                    from_location_id=serial.location_id,
                    to_location_id=location_id,
                    lot_id=serial.lot_id,
                    serial_id=serial.id,
                    reference_type="kit",
                    reference=reference,
                    notes=f"Consumed into {reference}",
                )
        else:
            allocation = inventory.allocate_lots(db, product_id=item.product_id, quantity=needed)
            for lot_id, take, source_location, lpn_id in allocation:
                inventory.post_journal_entry(
                    db,
                    product_id=item.product_id,
                    user_id=user_id,
                    quantity_change=-take,
                    movement_type=inventory.BACKFLUSH,
                    from_location_id=source_location,
                    to_location_id=location_id,
                    lot_id=lot_id,
                    lpn_id=lpn_id,
                    reference_type="kit",
                    reference=reference,
                    notes=f"Consumed into {reference}",
                )


@router.post("/{kit_id}/assemble", response_model=KitOut)
def assemble_kit(kit_id: int, data: KitAssemble, db: Session = Depends(get_db), user=Depends(require_permission("kit.update"))):
    kit = _load_kit(db, kit_id)
    if not kit.is_active:
        raise HTTPException(status_code=400, detail="Kit is inactive")
    if data.location_id is not None:
        get_or_404(Location, data.location_id, db)
    if kit.product.is_serialized:
        raise HTTPException(status_code=400, detail="Serialized output products cannot be assembled in bulk - use a work order")
    try:
        _assemble_components(db, kit, data.quantity, data.location_id, user.id, kit.name or kit.product_name)
        # Add the assembled kit output quantity to inventory.
        inventory.post_journal_entry(
            db,
            product_id=kit.product_id,
            user_id=user.id,
            quantity_change=data.quantity,
            movement_type=inventory.RECEIVE,
            to_location_id=data.location_id,
            reference_type="kit",
            reference=kit.name or kit.product_name,
            notes=f"Assembled {data.quantity} x '{kit.product_name}'",
        )
    except inventory.InventoryError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    kit = _load_kit(db, kit.id)
    log_activity(db, user.id, user.username, "assemble", "kit", kit.id,
                 f"Assembled {data.quantity} x '{kit.product_name}'")
    db.commit()
    broadcast_change("kit", "updated")
    broadcast_change("stock_movement", "created")
    broadcast_change("product", "updated")
    return kit


def _disassemble_kit(db: Session, kit: Kit, quantity: int, location_id: int | None, user_id: int, reference: str) -> None:
    """Consume `quantity` of the kit's output product and restore component stock."""
    if kit.product.is_serialized:
        raise inventory.InventoryError("Serialized kit outputs cannot be disassembled in bulk")
    # Consume the output product bulk stock.
    allocation = inventory.allocate_lots(db, product_id=kit.product_id, quantity=quantity, location_id=location_id)
    for lot_id, take, source_location, lpn_id in allocation:
        inventory.post_journal_entry(
            db,
            product_id=kit.product_id,
            user_id=user_id,
            quantity_change=-take,
            movement_type=inventory.SCRAP,
            from_location_id=source_location,
            to_location_id=location_id,
            lot_id=lot_id,
            lpn_id=lpn_id,
            reference_type="kit",
            reference=reference,
            notes=f"Disassembled from {reference}",
        )
    # Restore component stock.
    for item in kit.items:
        if item.product.is_serialized:
            raise inventory.InventoryError(f"Serialized component '{item.product_name}' cannot be restored automatically")
        needed = item.quantity * quantity
        inventory.post_journal_entry(
            db,
            product_id=item.product_id,
            user_id=user_id,
            quantity_change=needed,
            movement_type=inventory.RELEASE,
            to_location_id=location_id,
            reference_type="kit",
            reference=reference,
            notes=f"Restored from {reference} disassembly",
        )


@router.post("/{kit_id}/disassemble", response_model=KitOut)
def disassemble_kit(kit_id: int, data: KitDisassemble, db: Session = Depends(get_db), user=Depends(require_permission("kit.update"))):
    kit = _load_kit(db, kit_id)
    if not kit.is_active:
        raise HTTPException(status_code=400, detail="Kit is inactive")
    if data.location_id is not None:
        get_or_404(Location, data.location_id, db)
    try:
        _disassemble_kit(db, kit, data.quantity, data.location_id, user.id, kit.name or kit.product_name)
    except inventory.InventoryError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    kit = _load_kit(db, kit.id)
    log_activity(db, user.id, user.username, "disassemble", "kit", kit.id,
                 f"Disassembled {data.quantity} x '{kit.product_name}'")
    db.commit()
    broadcast_change("kit", "updated")
    broadcast_change("stock_movement", "created")
    broadcast_change("product", "updated")
    return kit