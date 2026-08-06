from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Location, Lot, Product, SerialNumber, StockLine, StockMovement


class InventoryError(Exception):
    """Raised for invalid or impossible inventory operations."""


# Movement type constants
RECEIVE = "receive"
TRANSFER_OUT = "transfer_out"
TRANSFER_IN = "transfer_in"
SALE = "sale"
SALE_RETURN = "sale_return"
ISSUE = "issue"
BACKFLUSH = "backflush"
ADJUSTMENT = "adjustment"
COUNT = "count"
SHIP = "ship"
SCRAP = "scrap"
DEACTIVATE = "deactivate"
ACTIVATE = "activate"

VALID_MOVEMENT_TYPES = {
    RECEIVE,
    TRANSFER_OUT,
    TRANSFER_IN,
    SALE,
    SALE_RETURN,
    ISSUE,
    BACKFLUSH,
    ADJUSTMENT,
    COUNT,
    SHIP,
    SCRAP,
    DEACTIVATE,
    ACTIVATE,
    # Legacy types used by the existing API contract
    "in",
    "out",
    "return",
}

SERIAL_STATUS_IN_STOCK = "in_stock"
SERIAL_STATUS_RESERVED = "reserved"
SERIAL_STATUS_SOLD = "sold"
SERIAL_STATUS_QUARANTINED = "quarantined"
SERIAL_STATUS_SCRAPPED = "scrapped"
SERIAL_STATUS_INACTIVE = "inactive"


def _location_is_valid(db: Session, location_id: int | None) -> bool:
    if location_id is None:
        return True
    return db.get(Location, location_id) is not None


def get_or_create_stock_line(
    db: Session,
    *,
    product_id: int,
    location_id: int | None = None,
    lot_id: int | None = None,
    lpn_id: int | None = None,
) -> StockLine:
    """Return the stock line matching exactly the given (product, location, lot, LPN)
    identity, creating it with quantity 0 if absent."""
    stmt = select(StockLine).where(StockLine.product_id == product_id)
    if location_id is None:
        stmt = stmt.where(StockLine.location_id.is_(None))
    else:
        stmt = stmt.where(StockLine.location_id == location_id)
    if lot_id is None:
        stmt = stmt.where(StockLine.lot_id.is_(None))
    else:
        stmt = stmt.where(StockLine.lot_id == lot_id)
    if lpn_id is None:
        stmt = stmt.where(StockLine.lpn_id.is_(None))
    else:
        stmt = stmt.where(StockLine.lpn_id == lpn_id)
    line = db.execute(stmt).scalars().first()
    if line is None:
        line = StockLine(
            product_id=product_id,
            location_id=location_id,
            lot_id=lot_id,
            lpn_id=lpn_id,
            quantity=0,
        )
        db.add(line)
        db.flush()
    return line


def on_hand(
    db: Session,
    *,
    product_id: int,
    location_id: int | None = None,
    lot_id: int | None = None,
    sellable_only: bool = False,
) -> int:
    """Current quantity for a product, optionally filtered by location/lot.

    With ``sellable_only=True``, stock held in non-``in_stock`` lots (quarantined
    or expired) is excluded, matching what allocations can actually consume.
    """
    product = db.get(Product, product_id)
    if product is None:
        raise InventoryError("Product not found")
    if product.is_serialized:
        stmt = (
            select(func.count(SerialNumber.id))
            .where(SerialNumber.product_id == product_id, SerialNumber.status == SERIAL_STATUS_IN_STOCK)
        )
        if sellable_only:
            stmt = stmt.outerjoin(Lot, SerialNumber.lot_id == Lot.id).where(
                (SerialNumber.lot_id.is_(None)) | (Lot.status == "in_stock")
            )
        if location_id is not None:
            stmt = stmt.where(SerialNumber.location_id == location_id)
        if lot_id is not None:
            stmt = stmt.where(SerialNumber.lot_id == lot_id)
        return int(db.execute(stmt).scalar() or 0)
    stmt = select(func.coalesce(func.sum(StockLine.quantity), 0)).where(StockLine.product_id == product_id)
    if sellable_only:
        stmt = stmt.outerjoin(Lot, StockLine.lot_id == Lot.id).where(
            (StockLine.lot_id.is_(None)) | (Lot.status == "in_stock")
        )
    if location_id is not None:
        stmt = stmt.where(StockLine.location_id == location_id)
    if lot_id is not None:
        stmt = stmt.where(StockLine.lot_id == lot_id)
    return int(db.execute(stmt).scalar() or 0)


