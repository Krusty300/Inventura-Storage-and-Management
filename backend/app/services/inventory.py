from datetime import date, datetime, timezone
import logging

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Location, Lot, Product, SerialNumber, StockLine, StockMovement
from app.services.notify import notify_lot_expired
from app.utils import broadcast_change

log = logging.getLogger("app.inventory")


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
RELEASE = "release"
CONSUME = "consume"

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
    RELEASE,
    CONSUME,
    # Legacy types used by the existing API contract
    "in",
    "out",
    "return",
}

# Bookkeeping / reconciliation movements that don't represent real physical
# product flow into or out of the business. Excluded from activity charts and
# day counters (e.g. stock-movement trends, "movements today") so those metrics
# reflect actual customer/supplier/manufacturing activity rather than internal
# adjustments (activate/deactivate, cycle counts, releases, WIP consumption).
# TRANSFER_OUT is excluded separately because it is only the pair leg of a
# transfer that transfer_in already represents.
NON_ACTIVITY_MOVEMENT_TYPES = {
    DEACTIVATE,
    ACTIVATE,
    COUNT,
    RELEASE,
    CONSUME,
}

SERIAL_STATUS_IN_STOCK = "in_stock"
SERIAL_STATUS_RESERVED = "reserved"
SERIAL_STATUS_SOLD = "sold"
SERIAL_STATUS_QUARANTINED = "quarantined"
SERIAL_STATUS_SCRAPPED = "scrapped"
SERIAL_STATUS_INACTIVE = "inactive"
SERIAL_STATUS_CONSUMED = "consumed"


def validate_serial_movable(
    serial: SerialNumber,
    to_loc_type: str | None = None,
    allow_quarantined: bool = False,
) -> None:
    """Validate that a serial number is in a movable state.

    A serial can be moved only if its status is ``in_stock`` (or
    ``quarantined`` when the move is to a quarantine area) and its lot is
    likewise ``in_stock`` (or ``quarantined`` for quarantine-area moves).
    Raises ``InventoryError`` with a human-readable reason otherwise.

    ``allow_quarantined`` is an explicit override for flows whose source or
    destination is already known to be a quarantine area; ``to_loc_type`` is
    the destination location type used to derive the same flag.
    """
    allow_quarantined = allow_quarantined or to_loc_type == "quarantine"
    if serial.status == SERIAL_STATUS_QUARANTINED and not allow_quarantined:
        raise InventoryError(
            f"Serial '{serial.serial_number}' is quarantined - it can only be moved to a quarantine area"
        )
    if serial.status not in (SERIAL_STATUS_IN_STOCK, SERIAL_STATUS_QUARANTINED):
        raise InventoryError(
            f"Serial '{serial.serial_number}' is not in stock (status: {serial.status})"
        )
    if serial.lot is not None:
        if serial.lot.status == "quarantined" and not allow_quarantined:
            raise InventoryError(
                f"Serial '{serial.serial_number}' belongs to lot '{serial.lot.lot_number}' which is quarantined - it can only be moved to a quarantine area"
            )
        if serial.lot.status not in ("in_stock", "quarantined"):
            raise InventoryError(
                f"Serial '{serial.serial_number}' belongs to lot '{serial.lot.lot_number}' which is {serial.lot.status} - it cannot be moved"
            )


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
            .where(
                SerialNumber.product_id == product_id,
                SerialNumber.status.in_([SERIAL_STATUS_IN_STOCK, SERIAL_STATUS_QUARANTINED]),
            )
        )
        if sellable_only:
            stmt = stmt.where(SerialNumber.status == SERIAL_STATUS_IN_STOCK).outerjoin(
                Lot, SerialNumber.lot_id == Lot.id
            ).where(
                (SerialNumber.lot_id.is_(None)) | (Lot.status == "in_stock")
            )
        if location_id is not None:
            stmt = stmt.where(SerialNumber.location_id == location_id)
        if lot_id is not None:
            stmt = stmt.where(SerialNumber.lot_id == lot_id)
        return int(db.execute(stmt).scalar() or 0)
    stmt = select(func.coalesce(func.sum(StockLine.quantity), 0)).where(
        StockLine.product_id == product_id,
        (StockLine.location_id.is_(None))
        | (Location.location_type.is_(None))
        | (Location.location_type != "wip"),
    ).outerjoin(Location, StockLine.location_id == Location.id)
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
    """Scalar subquery: quarantined quantity for the correlated Product row.

    Bulk stock counts units held in quarantined lots; serialized products have
    no stock lines, so the count of ``quarantined`` serial numbers is added.
    Quarantined stock is on-hand but not sellable.
    """
    stock = (
        select(func.coalesce(func.sum(StockLine.quantity), 0))
        .join(Lot, StockLine.lot_id == Lot.id)
        .where(StockLine.product_id == Product.id, Lot.status == "quarantined")
        .scalar_subquery()
    )
    serials = (
        select(func.count(SerialNumber.id))
        .where(SerialNumber.product_id == Product.id, SerialNumber.status == SERIAL_STATUS_QUARANTINED)
        .scalar_subquery()
    )
    return func.coalesce(stock, 0) + func.coalesce(serials, 0)


