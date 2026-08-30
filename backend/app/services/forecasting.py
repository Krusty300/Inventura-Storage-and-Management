"""Demand forecasting and replenishment intelligence.

Demand is measured from the stock movement ledger: every outward movement of a
sellable product (legacy ``out``, ``sale``, and ``ship``) counts as demand.
Returns are excluded because they restore stock rather than signalling future
demand.

Forecast = weighted moving average of daily demand over the history window,
optionally scaled by a per-weekday seasonality factor. Safety stock follows the
classic newsvendor formula::

    safety_stock = z(service_level) x stddev(daily demand) x sqrt(lead_time)

Lead time is the supplier's configured ``lead_time_days`` when set, otherwise
the average actual lead time of received purchase orders for the product,
otherwise a configurable fallback.

The math helpers are pure functions operating on a ``{date: qty}`` series so
they can be unit-tested without a database. DB-touching functions are thin.
"""

from datetime import datetime, timedelta, timezone
from math import ceil, sqrt

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Order, OrderItem, Product, StockMovement, Supplier
from app.services.inventory import BACKFLUSH, CONSUME, ISSUE, SHIP, quarantined_qty_by_product

# Outward movement types treated as demand. Includes customer outflows
# (legacy "out", "sale", "ship") plus manufacturing consumption (backflush,
# issue, consume) so products consumed by work orders still drive replenishment.
DEMAND_MOVEMENT_TYPES = ("out", "sale", SHIP, BACKFLUSH, ISSUE, CONSUME)

DEFAULT_SERVICE_LEVEL = 0.95
DEFAULT_HISTORY_DAYS = 90
DEFAULT_LEAD_TIME_DAYS = 7
DEFAULT_FALLBACK_LEAD_TIME = 7

# Standard normal z-scores for common service levels.
Z_SCORES = [
    (0.80, 0.842),
    (0.85, 1.036),
    (0.90, 1.282),
    (0.95, 1.645),
    (0.975, 1.960),
    (0.99, 2.326),
    (0.995, 2.576),
    (0.999, 3.090),
]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def z_score(service_level: float) -> float:
    """z value for a target in-stock probability, interpolating the table."""
    sl = min(max(float(service_level), 0.5), 0.9999)
    if sl <= Z_SCORES[0][0]:
        return Z_SCORES[0][1]
    if sl >= Z_SCORES[-1][0]:
        return Z_SCORES[-1][1]
    for (lo_p, lo_z), (hi_p, hi_z) in zip(Z_SCORES, Z_SCORES[1:]):
        if lo_p <= sl <= hi_p:
            t = (sl - lo_p) / (hi_p - lo_p)
            return lo_z + t * (hi_z - lo_z)
    return 1.645


def _date_list(days: int) -> list[str]:
    today = _now().date()
    return [(today - timedelta(days=days - 1 - i)).isoformat() for i in range(days)]


def _per_day(series: dict[str, int], days: int) -> list[int]:
    return [series.get(d, 0) for d in _date_list(days)]


