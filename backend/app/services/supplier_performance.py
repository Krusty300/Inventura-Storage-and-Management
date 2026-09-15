"""Supplier performance analytics.

Reliability dimensions are derived from the existing ledger:

* **On-time delivery** compares ``expected_arrival`` to ``received_at`` on
  received purchase orders.
* **Lead-time adherence** compares the average actual lead time (created to
  received) against the supplier's configured ``lead_time_days``.
* **Quality pass rate** rolls up ``QualityCheck`` results for lots supplied by
  the supplier (or, for lot-less checks, the product's default supplier).

Volume/spend plus a monthly unit-price trend round out the picture. Scoring is
a weighted combination of the dimensions that actually have data (on-time 40%,
quality 30%, lead-time adherence 30%), renormalising weights when a dimension
is missing. Suppliers with no observations have ``score=None``.
"""

from datetime import datetime, time, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.asn import ASN
from app.models.lot import Lot
from app.models.order import Order, OrderItem
from app.models.product import Product
from app.models.quality_check import QualityCheck
from app.models.receipt import Receipt
from app.models.supplier import Supplier

ON_TIME_WEIGHT = 40
QUALITY_WEIGHT = 30
LEAD_TIME_WEIGHT = 30

TERMINAL_STATUSES = ("received", "cancelled")


def _rate(numerator: int, denominator: int) -> float | None:
    if not denominator:
        return None
    return round(100.0 * numerator / denominator, 1)


def _rating(score: float | None) -> str | None:
    if score is None:
        return None
    if score >= 85:
        return "excellent"
    if score >= 70:
        return "good"
    if score >= 50:
        return "fair"
    return "poor"


def _received_orders(db: Session, supplier_id: int) -> list[Order]:
    return (
        db.query(Order)
        .filter(Order.supplier_id == supplier_id, Order.status == "received")
        .all()
    )


def _received_asns(db: Session, supplier_id: int) -> list[ASN]:
    return (
        db.query(ASN)
        .filter(ASN.supplier_id == supplier_id, ASN.status == "received")
        .all()
    )


def _on_time_dimension(orders: list[Order], asns: list[ASN]) -> dict:
    """On-time rate computed from the union of PO and ASN observations.

    ASN expected-arrival/received pairs are the shipment-level measurements
    and are preferred where they exist; PO-level pairs cover the rest.
    """
    deviations: list[float] = []
    for o in orders:
        if o.expected_arrival is not None and o.received_at is not None:
            deviations.append((o.received_at - o.expected_arrival).total_seconds() / 86400.0)
    from_asns = 0
    for a in asns:
        if a.expected_arrival is not None and a.received_at is not None:
            # expected_arrival is a plain date; the supplier has until end of
            # that UTC day before the shipment counts as late.
            deadline = datetime.combine(a.expected_arrival, time.max).replace(tzinfo=timezone.utc)
            deviations.append((a.received_at - deadline).total_seconds() / 86400.0)
            from_asns += 1
    on_time = sum(1 for d in deviations if d <= 0)
    return {
        "orders": len(deviations),
        "on_time": on_time,
        "late": len(deviations) - on_time,
        "rate": _rate(on_time, len(deviations)),
        "avg_deviation_days": round(sum(deviations) / len(deviations), 1) if deviations else None,
        "from_asns": from_asns,
    }


def _lead_time_dimension(orders: list[Order], supplier: Supplier, on_time: dict) -> dict:
    promised = supplier.lead_time_days
    actual_days = None
    deltas = [
        (o.received_at - o.created_at).total_seconds() / 86400.0
        for o in orders
        if o.received_at is not None and o.created_at is not None
    ]
    if deltas:
        actual_days = round(sum(deltas) / len(deltas), 1)
    adherence = None
    if promised and actual_days is not None:
        exceed = max(actual_days - promised, 0)
        adherence = round(max(0.0, 100.0 * (1 - exceed / max(promised, 1))), 1)
    return {
        "promised_days": promised,
        "actual_avg_days": actual_days,
        "adherence": adherence,
    }


def _quality_dimension(db: Session, supplier_id: int) -> dict:
    rows = (
        db.query(QualityCheck)
        .join(Product, QualityCheck.product_id == Product.id)
        .outerjoin(Lot, QualityCheck.lot_id == Lot.id)
        .filter(QualityCheck.result.in_(("pass", "fail")))
        .all()
    )
    scoped = [
        q for q in rows
        if (q.lot is not None and q.lot.supplier_id == supplier_id)
        or (q.lot is None and q.product is not None and q.product.supplier_id == supplier_id)
    ]
    passed = sum(1 for q in scoped if q.result == "pass")
    failed = len(scoped) - passed
    return {
        "checks": len(scoped),
        "passed": passed,
        "failed": failed,
        "pass_rate": _rate(passed, len(scoped)),
    }


def _volume_dimension(orders: list[Order], db: Session, supplier_id: int) -> dict:
    total_orders = len(orders)
    total_spent = float(sum(o.total_amount or 0 for o in orders))
    open_orders = (
        db.query(func.count(Order.id))
        .filter(Order.supplier_id == supplier_id, Order.status.notin_(TERMINAL_STATUSES))
        .scalar()
        or 0
    )
    last_order_at = max((o.received_at for o in orders if o.received_at), default=None)
    return {
        "total_orders": total_orders,
        "total_spent": round(total_spent, 2),
        "avg_order_value": round(total_spent / total_orders, 2) if total_orders else 0.0,
        "open_orders": open_orders,
        "last_order_at": last_order_at,
    }