def quarantined_qty_by_product(db: Session, product_ids: list[int] | None = None) -> dict[int, int]:
    """Map of product_id -> quantity held in quarantine.

    Bulk units in quarantined lots plus quarantined serial numbers (serialized
    products have no stock lines, so both sources must be counted).

    Optionally restricted to ``product_ids`` so a page of products can be
    annotated without scanning the whole stock_lines table.
    """
    result: dict[int, int] = {}
    stock_stmt = (
        select(StockLine.product_id, func.sum(StockLine.quantity))
        .join(Lot, StockLine.lot_id == Lot.id)
        .where(Lot.status == "quarantined")
    )
    if product_ids:
        stock_stmt = stock_stmt.where(StockLine.product_id.in_(product_ids))
    for pid, qty in db.execute(stock_stmt.group_by(StockLine.product_id)).all():
        result[int(pid)] = result.get(int(pid), 0) + int(qty or 0)
    serial_stmt = (
        select(SerialNumber.product_id, func.count(SerialNumber.id))
        .where(SerialNumber.status == SERIAL_STATUS_QUARANTINED)
    )
    if product_ids:
        serial_stmt = serial_stmt.where(SerialNumber.product_id.in_(product_ids))
    for pid, qty in db.execute(serial_stmt.group_by(SerialNumber.product_id)).all():
        result[int(pid)] = result.get(int(pid), 0) + int(qty or 0)
    return result


def sellable_qty_subquery():
    """Scalar subquery: sellable quantity for the correlated Product row.

    Bulk products sum positive stock lines held in ``in_stock`` lots (or no
    lot); serialized products count ``in_stock`` serials whose lot is not
    quarantined/expired. Product rows are either serialized or not, so exactly
    one term applies. Replaces the old ``quantity - quarantined`` arithmetic,
    which double-counted for serialized products (a quarantined serial is not
    counted in ``Product.quantity``).
    """
    stock = (
        select(func.coalesce(func.sum(StockLine.quantity), 0))
        .outerjoin(Lot, StockLine.lot_id == Lot.id)
        .outerjoin(Location, StockLine.location_id == Location.id)
        .where(
            StockLine.product_id == Product.id,
            (StockLine.lot_id.is_(None)) | (Lot.status == "in_stock"),
            (StockLine.location_id.is_(None))
            | (Location.location_type.is_(None))
            | (Location.location_type != "wip"),
        )
        .scalar_subquery()
    )
    serials = (
        select(func.count(SerialNumber.id))
        .outerjoin(Lot, SerialNumber.lot_id == Lot.id)
        .where(
            SerialNumber.product_id == Product.id,
            SerialNumber.status == SERIAL_STATUS_IN_STOCK,
            (SerialNumber.lot_id.is_(None)) | (Lot.status == "in_stock"),
        )
        .scalar_subquery()
    )
    return func.coalesce(stock, 0) + func.coalesce(serials, 0)


