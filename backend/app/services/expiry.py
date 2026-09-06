"""Shared expiry semantics for product list filters, CSV exports, and widgets.

Keeps the products grid, its export, the dashboard, and notifications on the
same definition of "expired" and "expiring" so the red/amber badges agree with
every filtered surface:

  * expired  - the product holds stock in an expired lot (bulk units in an
               ``expired`` lot, or ``in_stock`` serials whose lot expired) OR
               its static ``Product.expiry_date`` has passed. This matches the
               red badge and the ``E`` lot badge, so no sellable-stock
               requirement is added.
  * expiring - a static expiry date inside the warning window OR sellable stock
               (bulk / serial) held in an ``in_stock`` lot expiring inside the
               window. Requires sellable stock to actually be held, matching
               what can be allocated before it lapses.

The warning window always comes from ``Settings.expiry_warning_days`` so one
knob drives every surface (grid dropdown label, filters, export, dashboard,
notifications). Bulk legs exclude WIP-held stock to stay aligned with
``expired_lot_qty_by_product`` / ``sellable_qty_by_product``.
"""

from datetime import date

from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from app.models import Location, Lot, Product, SerialNumber, StockLine
from app.models.settings import Settings
from app.services.inventory import SERIAL_STATUS_IN_STOCK, sellable_qty_subquery

DEFAULT_EXPIRY_WARNING_DAYS = 30


def warning_window(db: Session) -> int:
    """The expiry warning window in days read from Settings (default 30)."""
    s = db.query(Settings).first()
    days = s.expiry_warning_days if s and s.expiry_warning_days else DEFAULT_EXPIRY_WARNING_DAYS
    return days


def has_expired_stock(pid_col):
    """True when the product row ``pid_col`` holds stock in an expired lot.

    Bulk units sit on stock lines in an expired lot; serialized units are
    ``in_stock`` serials whose lot expired (``expire_overdue_lots`` leaves the
    serial status untouched). Mirrors ``expired_lot_qty_by_product``, including
    the bulk WIP exclusion, so filters and the E badge answer the same question.
    """
    bulk = exists(
        select(StockLine.product_id)
        .join(Lot, StockLine.lot_id == Lot.id)
        .outerjoin(Location, StockLine.location_id == Location.id)
        .where(
            StockLine.product_id == pid_col,
            Lot.status == "expired",
            StockLine.quantity > 0,
            (StockLine.location_id.is_(None))
            | (Location.location_type.is_(None))
            | (Location.location_type != "wip"),
        )
    )
    serial = exists(
        select(SerialNumber.product_id)
        .join(Lot, SerialNumber.lot_id == Lot.id)
        .where(
            SerialNumber.product_id == pid_col,
            Lot.status == "expired",
            SerialNumber.status == SERIAL_STATUS_IN_STOCK,
        )
    )
    return bulk | serial


def has_sellable_stock(pid_col):
    """True when the product row ``pid_col`` holds sellable (allocatable) stock."""
    return sellable_qty_subquery() > 0


def _lot_expiring(pid_col, today: date, soon: date):
    """True when ``pid_col`` holds lot-tracked stock expiring in [today, soon].

    Only ``in_stock`` lots count (the sellable ones a customer could still buy
    before they lapse); quarantined/expired lots render through their own
    badges. Serialized products carry no stock lines, so ``in_stock`` serials
    whose lot expires in the window are counted separately.
    """
    bulk = exists(
        select(StockLine.product_id)
        .join(Lot, StockLine.lot_id == Lot.id)
        .outerjoin(Location, StockLine.location_id == Location.id)
        .where(
            StockLine.product_id == pid_col,
            Lot.status == "in_stock",
            StockLine.quantity > 0,
            Lot.expiry_date.isnot(None),
            Lot.expiry_date >= today,
            Lot.expiry_date <= soon,
            (StockLine.location_id.is_(None))
            | (Location.location_type.is_(None))
            | (Location.location_type != "wip"),
        )
    )
    serial = exists(
        select(SerialNumber.product_id)
        .join(Lot, SerialNumber.lot_id == Lot.id)
        .where(
            SerialNumber.product_id == pid_col,
            Lot.status == "in_stock",
            SerialNumber.status == SERIAL_STATUS_IN_STOCK,
            Lot.expiry_date.isnot(None),
            Lot.expiry_date >= today,
            Lot.expiry_date <= soon,
        )
    )
    return bulk | serial


def expired_condition(pid_col, today: date):
    """SQL condition: the product is expired.

    Expired-lot stock (badge/E-lot parity) OR a static ``expiry_date`` in the
    past (so a lapsed date is shown even with no remaining stock).
    """
    return has_expired_stock(pid_col) | (
        Product.expiry_date.isnot(None) & (Product.expiry_date < today)
    )


def expiring_condition(pid_col, today: date, soon: date):
    """SQL condition: the product is expiring soon.

    A static expiry inside the window, or sellable lot-tracked stock expiring
    inside the window, provided sellable stock is held.
    """
    static_in_window = (
        Product.expiry_date.isnot(None)
        & (Product.expiry_date >= today)
        & (Product.expiry_date <= soon)
    )
    return (static_in_window | _lot_expiring(pid_col, today, soon)) & has_sellable_stock(pid_col)


def lot_expiry_dates_by_product(db: Session, product_ids: list[int]) -> dict[int, list[date]]:
    """Map of product_id -> lot expiry dates of its on-hand stock.

    Bulk: positive stock lines in ``in_stock`` or ``expired`` lots (WIP
    excluded). Serialized: ``in_stock`` serials whose lot is ``in_stock`` or
    ``expired``. Expired lots are included so the nearest expiry drives the red
    badge; quarantined lots are excluded since quarantined units are not
    sellable and are surfaced through the Q badge instead.
    """
    result: dict[int, list[date]] = {}
    if not product_ids:
        return result
    stock_stmt = (
        select(StockLine.product_id, Lot.expiry_date)
        .join(Lot, StockLine.lot_id == Lot.id)
        .outerjoin(Location, StockLine.location_id == Location.id)
        .where(
            StockLine.product_id.in_(product_ids),
            StockLine.quantity > 0,
            Lot.expiry_date.isnot(None),
            Lot.status.in_(("in_stock", "expired")),
            (StockLine.location_id.is_(None))
            | (Location.location_type.is_(None))
            | (Location.location_type != "wip"),
        )
    )
    for pid, expiry in db.execute(stock_stmt).all():
        result.setdefault(int(pid), []).append(expiry)
    serial_stmt = (
        select(SerialNumber.product_id, Lot.expiry_date)
        .join(Lot, SerialNumber.lot_id == Lot.id)
        .where(
            SerialNumber.product_id.in_(product_ids),
            SerialNumber.status == SERIAL_STATUS_IN_STOCK,
            Lot.expiry_date.isnot(None),
            Lot.status.in_(("in_stock", "expired")),
        )
    )
    for pid, expiry in db.execute(serial_stmt).all():
        result.setdefault(int(pid), []).append(expiry)
    return result


def effective_expiry(
    today: date, static_expiry: date | None, lot_dates: list[date]
) -> tuple[date | None, int | None]:
    """Effective expiry date and days left for one product row.

    The nearest of the static product expiry and the stock's lot expiry dates;
    returns ``(None, None)`` when the product carries no expiry information.
    """
    candidates = [d for d in tuple([static_expiry] + lot_dates) if d is not None]
    if not candidates:
        return None, None
    nearest = min(candidates)
    return nearest, (nearest - today).days