def weighted_moving_average(series: dict[str, int], *, days: int = DEFAULT_HISTORY_DAYS, buckets: int = 4) -> float:
    """Weighted moving average of daily demand: recent buckets weigh more."""
    if not series:
        return 0.0
    daily = _per_day(series, days)
    buckets = max(1, min(buckets, days))
    weights = list(range(1, buckets + 1))
    bucket_size = max(days // buckets, 1)
    total_weighted = 0.0
    total_weight = 0
    for b in range(buckets):
        start = b * bucket_size
        end = days if b == buckets - 1 else min(days, start + bucket_size)
        n = end - start
        if n <= 0:
            continue
        avg = sum(daily[start:end]) / n
        total_weighted += avg * weights[b]
        total_weight += weights[b]
    return total_weighted / total_weight if total_weight else 0.0


def seasonal_factors(series: dict[str, int], *, days: int = DEFAULT_HISTORY_DAYS) -> dict[int, float]:
    """Per-weekday demand multiplier (Monday=0..Sunday=6) vs the overall mean."""
    daily = _per_day(series, days)
    if not any(daily):
        return {w: 1.0 for w in range(7)}
    overall = sum(daily) / days
    if overall <= 0:
        return {w: 1.0 for w in range(7)}
    totals = [0] * 7
    counts = [0] * 7
    today = _now().date()
    for i, qty in enumerate(daily):
        d = today - timedelta(days=days - 1 - i)
        totals[d.weekday()] += qty
        counts[d.weekday()] += 1
    factors = {}
    for w in range(7):
        mean = totals[w] / counts[w] if counts[w] else 0.0
        factors[w] = round(mean / overall, 3) if mean > 0 else 0.0
    return factors


def forecast_daily_demand(
    series: dict[str, int],
    *,
    days: int = DEFAULT_HISTORY_DAYS,
    buckets: int = 4,
    use_seasonality: bool = True,
) -> dict:
    """Expected daily demand: WMA baseline optionally adjusted for seasonality.

    Returns the raw ``baseline``, the per-weekday ``factors``, the blended
    ``forecast`` (mean of baseline x factor over a full week), and the demand
    ``stddev`` used for safety stock.
    """
    baseline = weighted_moving_average(series, days=days, buckets=buckets)
    if use_seasonality and baseline > 0:
        factors = seasonal_factors(series, days=days)
        blend = sum(baseline * factors[w] for w in range(7)) / 7
        forecast = blend if blend > 0 else baseline
    else:
        factors = {w: 1.0 for w in range(7)}
        forecast = baseline
    stddev = demand_stddev(series, days=days)
    return {
        "baseline": round(baseline, 2),
        "factors": factors,
        "forecast": round(forecast, 2),
        "stddev": round(stddev, 2),
    }


def demand_stddev(series: dict[str, int], *, days: int = DEFAULT_HISTORY_DAYS) -> float:
    """Population standard deviation of the daily demand series."""
    daily = _per_day(series, days)
    n = len(daily)
    if n == 0:
        return 0.0
    mean = sum(daily) / n
    return sqrt(sum((q - mean) ** 2 for q in daily) / n)


def load_demand_series(db: Session, *, product_id: int, days: int = DEFAULT_HISTORY_DAYS) -> dict[str, int]:
    """Daily demand history for a product over the trailing ``days`` window."""
    since = _now() - timedelta(days=days)
    rows = (
        db.query(
            func.date(StockMovement.created_at).label("d"),
            func.sum(func.abs(StockMovement.quantity_change)).label("qty"),
        )
        .filter(
            StockMovement.product_id == product_id,
            StockMovement.created_at >= since,
            StockMovement.quantity_change < 0,
            StockMovement.movement_type.in_(DEMAND_MOVEMENT_TYPES),
        )
        .group_by("d")
        .all()
    )
    return {str(d): int(qty) for d, qty in rows}


def lead_time_days(
    db: Session,
    *,
    product_id: int,
    supplier_id: int | None = None,
    fallback: int = DEFAULT_FALLBACK_LEAD_TIME,
) -> tuple[int, str]:
    """Effective replenishment lead time and its source.

    Priority: supplier's configured ``lead_time_days``, then the average actual
    lead time of received purchase orders for this product, then ``fallback``.
    """
    if supplier_id:
        supplier = db.get(Supplier, supplier_id)
        if supplier is not None and supplier.lead_time_days:
            return int(supplier.lead_time_days), "supplier"
    rows = (
        db.query(Order.created_at, Order.updated_at)
        .join(OrderItem, OrderItem.order_id == Order.id)
        .filter(
            OrderItem.product_id == product_id,
            Order.status == "received",
            Order.updated_at.isnot(None),
        )
        .all()
    )
    if rows:
        deltas = [(u - c).total_seconds() / 86400.0 for c, u in rows]
        if deltas:
            return max(int(round(sum(deltas) / len(deltas))), 1), "history"
    return max(int(fallback), 1), "default"


def safety_stock(
    service_level: float,
    stddev: float,
    lead_time: int,
) -> int:
    """safety_stock = z x sigma_demand x sqrt(lead_time)."""
    return int(round(z_score(service_level) * stddev * sqrt(max(int(lead_time), 1))))


def reorder_point(forecast: float, lead_time: int, safety: int) -> int:
    """Order when on-hand + open orders drops below forecast x lead time + safety."""
    return ceil(max(forecast, 0.0) * max(int(lead_time), 1) + safety)


def suggested_order_qty(
    forecast: float,
    lead_time: int,
    safety: int,
    on_hand: int,
    open_orders: int,
    *,
    review_period: int = 0,
    reorder_level: int = 0,
) -> int:
    """Quantity to bring inventory back up to the forecast target level.

    When there is no meaningful demand forecast (``forecast`` and ``safety`` are
    both zero) the configured ``reorder_level`` acts as a static reorder point:
    stock below it is topped back up to the level.
    """
    horizon = max(int(lead_time), 1) + max(int(review_period), 0)
    target = max(forecast, 0.0) * horizon + safety
    qty = ceil(max(target - int(on_hand) - int(open_orders), 0))
    if qty <= 0 and int(reorder_level) > 0:
        gap = int(reorder_level) - int(on_hand) - int(open_orders)
        if gap > 0:
            qty = ceil(gap)
    return qty


def open_order_qty(db: Session, *, product_id: int) -> int:
    """Units already on open (pending) purchase orders for the product."""
    return (
        db.query(func.coalesce(func.sum(OrderItem.quantity), 0))
        .join(Order, Order.id == OrderItem.order_id)
        .filter(OrderItem.product_id == product_id, Order.status == "pending")
        .scalar()
        or 0
    )


def replenishment_rows(
    db: Session,
    *,
    service_level: float = DEFAULT_SERVICE_LEVEL,
    days: int = DEFAULT_HISTORY_DAYS,
    lead_time_override: int | None = None,
) -> list[dict]:
    """Per-product replenishment intelligence for every active, non-variant product."""
    products = (
        db.query(Product)
        .filter(
            Product.is_active == True,  # noqa: E712
            Product.id.notin_(Product.variant_parent_id_subquery()),
        )
        .all()
    )
    quarantined = quarantined_qty_by_product(db, [p.id for p in products])

    rows = []
    for p in products:
        series = load_demand_series(db, product_id=p.id, days=days)
        f = forecast_daily_demand(series, days=days)
        if lead_time_override:
            lt, source = max(int(lead_time_override), 1), "override"
        else:
            lt, source = lead_time_days(db, product_id=p.id, supplier_id=p.supplier_id)
        safety = safety_stock(service_level, f["stddev"], lt)
        rp = reorder_point(f["forecast"], lt, safety)
        on_hand = max(0, int(p.quantity) - quarantined.get(p.id, 0))
        open_qty = open_order_qty(db, product_id=p.id)
        suggested = suggested_order_qty(
            f["forecast"], lt, safety, on_hand, open_qty,
            reorder_level=p.reorder_level,
        )
        rows.append({
            "product_id": p.id,
            "product_name": p.display_name,
            "sku": p.sku,
            "supplier": p.supplier_name,
            "supplier_id": p.supplier_id,
            "on_hand": on_hand,
            "reorder_level": p.reorder_level,
            "lead_time_days": lt,
            "lead_time_source": source,
            "forecast": f["forecast"],
            "baseline": f["baseline"],
            "stddev": f["stddev"],
            "safety_stock": safety,
            "reorder_point": rp,
            "open_orders": open_qty,
            "suggested_order_qty": suggested,
            "days_of_cover": round(on_hand / f["forecast"], 1) if f["forecast"] > 0 else None,
            "status": "reorder" if suggested > 0 else "ok",
        })

    rows.sort(key=lambda r: (r["status"] != "reorder", r["suggested_order_qty"]), reverse=True)
    return rows


def product_forecast_detail(
    db: Session,
    *,
    product_id: int,
    service_level: float = DEFAULT_SERVICE_LEVEL,
    days: int = DEFAULT_HISTORY_DAYS,
    lead_time_override: int | None = None,
) -> dict:
    """Detail for one product: full series plus forecast projection for charts."""
    p = db.get(Product, product_id)
    if p is None:
        raise ValueError("Product not found")
    series = load_demand_series(db, product_id=product_id, days=days)
    f = forecast_daily_demand(series, days=days)
    if lead_time_override:
        lt, source = max(int(lead_time_override), 1), "override"
    else:
        lt, source = lead_time_days(db, product_id=product_id, supplier_id=p.supplier_id)
    safety = safety_stock(service_level, f["stddev"], lt)
    rp = reorder_point(f["forecast"], lt, safety)
    quarantined = quarantined_qty_by_product(db, [product_id]).get(product_id, 0)
    on_hand = max(0, int(p.quantity) - quarantined)
    open_qty = open_order_qty(db, product_id=product_id)
    suggested = suggested_order_qty(
        f["forecast"], lt, safety, on_hand, open_qty,
        reorder_level=p.reorder_level,
    )

    start = _now().date()
    dates = _date_list(days)
    daily = [{"date": d, "quantity": series.get(d, 0)} for d in dates]
    projection_days = max(lt, 7)
    forecast_series = []
    for i in range(1, projection_days + 1):
        d = start + timedelta(days=i)
        day_fc = f["baseline"] * f["factors"][d.weekday()]
        forecast_series.append({"date": d.isoformat(), "forecast": round(day_fc, 2)})

    return {
        "product_id": p.id,
        "product_name": p.display_name,
        "sku": p.sku,
        "supplier": p.supplier_name,
        "supplier_id": p.supplier_id,
        "service_level": service_level,
        "days": days,
        "forecast": f["forecast"],
        "baseline": f["baseline"],
        "factors": f["factors"],
        "stddev": f["stddev"],
        "lead_time_days": lt,
        "lead_time_source": source,
        "safety_stock": safety,
        "reorder_point": rp,
        "on_hand": on_hand,
        "open_orders": open_qty,
        "suggested_order_qty": suggested,
        "daily": daily,
        "forecast_series": forecast_series,
    }