def sellable_qty_by_product(db: Session, product_ids: list[int] | None = None) -> dict[int, int]:
    """Map of product_id -> sellable quantity (bulk lines in in_stock lots plus
    in_stock serials outside quarantined/expired lots). Mirrors
    ``sellable_qty_subquery`` as a batched per-product lookup."""
    result: dict[int, int] = {}
    stock_stmt = (
        select(StockLine.product_id, func.sum(StockLine.quantity))
        .outerjoin(Lot, StockLine.lot_id == Lot.id)
        .outerjoin(Location, StockLine.location_id == Location.id)
        .where(
            StockLine.quantity > 0,
            (StockLine.lot_id.is_(None)) | (Lot.status == "in_stock"),
            (StockLine.location_id.is_(None))
            | (Location.location_type.is_(None))
            | (Location.location_type != "wip"),
        )
    )
    if product_ids:
        stock_stmt = stock_stmt.where(StockLine.product_id.in_(product_ids))
    for pid, qty in db.execute(stock_stmt.group_by(StockLine.product_id)).all():
        result[int(pid)] = result.get(int(pid), 0) + int(qty or 0)
    serial_stmt = (
        select(SerialNumber.product_id, func.count(SerialNumber.id))
        .outerjoin(Lot, SerialNumber.lot_id == Lot.id)
        .where(
            SerialNumber.status == SERIAL_STATUS_IN_STOCK,
            (SerialNumber.lot_id.is_(None)) | (Lot.status == "in_stock"),
        )
    )
    if product_ids:
        serial_stmt = serial_stmt.where(SerialNumber.product_id.in_(product_ids))
    for pid, qty in db.execute(serial_stmt.group_by(SerialNumber.product_id)).all():
        result[int(pid)] = result.get(int(pid), 0) + int(qty or 0)
    return result


def reserved_qty_by_product(db: Session, product_ids: list[int] | None = None) -> dict[int, int]:
    """Map of product_id -> quantity reserved for work orders.

    Serialized products count serials with status ``reserved`` (issued to an
    open work order); bulk products have no reservation state, so only the
    serialized term contributes. Reserved units are on hand but not sellable.

    Optionally restricted to ``product_ids`` so a page of products can be
    annotated without scanning the whole serial_numbers table.
    """
    result: dict[int, int] = {}
    serial_stmt = (
        select(SerialNumber.product_id, func.count(SerialNumber.id))
        .where(SerialNumber.status == SERIAL_STATUS_RESERVED)
    )
    if product_ids:
        serial_stmt = serial_stmt.where(SerialNumber.product_id.in_(product_ids))
    for pid, qty in db.execute(serial_stmt.group_by(SerialNumber.product_id)).all():
        result[int(pid)] = result.get(int(pid), 0) + int(qty or 0)
    return result


def expired_lot_qty_by_product(db: Session, product_ids: list[int] | None = None) -> dict[int, int]:
    """Map of product_id -> quantity held in expired lots.

    Bulk units in expired lots plus ``in_stock`` serials whose lot is expired
    (serialized products have no stock lines, so both sources must be counted).
    Both legs exclude WIP-held stock so the E badge stays a breakdown of on-hand.
    Only ``in_stock`` serials count - reserved/sold units are no longer on hand.

    Optionally restricted to ``product_ids`` so a page of products can be
    annotated without scanning the whole stock_lines/serial_numbers tables.
    """
    result: dict[int, int] = {}
    stock_stmt = (
        select(StockLine.product_id, func.sum(StockLine.quantity))
        .join(Lot, StockLine.lot_id == Lot.id)
        .outerjoin(Location, StockLine.location_id == Location.id)
        .where(
            Lot.status == "expired",
            (StockLine.location_id.is_(None))
            | (Location.location_type.is_(None))
            | (Location.location_type != "wip"),
        )
    )
    if product_ids:
        stock_stmt = stock_stmt.where(StockLine.product_id.in_(product_ids))
    for pid, qty in db.execute(stock_stmt.group_by(StockLine.product_id)).all():
        result[int(pid)] = result.get(int(pid), 0) + int(qty or 0)
    serial_stmt = (
        select(SerialNumber.product_id, func.count(SerialNumber.id))
        .join(Lot, SerialNumber.lot_id == Lot.id)
        .where(Lot.status == "expired", SerialNumber.status == SERIAL_STATUS_IN_STOCK)
    )
    if product_ids:
        serial_stmt = serial_stmt.where(SerialNumber.product_id.in_(product_ids))
    for pid, qty in db.execute(serial_stmt.group_by(SerialNumber.product_id)).all():
        result[int(pid)] = result.get(int(pid), 0) + int(qty or 0)
    return result