def quarantined_qty_subquery():
    """Scalar subquery: stock quantity held in quarantined lots for the correlated
    Product row. Quarantined stock is on-hand but not sellable."""
    return (
        select(func.coalesce(func.sum(StockLine.quantity), 0))
        .join(Lot, StockLine.lot_id == Lot.id)
        .where(StockLine.product_id == Product.id, Lot.status == "quarantined")
        .scalar_subquery()
    )


def quarantined_qty_by_product(db: Session) -> dict[int, int]:
    """Map of product_id -> quantity held in quarantined lots."""
    rows = (
        db.execute(
            select(StockLine.product_id, func.sum(StockLine.quantity))
            .join(Lot, StockLine.lot_id == Lot.id)
            .where(Lot.status == "quarantined")
            .group_by(StockLine.product_id)
        ).all()
    )
    return {int(r[0]): int(r[1] or 0) for r in rows}


def allocate_lots(
    db: Session,
    *,
    product_id: int,
    quantity: int,
    location_id: int | None = None,
) -> list[tuple[int | None, int, int | None, int | None]]:
    """Allocate `quantity` from stock lines. When enforce_fefo is enabled (default),
    ordered by soonest expiry (FEFO). Otherwise FIFO by stock line id.
    Returns a list of (lot_id | None, qty, location_id | None, lpn_id | None)
    tuples describing the exact stock lines to decrement. Raises InventoryError
    if insufficient stock is available."""
    if quantity < 0:
        raise InventoryError("Allocation quantity must be non-negative")
    if quantity == 0:
        return []
    from app.models.settings import Settings
    s = db.query(Settings).first()
    use_fefo = s.enforce_fefo if s else True
    order = [Lot.expiry_date.asc().nulls_last(), StockLine.id.asc()] if use_fefo else [StockLine.id.asc()]
    stmt = (
        select(StockLine)
        .where(
            StockLine.product_id == product_id,
            StockLine.quantity > 0,
            (StockLine.lot_id.is_(None)) | (Lot.status == "in_stock"),
            (StockLine.location_id.is_(None))
            | (Location.location_type.is_(None))
            | (Location.location_type != "wip"),
        )
        .outerjoin(Lot, StockLine.lot_id == Lot.id)
        .outerjoin(Location, StockLine.location_id == Location.id)
        .order_by(*order)
    )
    if location_id is not None:
        stmt = stmt.where(StockLine.location_id == location_id)
    lines = db.execute(stmt).scalars().all()

    allocation: list[tuple[int | None, int, int | None, int | None]] = []
    needed = quantity
    for line in lines:
        if needed == 0:
            break
        take = min(line.quantity, needed)
        allocation.append((line.lot_id, take, line.location_id, line.lpn_id))
        needed -= take
    if needed > 0:
        raise InventoryError(
            f"Insufficient stock: need {quantity}, on hand {quantity - needed}"
        )
    return allocation


def allocate_serials(
    db: Session,
    *,
    product_id: int,
    quantity: int,
    location_id: int | None = None,
) -> list[SerialNumber]:
    """Allocate `quantity` in-stock serial numbers for a serialized product,
    ordered by soonest lot expiry (FEFO) then registration order when enforce_fefo
    is enabled, otherwise FIFO by id. Raises InventoryError if insufficient serials
    are available."""
    if quantity < 0:
        raise InventoryError("Allocation quantity must be non-negative")
    if quantity == 0:
        return []
    from app.models.settings import Settings
    s = db.query(Settings).first()
    use_fefo = s.enforce_fefo if s else True
    order = [Lot.expiry_date.asc().nulls_last(), SerialNumber.id.asc()] if use_fefo else [SerialNumber.id.asc()]
    stmt = (
        select(SerialNumber)
        .where(
            SerialNumber.product_id == product_id,
            SerialNumber.status == SERIAL_STATUS_IN_STOCK,
            (SerialNumber.lot_id.is_(None)) | (Lot.status == "in_stock"),
        )
        .outerjoin(Lot, SerialNumber.lot_id == Lot.id)
        .order_by(*order)
    )
    if location_id is not None:
        stmt = stmt.where(SerialNumber.location_id == location_id)
    serials = db.execute(stmt).scalars().all()
    if len(serials) < quantity:
        raise InventoryError(
            f"Insufficient stock: need {quantity}, on hand {len(serials)}"
        )
    return list(serials[:quantity])