def _price_trend(db: Session, supplier_id: int) -> list[dict]:
    rows = (
        db.query(OrderItem.unit_price, Order.created_at)
        .join(Order, Order.id == OrderItem.order_id)
        .filter(Order.supplier_id == supplier_id, Order.status == "received")
        .all()
    )
    buckets: dict[str, dict] = {}
    for unit_price, created_at in rows:
        month = created_at.strftime("%Y-%m")
        b = buckets.setdefault(month, {"sum": 0.0, "items": 0})
        b["sum"] += float(unit_price or 0)
        b["items"] += 1
    return [
        {
            "month": month,
            "avg_unit_price": round(b["sum"] / b["items"], 2) if b["items"] else 0.0,
            "items": b["items"],
        }
        for month, b in sorted(buckets.items())
    ]


def _recent_orders(orders: list[Order], limit: int = 10) -> list[dict]:
    recent = sorted(orders, key=lambda o: o.received_at or o.created_at, reverse=True)[:limit]
    return [{
        "order_id": o.id,
        "order_number": o.order_number,
        "created_at": o.created_at,
        "expected_arrival": o.expected_arrival,
        "received_at": o.received_at,
        "on_time": (
            o.received_at <= o.expected_arrival
            if o.expected_arrival is not None and o.received_at is not None
            else None
        ),
    } for o in recent]


def _supply_chain_dimension(db: Session, supplier_id: int) -> dict:
    total_asns = (
        db.query(func.count(ASN.id)).filter(ASN.supplier_id == supplier_id).scalar() or 0
    )
    open_asns = (
        db.query(func.count(ASN.id))
        .filter(ASN.supplier_id == supplier_id, ASN.status == "pending")
        .scalar()
        or 0
    )
    received_asns = (
        db.query(func.count(ASN.id))
        .filter(ASN.supplier_id == supplier_id, ASN.status == "received")
        .scalar()
        or 0
    )
    total_receipts = (
        db.query(func.count(Receipt.id)).filter(Receipt.supplier_id == supplier_id).scalar()
        or 0
    )
    received_units = (
        db.query(func.coalesce(func.sum(Receipt.total_quantity), 0))
        .filter(Receipt.supplier_id == supplier_id)
        .scalar()
        or 0
    )
    return {
        "total_asns": int(total_asns),
        "open_asns": int(open_asns),
        "received_asns": int(received_asns),
        "total_receipts": int(total_receipts),
        "received_units": int(received_units),
    }


def supplier_performance(db: Session, supplier: Supplier) -> dict:
    """Full performance detail for one supplier."""
    orders = _received_orders(db, supplier.id)
    asns = _received_asns(db, supplier.id)
    on_time = _on_time_dimension(orders, asns)
    lead = _lead_time_dimension(orders, supplier, on_time)
    quality = _quality_dimension(db, supplier.id)
    volume = _volume_dimension(orders, db, supplier.id)

    components: list[tuple[float, int]] = []
    if on_time["rate"] is not None:
        components.append((on_time["rate"], ON_TIME_WEIGHT))
    if quality["pass_rate"] is not None:
        components.append((quality["pass_rate"], QUALITY_WEIGHT))
    if lead["adherence"] is not None:
        components.append((lead["adherence"], LEAD_TIME_WEIGHT))
    score = round(sum(p * w for p, w in components) / sum(w for _, w in components), 1) if components else None

    return {
        "supplier_id": supplier.id,
        "name": supplier.name,
        "score": score,
        "rating": _rating(score),
        "on_time": on_time,
        "lead_time": lead,
        "quality": quality,
        "volume": volume,
        "supply_chain": _supply_chain_dimension(db, supplier.id),
        "price_trend": _price_trend(db, supplier.id),
        "recent_orders": _recent_orders(orders),
    }


def supplier_performance_list(
    db: Session,
    *,
    search: str = "",
    sort_by: str = "score",
    order: str = "desc",
) -> dict:
    q = db.query(Supplier).filter(Supplier.is_deleted.is_(False))
    if search:
        like = f"%{search}%"
        q = q.filter(
            Supplier.name.ilike(like)
            | Supplier.contact_person.ilike(like)
            | Supplier.email.ilike(like)
        )
    suppliers = q.all()
    items = []
    for s in suppliers:
        perf = supplier_performance(db, s)
        items.append({
            "supplier_id": s.id,
            "name": s.name,
            "is_active": s.is_active,
            "score": perf["score"],
            "rating": perf["rating"],
            "on_time_rate": perf["on_time"]["rate"],
            "quality_pass_rate": perf["quality"]["pass_rate"],
            "lead_adherence": perf["lead_time"]["adherence"],
            **perf["volume"],
        })
    reverse = order == "desc"
    sort_keys = {
        "score": lambda i: (i["score"] is not None, i["score"] or 0.0),
        "name": lambda i: (i["name"].lower(),),
        "total_spent": lambda i: (i["total_spent"],),
        "total_orders": lambda i: (i["total_orders"],),
        "on_time": lambda i: (i["on_time_rate"] is not None, i["on_time_rate"] or 0.0),
    }
    key = sort_keys.get(sort_by, sort_keys["score"])
    items.sort(key=lambda i: tuple(x for x in key(i)), reverse=reverse)
    return {"items": items, "total": len(items)}