def expire_overdue_lots(db: Session) -> int:
    """Flip ``in_stock`` lots whose expiry date has passed to ``expired``.

    Runs on startup and on the read endpoints that surface lot or sellable
    stock, so overdue lots are reflected without waiting for a manual status
    change. Quarantined lots are intentionally left as-is for manual resolution.
    """
    overdue = (
        db.query(Lot)
        .filter(
            Lot.expiry_date.isnot(None),
            Lot.expiry_date < date.today(),
            Lot.status == "in_stock",
        )
        .all()
    )
    for lot in overdue:
        lot.status = "expired"
    if not overdue:
        return 0
    for lot in overdue:
        try:
            notify_lot_expired(db, lot)
        except Exception:
            log.warning("Failed to send expiry notification for lot %s", lot.lot_number, exc_info=True)
    broadcast_change("lot", "updated")
    db.commit()
    return len(overdue)


def sync_serialized_lot_status(db: Session, lot_id: int | None) -> None:
    """Keep a serialized lot's status in sync with its remaining stock.

    A serialized lot becomes ``sold`` once none of its units remain in stock
    (all serials shipped), and returns to ``in_stock`` when a refund brings
    units back. Bulk lots and lots without a serialized product are untouched,
    and derived states never clobber ``expired``/``quarantined``.
    """
    if lot_id is None:
        return
    lot = db.get(Lot, lot_id)
    if lot is None or lot.product is None or not lot.product.is_serialized:
        return
    if lot.on_hand > 0 and lot.status != "sold":
        return
    if lot.serial_count == 0 and lot.status == "in_stock":
        lot.status = "sold"
    elif lot.serial_count > 0 and lot.status == "sold":
        lot.status = "in_stock"


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
        .with_for_update()
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
        .with_for_update()
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
            if serial.status == SERIAL_STATUS_SCRAPPED:
                raise InventoryError("Scrapped serials cannot be returned to stock")
            serial.status = SERIAL_STATUS_IN_STOCK
            serial.sold_at = None
            if to_location_id is not None:
                serial.location_id = to_location_id
            if lpn_id is not None or movement_type == TRANSFER_IN:
                serial.lpn_id = lpn_id
        else:
            if serial.status in (
                SERIAL_STATUS_RESERVED,
                SERIAL_STATUS_INACTIVE,
                SERIAL_STATUS_SOLD,
                SERIAL_STATUS_SCRAPPED,
            ) and movement_type != CONSUME:
                raise InventoryError(
                    f"Serial '{serial.serial_number}' is {serial.status} and cannot be moved"
                )
            if serial.status == SERIAL_STATUS_QUARANTINED and movement_type != TRANSFER_OUT:
                raise InventoryError(
                    f"Serial '{serial.serial_number}' is quarantined and cannot be moved that way"
                )
            if movement_type == SALE or movement_type == SHIP:
                serial.status = SERIAL_STATUS_SOLD
                serial.sold_at = datetime.now(timezone.utc)
            elif movement_type == TRANSFER_OUT or movement_type == TRANSFER_IN:
                serial.status = SERIAL_STATUS_IN_STOCK
                if to_location_id is not None and movement_type == TRANSFER_IN:
                    serial.location_id = to_location_id
            elif movement_type in (ISSUE, BACKFLUSH):
                serial.status = SERIAL_STATUS_RESERVED
                if to_location_id is not None:
                    serial.location_id = to_location_id
            elif movement_type == SCRAP:
                serial.status = SERIAL_STATUS_SCRAPPED
            elif movement_type == DEACTIVATE:
                serial.status = SERIAL_STATUS_INACTIVE
            elif movement_type == CONSUME:
                serial.status = SERIAL_STATUS_CONSUMED
            else:
                raise InventoryError(
                    f"Unsupported '{movement_type}' movement out for serialized product "
                    f"'{product.sku or product.name}' (serial {serial.serial_number}). "
                    f"Serialized items are moved by sale, ship, transfer, issue, backflush, "
                    f"scrap, deactivate, or consume only."
                )
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
    log.info(
        "journal: %s product=%d qty=%+d from=%s to=%s ref=%s:%s",
        movement_type, product_id, quantity_change,
        from_location_id or "-", to_location_id or "-",
        reference_type or "-", reference or "-",
    )
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