def _apply_to_line(db: Session, line: StockLine, delta: int) -> None:
    new_qty = line.quantity + delta
    if new_qty < 0:
        raise InventoryError(f"Insufficient stock on hand: {line.quantity}")
    if new_qty == 0:
        db.delete(line)
    else:
        line.quantity = new_qty


def post_journal_entry(
    db: Session,
    *,
    product_id: int,
    user_id: int,
    quantity_change: int,
    movement_type: str,
    from_location_id: int | None = None,
    to_location_id: int | None = None,
    lot_id: int | None = None,
    serial_id: int | None = None,
    lpn_id: int | None = None,
    transfer_id: int | None = None,
    reference_type: str = "",
    reference: str = "",
    notes: str = "",
) -> StockMovement:
    """The single writer for the inventory ledger.

    Every stock change must flow through here so the stock_lines balances and
    serial_number statuses stay consistent. Caller is responsible for committing.
    """
    if movement_type not in VALID_MOVEMENT_TYPES:
        raise InventoryError(f"Unknown movement type: {movement_type}")
    if quantity_change == 0:
        raise InventoryError("Quantity change must be non-zero")
    if not _location_is_valid(db, from_location_id):
        raise InventoryError("From location does not exist")
    if not _location_is_valid(db, to_location_id):
        raise InventoryError("To location does not exist")
    if lot_id is not None and db.get(Lot, lot_id) is None:
        raise InventoryError("Lot does not exist")

    product = db.get(Product, product_id)
    if product is None:
        raise InventoryError("Product not found")

    if product.is_serialized:
        if abs(quantity_change) != 1:
            raise InventoryError("Serialized items move one unit at a time")
        if serial_id is None:
            raise InventoryError("serial_id is required for serialized items")
        serial = db.get(SerialNumber, serial_id)
        if serial is None or serial.product_id != product_id:
            raise InventoryError("Serial number does not match product")
        if quantity_change > 0:
            serial.status = SERIAL_STATUS_IN_STOCK
            serial.sold_at = None
            if to_location_id is not None:
                serial.location_id = to_location_id
        else:
            if movement_type == SALE or movement_type == SHIP:
                serial.status = SERIAL_STATUS_SOLD
                serial.sold_at = datetime.now(timezone.utc)
            elif movement_type == TRANSFER_OUT or movement_type == TRANSFER_IN:
                serial.status = SERIAL_STATUS_IN_STOCK
                if to_location_id is not None and movement_type == TRANSFER_IN:
                    serial.location_id = to_location_id
            elif movement_type == ISSUE:
                serial.status = SERIAL_STATUS_RESERVED
            elif movement_type == SCRAP:
                serial.status = SERIAL_STATUS_SCRAPPED
            elif movement_type == DEACTIVATE:
                serial.status = SERIAL_STATUS_INACTIVE
            else:
                serial.status = SERIAL_STATUS_QUARANTINED
    else:
        if quantity_change > 0:
            if movement_type == TRANSFER_IN:
                dest_location = to_location_id
            else:
                dest_location = to_location_id if to_location_id is not None else from_location_id
            line = get_or_create_stock_line(
                db, product_id=product_id, location_id=dest_location, lot_id=lot_id, lpn_id=lpn_id
            )
            line.quantity += quantity_change
        else:
            if movement_type == TRANSFER_OUT:
                source_location = from_location_id
            else:
                source_location = from_location_id if from_location_id is not None else to_location_id
            line = get_or_create_stock_line(
                db, product_id=product_id, location_id=source_location, lot_id=lot_id, lpn_id=lpn_id
            )
            _apply_to_line(db, line, quantity_change)

    movement = StockMovement(
        product_id=product_id,
        user_id=user_id,
        quantity_change=quantity_change,
        movement_type=movement_type,
        from_location_id=from_location_id,
        to_location_id=to_location_id,
        lot_id=lot_id,
        serial_id=serial_id,
        lpn_id=lpn_id,
        reference_type=reference_type,
        reference=reference,
        notes=notes,
    )
    db.add(movement)
    # Keep product.quantity as a parity cache of the ledger balance. The
    # stock line / serial status changes above are still pending, so flush
    # first or on_hand() would read stale data (autoflush is disabled).
    db.flush()
    product.quantity = on_hand(db, product_id=product_id)
    return movement


