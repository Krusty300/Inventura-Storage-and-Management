from datetime import datetime

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
) -> int:
    """Current sellable quantity for a product, optionally filtered by location/lot."""
    product = db.get(Product, product_id)
    if product is None:
        raise InventoryError("Product not found")
    if product.is_serialized:
        stmt = (
            select(func.count(SerialNumber.id))
            .where(SerialNumber.product_id == product_id, SerialNumber.status == SERIAL_STATUS_IN_STOCK)
        )
        if location_id is not None:
            stmt = stmt.where(SerialNumber.location_id == location_id)
        if lot_id is not None:
            stmt = stmt.where(SerialNumber.lot_id == lot_id)
        return int(db.execute(stmt).scalar() or 0)
    stmt = select(func.coalesce(func.sum(StockLine.quantity), 0)).where(StockLine.product_id == product_id)
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
) -> list[tuple[int | None, int]]:
    """Allocate `quantity` from stock lines ordered by soonest expiry (FEFO).
    Returns a list of (lot_id | None, qty) pairs. Raises InventoryError if
    insufficient stock is available."""
    if quantity < 0:
        raise InventoryError("Allocation quantity must be non-negative")
    if quantity == 0:
        return []
    stmt = (
        select(StockLine)
        .where(
            StockLine.product_id == product_id,
            StockLine.quantity > 0,
            (StockLine.lot_id.is_(None)) | (Lot.status == "in_stock"),
        )
        .outerjoin(Lot, StockLine.lot_id == Lot.id)
        .order_by(Lot.expiry_date.asc().nulls_last(), StockLine.id.asc())
    )
    if location_id is not None:
        stmt = stmt.where(StockLine.location_id == location_id)
    lines = db.execute(stmt).scalars().all()

    allocation: list[tuple[int | None, int]] = []
    needed = quantity
    for line in lines:
        if needed == 0:
            break
        take = min(line.quantity, needed)
        allocation.append((line.lot_id, take))
        needed -= take
    if needed > 0:
        raise InventoryError(
            f"Insufficient stock: need {quantity}, on hand {quantity - needed}"
        )
    return allocation


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
            if movement_type == SALE:
                serial.status = SERIAL_STATUS_SOLD
                serial.sold_at = datetime.utcnow()
            elif movement_type == TRANSFER_OUT or movement_type == TRANSFER_IN:
                serial.status = SERIAL_STATUS_IN_STOCK
                if to_location_id is not None and movement_type == TRANSFER_IN:
                    serial.location_id = to_location_id
            elif movement_type == ISSUE:
                serial.status = SERIAL_STATUS_RESERVED
            else:
                serial.status = SERIAL_STATUS_QUARANTINED
    else:
        if quantity_change > 0:
            dest_location = to_location_id if to_location_id is not None else from_location_id
            line = get_or_create_stock_line(
                db, product_id=product_id, location_id=dest_location, lot_id=lot_id, lpn_id=lpn_id
            )
            line.quantity += quantity_change
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
    return [out, inbound]