def _location_lines(
    db: Session,
    *,
    product_id: int,
    location_id: int,
    lot_id: int | None = None,
    sellable_only: bool = False,
    include_quarantined: bool = False,
) -> list[StockLine]:
    """Positive stock lines for a product at a location, loose (non-LPN) first.

    With ``sellable_only=True``, lines held in non-``in_stock`` lots (quarantined
    or expired) are excluded so manual movements mirror what allocations can use.
    With ``include_quarantined=True``, lines in quarantined lots are included in
    addition to ``in_stock`` (expired and other states remain excluded).
    """
    stmt = (
        select(StockLine)
        .where(
            StockLine.product_id == product_id,
            StockLine.location_id == location_id,
            StockLine.quantity > 0,
        )
        .order_by(StockLine.lpn_id.is_(None).desc(), StockLine.id.asc())
    )
    if sellable_only:
        stmt = stmt.outerjoin(Lot, StockLine.lot_id == Lot.id).where(
            (StockLine.lot_id.is_(None)) | (Lot.status == "in_stock")
        )
    elif include_quarantined:
        stmt = stmt.outerjoin(Lot, StockLine.lot_id == Lot.id).where(
            (StockLine.lot_id.is_(None)) | (Lot.status.in_(("in_stock", "quarantined")))
        )
    if lot_id is not None:
        stmt = stmt.where(StockLine.lot_id == lot_id)
    return list(db.execute(stmt).scalars().all())


def _blocked_lot_stock(
    db: Session,
    *,
    product_id: int,
    location_id: int | None = None,
    lpn_id: int | None = None,
    include_quarantined: bool = False,
) -> list[tuple[str, str, int]]:
    """Non-movable lot stock at the given scope, returned as
    ``(lot_number, status, quantity)`` rows for error reporting.

    With ``include_quarantined=True``, quarantined lots are treated as movable
    (quarantine-consistent flows) so only other blocked states (e.g. expired)
    are reported.
    """
    stmt = (
        select(StockLine, Lot)
        .join(Lot, StockLine.lot_id == Lot.id)
        .where(
            StockLine.product_id == product_id,
            StockLine.quantity > 0,
        )
    )
    if include_quarantined:
        stmt = stmt.where(Lot.status.notin_(("in_stock", "quarantined")))
    else:
        stmt = stmt.where(Lot.status != "in_stock")
    if location_id is not None:
        stmt = stmt.where(StockLine.location_id == location_id)
    if lpn_id is not None:
        stmt = stmt.where(StockLine.lpn_id == lpn_id)
    rows = db.execute(stmt).all()
    return [(lot.lot_number, lot.status, int(line.quantity)) for line, lot in rows]


def _blocked_lot_message(rows: list[tuple[str, str, int]]) -> str:
    if not rows:
        return ""
    details = ", ".join(f"'{num}' ({status}, {qty})" for num, status, qty in rows)
    return f"stock in quarantined or expired lots cannot be transferred or moved: {details}"


def auto_quarantine(db: Session, to_loc: Location, movements: list[StockMovement]) -> None:
    """When stock arrives at a quarantine-typed area, quarantine the moved lots and serials.

    The physical move is a normal transfer pair; this flips the ledger-affiliated
    statuses so the stock stops being sellable and renders with the quarantined
    design everywhere. Only ``in_stock`` lots/serials are touched so an already
    quarantined or expired lot keeps its stricter status.
    """
    if to_loc.location_type != "quarantine":
        return
    lot_ids = {m.lot_id for m in movements if m.lot_id is not None}
    for lot_id in lot_ids:
        lot = db.get(Lot, lot_id)
        if lot is not None and lot.status == "in_stock":
            lot.status = "quarantined"
    for m in movements:
        if m.serial_id is not None:
            serial = db.get(SerialNumber, m.serial_id)
            if serial is not None and serial.status == SERIAL_STATUS_IN_STOCK:
                serial.status = SERIAL_STATUS_QUARANTINED
    # A quarantined serial stays on a serialized product's on-hand (matching
    # bulk, where quarantined lots are still counted), so the parity count does
    # not change; refresh it for every affected serialized product anyway.
    for pid in {m.product_id for m in movements if m.serial_id is not None}:
        product = db.get(Product, pid)
        if product is not None and product.is_serialized:
            db.flush()
            product.quantity = on_hand(db, product_id=pid)