def deactivate_serials(
    db: Session,
    *,
    product_id: int,
    user_id: int,
    reference: str = "",
    notes: str = "",
) -> int:
    """Flag every on-hand (in_stock) serial of a product as ``inactive``.

    Used when a serialized product is deactivated. Returns the number of
    serials flagged. Caller is responsible for committing.
    """
    serials = db.query(SerialNumber).filter(
        SerialNumber.product_id == product_id,
        SerialNumber.status == SERIAL_STATUS_IN_STOCK,
    ).all()
    count = 0
    for serial in serials:
        post_journal_entry(
            db, product_id=product_id, user_id=user_id, quantity_change=-1,
            movement_type=DEACTIVATE, from_location_id=serial.location_id,
            lot_id=serial.lot_id, serial_id=serial.id,
            reference_type="product", reference=reference,
            notes=notes or "Product deactivated - unit flagged inactive",
        )
        count += 1
    return count


def reactivate_serials(
    db: Session,
    *,
    product_id: int,
    user_id: int,
    reference: str = "",
    notes: str = "",
) -> int:
    """Restore every ``inactive`` serial of a product back to ``in_stock``.

    Used when a serialized product is reactivated. Returns the number of
    serials restored. Caller is responsible for committing.
    """
    serials = db.query(SerialNumber).filter(
        SerialNumber.product_id == product_id,
        SerialNumber.status == SERIAL_STATUS_INACTIVE,
    ).all()
    count = 0
    for serial in serials:
        post_journal_entry(
            db, product_id=product_id, user_id=user_id, quantity_change=+1,
            movement_type=ACTIVATE, to_location_id=serial.location_id,
            lot_id=serial.lot_id, serial_id=serial.id,
            reference_type="product", reference=reference,
            notes=notes or "Product activated - unit restored to in stock",
        )
        count += 1
    return count


def count_adjustment(
    db: Session,
    *,
    product_id: int,
    user_id: int,
    variance: int,
    location_id: int,
    reference: str = "",
    notes: str = "",
) -> list[StockMovement]:
    """Post a cycle-count variance at a specific location.

    Positive variance (more found than expected) is added to the first existing
    stock line at the location so LPN/lot identity is preserved; if none exists a
    new line is created. Negative variance (short) is reduced across the location's
    stock lines so stock held inside an LPN or across multiple lots is handled.
    """
    lines = (
        db.query(StockLine)
        .filter(StockLine.product_id == product_id, StockLine.location_id == location_id)
        .order_by(StockLine.id)
        .all()
    )
    movements: list[StockMovement] = []
    if variance > 0:
        line = lines[0] if lines else None
        movements.append(post_journal_entry(
            db, product_id=product_id, user_id=user_id, quantity_change=variance,
            movement_type=COUNT, to_location_id=location_id,
            lot_id=line.lot_id if line else None,
            lpn_id=line.lpn_id if line else None,
            reference_type="cycle_count", reference=reference, notes=notes,
        ))
    else:
        remaining = -variance
        total = sum(l.quantity for l in lines)
        if remaining > total:
            raise InventoryError(f"Insufficient stock on hand: {total}")
        for line in lines:
            if remaining <= 0:
                break
            take = min(line.quantity, remaining)
            if take <= 0:
                continue
            movements.append(post_journal_entry(
                db, product_id=product_id, user_id=user_id, quantity_change=-take,
                movement_type=COUNT, from_location_id=location_id,
                lot_id=line.lot_id, lpn_id=line.lpn_id,
                reference_type="cycle_count", reference=reference, notes=notes,
            ))
            remaining -= take
        if remaining > 0:
            raise InventoryError(f"Insufficient stock on hand: {total}")
    return movements