def release_serial_from_quarantine(
    db: Session,
    *,
    serial: SerialNumber,
    user_id: int,
    reference: str = "",
    notes: str = "",
) -> StockMovement:
    """Return a quarantined serial to ``in_stock`` in place.

    Posts a ``release`` journal entry so the unit's ledger history records the
    change. If the serial belongs to a quarantined lot and no other quarantined
    serial remains (and no failing quality check still references it), the lot
    is released too so the unit is not left movement-blocked. Caller commits.
    """
    if serial.status != SERIAL_STATUS_QUARANTINED:
        raise InventoryError(f"Serial '{serial.serial_number}' is not quarantined (status: {serial.status})")
    movement = post_journal_entry(
        db, product_id=serial.product_id, user_id=user_id, quantity_change=+1,
        movement_type=RELEASE, to_location_id=serial.location_id,
        lot_id=serial.lot_id, serial_id=serial.id,
        reference_type="release", reference=reference, notes=notes,
    )
    _maybe_release_serial_lot(db, serial)
    return movement


def _maybe_release_serial_lot(db: Session, serial: SerialNumber) -> None:
    """Release a quarantined lot once none of its serials are quarantined and no
    failing quality check references it (keeps lot and serial states coherent)."""
    if serial.lot is None or serial.lot.status != SERIAL_STATUS_QUARANTINED:
        return
    still_quarantined = db.query(SerialNumber.id).filter(
        SerialNumber.lot_id == serial.lot.id,
        SerialNumber.status == SERIAL_STATUS_QUARANTINED,
    ).first()
    if still_quarantined is not None:
        return
    from app.models.quality_check import QualityCheck
    failing = db.query(QualityCheck.id).filter(
        QualityCheck.lot_id == serial.lot.id, QualityCheck.result == "fail"
    ).first()
    if failing is None:
        serial.lot.status = SERIAL_STATUS_IN_STOCK


def release_serial_from_reserved(
    db: Session,
    *,
    serial: SerialNumber,
    user_id: int,
    reference: str = "",
    notes: str = "",
) -> StockMovement:
    """Return a reserved (work-order-issued) serial to ``in_stock`` at the
    location it was issued from.

    Looks up the most recent ``issue`` journal entry for the serial and restores
    it to that movement's ``from_location_id`` (falling back to the serial's
    current location). Posts a positive ``release`` journal entry so the unit's
    ledger history records the change. Caller commits.
    """
    if serial.status != SERIAL_STATUS_RESERVED:
        raise InventoryError(f"Serial '{serial.serial_number}' is not reserved (status: {serial.status})")
    issue = (
        db.query(StockMovement)
        .filter(
            StockMovement.serial_id == serial.id,
            StockMovement.movement_type.in_([ISSUE, BACKFLUSH]),
        )
        .order_by(StockMovement.created_at.desc(), StockMovement.id.desc())
        .first()
    )
    location_id = issue.from_location_id if issue is not None else serial.location_id
    return post_journal_entry(
        db, product_id=serial.product_id, user_id=user_id, quantity_change=+1,
        movement_type=RELEASE, to_location_id=location_id,
        lot_id=serial.lot_id, serial_id=serial.id,
        reference_type="release", reference=reference, notes=notes,
    )


def quarantine_lot_serials(db: Session, lot: Lot) -> None:
    """Cascade a lot-level quarantine to its serials (``in_stock`` -> ``quarantined``).

    Keeps serialized lots coherent with ``auto_quarantine`` so a QC-failed lot's
    units render as quarantined everywhere. Quarantined serials remain on a
    serialized product's on-hand (matching bulk), so the parity count is just
    refreshed, not decremented. Caller commits.
    """
    changed = False
    for s in lot.serial_numbers:
        if s.status == SERIAL_STATUS_IN_STOCK:
            s.status = SERIAL_STATUS_QUARANTINED
            changed = True
    if changed:
        product = db.get(Product, lot.product_id)
        if product is not None and product.is_serialized:
            db.flush()
            product.quantity = on_hand(db, product_id=lot.product_id)


def release_lot_serials(
    db: Session,
    lot: Lot,
    *,
    user_id: int,
    reference: str = "",
    notes: str = "",
) -> list[StockMovement]:
    """Release every quarantined serial of a lot back to ``in_stock``.

    Used when a quarantined lot is released (manually or by a passing quality
    check) so its units are not left permanently stuck. Posts a ``release``
    movement per serial. Caller commits.
    """
    movements: list[StockMovement] = []
    for s in lot.serial_numbers:
        if s.status == SERIAL_STATUS_QUARANTINED:
            movements.append(release_serial_from_quarantine(
                db, serial=s, user_id=user_id, reference=reference, notes=notes,
            ))
    return movements


def _post_line_transfer_pairs(
    db: Session,
    *,
    product_id: int,
    user_id: int,
    lines: list[StockLine],
    quantity: int,
    from_location_id: int,
    to_location_id: int,
    inbound_lpn_id: int | None,
    reference_type: str = "",
    reference: str = "",
    notes: str = "",
) -> list[StockMovement]:
    """Consume `quantity` across the given stock lines, posting a matched
    transfer_out / transfer_in pair per line. Inbound legs land with
    `inbound_lpn_id` (None = loose stock at the destination)."""
    movements: list[StockMovement] = []
    remaining = quantity
    for line in lines:
        if remaining <= 0:
            break
        take = min(line.quantity, remaining)
        if take <= 0:
            continue
        out = post_journal_entry(
            db, product_id=product_id, user_id=user_id,
            quantity_change=-take, movement_type=TRANSFER_OUT,
            from_location_id=from_location_id, to_location_id=to_location_id,
            lot_id=line.lot_id, lpn_id=line.lpn_id,
            reference_type=reference_type, reference=reference, notes=notes,
        )
        inbound = post_journal_entry(
            db, product_id=product_id, user_id=user_id,
            quantity_change=take, movement_type=TRANSFER_IN,
            from_location_id=from_location_id, to_location_id=to_location_id,
            lot_id=line.lot_id, lpn_id=inbound_lpn_id,
            reference_type=reference_type, reference=reference, notes=notes,
        )
        out.transfer_id = inbound.id
        inbound.transfer_id = out.id
        movements.extend([out, inbound])
        remaining -= take
    if remaining > 0:
        raise InventoryError(f"Insufficient stock to satisfy transfer of {quantity}")
    return movements


def transfer_from_location(
    db: Session,
    *,
    product_id: int,
    user_id: int,
    quantity: int,
    from_location_id: int,
    to_location_id: int,
    lot_id: int | None = None,
    transfer_id: int | None = None,
    reference_type: str = "",
    reference: str = "",
    notes: str = "",
) -> list[StockMovement]:
    """Move `quantity` of a non-serialized product between locations.

    Consumes from the source location's stock lines across every LPN identity
    (non-LPN lines first, then LPN-held lines) so the full on-hand shown in the
    transfer modal is actually moveable. Inbound legs land as non-LPN stock at
    the destination, so partial LPN contents are unloaded rather than dragged to
    the new location against the LPN's real location.
    """
    if quantity <= 0:
        raise InventoryError("Transfer quantity must be positive")
    if from_location_id == to_location_id:
        raise InventoryError("Source and destination locations must differ")
    lines = _location_lines(db, product_id=product_id, location_id=from_location_id, lot_id=lot_id, sellable_only=True)
    sellable_total = sum(line.quantity for line in lines)
    if quantity > sellable_total:
        blocked = _blocked_lot_stock(db, product_id=product_id, location_id=from_location_id)
        if blocked:
            raise InventoryError(
                f"Insufficient sellable stock: need {quantity}, on hand {sellable_total}. {_blocked_lot_message(blocked)}"
            )
        raise InventoryError(f"Insufficient stock: need {quantity}, on hand {sellable_total}")
    return _post_line_transfer_pairs(
        db, product_id=product_id, user_id=user_id, lines=lines, quantity=quantity,
        from_location_id=from_location_id, to_location_id=to_location_id,
        inbound_lpn_id=None, reference_type=reference_type, reference=reference, notes=notes,
    )