def scrap_serials(
    db: Session,
    *,
    product_id: int,
    user_id: int,
    location_id: int,
    quantity: int,
    reference: str = "",
    notes: str = "",
) -> list[StockMovement]:
    """Scrap `quantity` in-stock serial numbers for a serialized product at a
    location (e.g. missing items found during a cycle count). Serials are chosen
    by soonest lot expiry (FEFO) then registration order, matching allocation.
    Raises InventoryError if fewer serials are in stock than requested."""
    if quantity < 0:
        raise InventoryError("Scrap quantity must be non-negative")
    if quantity == 0:
        return []
    from app.models.settings import Settings
    s = db.query(Settings).first()
    use_fefo = s.enforce_fefo if s else True
    order = [Lot.expiry_date.asc().nulls_last(), SerialNumber.id.asc()] if use_fefo else [SerialNumber.id.asc()]
    stmt = (
        select(SerialNumber)
        .where(
            SerialNumber.product_id == product_id,
            SerialNumber.status == SERIAL_STATUS_IN_STOCK,
            SerialNumber.location_id == location_id,
        )
        .outerjoin(Lot, SerialNumber.lot_id == Lot.id)
        .order_by(*order)
    )
    serials = db.execute(stmt).scalars().all()
    if len(serials) < quantity:
        raise InventoryError(
            f"Insufficient in-stock serials at location: need {quantity}, on hand {len(serials)}"
        )
    movements: list[StockMovement] = []
    for serial in serials[:quantity]:
        movements.append(post_journal_entry(
            db, product_id=product_id, user_id=user_id, quantity_change=-1,
            movement_type=SCRAP, from_location_id=location_id,
            lot_id=serial.lot_id, serial_id=serial.id,
            reference_type="cycle_count", reference=reference, notes=notes,
        ))
    return movements


def transfer_stock(
    db: Session,
    *,
    product_id: int,
    user_id: int,
    quantity: int,
    from_location_id: int,
    to_location_id: int,
    lot_id: int | None = None,
    serial_id: int | None = None,
    lpn_id: int | None = None,
    transfer_id: int | None = None,
    reference_type: str = "",
    reference: str = "",
    notes: str = "",
) -> list[StockMovement]:
    """Move stock between two locations, posting a matched transfer_out / transfer_in pair."""
    if quantity <= 0:
        raise InventoryError("Transfer quantity must be positive")
    if from_location_id == to_location_id:
        raise InventoryError("Source and destination locations must differ")
    out = post_journal_entry(
        db,
        product_id=product_id,
        user_id=user_id,
        quantity_change=-quantity,
        movement_type=TRANSFER_OUT,
        from_location_id=from_location_id,
        to_location_id=to_location_id,
        lot_id=lot_id,
        serial_id=serial_id,
        lpn_id=lpn_id,
        transfer_id=transfer_id,
        reference_type=reference_type,
        reference=reference,
        notes=notes,
    )
    inbound = post_journal_entry(
        db,
        product_id=product_id,
        user_id=user_id,
        quantity_change=quantity,
        movement_type=TRANSFER_IN,
        from_location_id=from_location_id,
        to_location_id=to_location_id,
        lot_id=lot_id,
        serial_id=serial_id,
        lpn_id=lpn_id,
        transfer_id=transfer_id,
        reference_type=reference_type,
        reference=reference,
        notes=notes,
    )
    # Link the matched legs both ways so the pair can be found, displayed, and
    # reverted together. Legacy callers may pass their own transfer_id (e.g. a
    # shipment id); it is intentionally overwritten by the pair link.
    out.transfer_id = inbound.id
    inbound.transfer_id = out.id
    return [out, inbound]