def load_into_lpn(
    db: Session,
    *,
    product_id: int,
    user_id: int,
    quantity: int,
    location_id: int,
    lpn_id: int,
    lot_id: int | None = None,
    include_quarantined: bool = False,
    reference: str = "",
    notes: str = "",
) -> list[StockMovement]:
    """Move `quantity` of loose stock at a location into the LPN's stock line.

    Consumes the location's stock across every LPN identity (loose first, then
    LPN-held) and re-lands it on the LPN, so partial contents of other LPNs at
    the same location can also be consolidated. Posts a transfer pair per source
    line, with the inbound leg carrying the destination LPN. With
    ``include_quarantined=True``, stock in quarantined lots can be loaded (e.g.
    LPN-ing up stock already held in a quarantine area); expired stock stays
    blocked.
    """
    if quantity <= 0:
        raise InventoryError("Load quantity must be positive")
    lines = _location_lines(
        db, product_id=product_id, location_id=location_id, lot_id=lot_id,
        sellable_only=not include_quarantined, include_quarantined=include_quarantined,
    )
    available_total = sum(line.quantity for line in lines)
    if quantity > available_total:
        blocked = _blocked_lot_stock(db, product_id=product_id, location_id=location_id, include_quarantined=include_quarantined)
        if blocked:
            raise InventoryError(
                f"Insufficient movable stock: need {quantity}, on hand {available_total}. {_blocked_lot_message(blocked)}"
            )
        raise InventoryError(f"Insufficient stock: need {quantity}, on hand {available_total}")
    return _post_line_transfer_pairs(
        db, product_id=product_id, user_id=user_id, lines=lines, quantity=quantity,
        from_location_id=location_id, to_location_id=location_id,
        inbound_lpn_id=lpn_id, reference_type="lpn_load", reference=reference, notes=notes,
    )


def unload_from_lpn(
    db: Session,
    *,
    product_id: int,
    user_id: int,
    quantity: int,
    location_id: int,
    lpn_id: int,
    to_location_id: int,
    lot_id: int | None = None,
    include_quarantined: bool = False,
    reference: str = "",
    notes: str = "",
) -> list[StockMovement]:
    """Move `quantity` out of an LPN to loose stock at the destination location.

    Consumes the LPN's stock lines (lot-aware when `lot_id` is given) and lands
    the quantity as non-LPN stock at the destination. Posts a transfer pair per
    source line so the ledger stays consistent and reversible. With
    ``include_quarantined=True``, stock in quarantined lots can be unloaded (e.g.
    relocating quarantined LPN contents into a quarantine area); expired stock
    stays blocked.
    """
    if quantity <= 0:
        raise InventoryError("Unload quantity must be positive")
    stmt = (
        select(StockLine)
        .where(
            StockLine.product_id == product_id,
            StockLine.lpn_id == lpn_id,
            StockLine.quantity > 0,
        )
        .outerjoin(Lot, StockLine.lot_id == Lot.id)
    )
    if include_quarantined:
        stmt = stmt.where((StockLine.lot_id.is_(None)) | (Lot.status.in_(("in_stock", "quarantined"))))
    else:
        stmt = stmt.where((StockLine.lot_id.is_(None)) | (Lot.status == "in_stock"))
    stmt = stmt.order_by(StockLine.id.asc())
    if lot_id is not None:
        stmt = stmt.where(StockLine.lot_id == lot_id)
    lines = list(db.execute(stmt).scalars().all())
    available_total = sum(line.quantity for line in lines)
    if quantity > available_total:
        blocked = _blocked_lot_stock(db, product_id=product_id, lpn_id=lpn_id, include_quarantined=include_quarantined)
        if blocked:
            raise InventoryError(
                f"Insufficient movable stock: need {quantity}, on hand {available_total}. {_blocked_lot_message(blocked)}"
            )
        raise InventoryError(f"Insufficient stock: need {quantity}, on hand {available_total}")
    return _post_line_transfer_pairs(
        db, product_id=product_id, user_id=user_id, lines=lines, quantity=quantity,
        from_location_id=location_id, to_location_id=to_location_id,
        inbound_lpn_id=None, reference_type="lpn_unload", reference=reference, notes=notes,
    )
