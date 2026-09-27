from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models.product import Product as ProductOut
from app.models.restaurant import RestaurantReservation, RestaurantTable, RestaurantTicket, RestaurantTicketItem
from app.models.sale import Sale
from app.routers.reports import parse_range
from app.services.auth import require_permission

router = APIRouter(prefix="/api/reports", tags=["reports"], dependencies=[Depends(require_permission("reports.view"))])

SETTLED = ("settled",)
CLOSED = ("settled", "cancelled")


def _settled_query(start: datetime | None, end: datetime | None) -> select:
    q = select(RestaurantTicket).where(RestaurantTicket.status == "settled")
    if start:
        q = q.where(RestaurantTicket.settled_at >= start)
    if end:
        q = q.where(RestaurantTicket.settled_at <= end)
    return q


@router.get("/restaurant-summary")
def restaurant_summary(
    start_date: str | None = None,
    end_date: str | None = None,
    db: Session = Depends(get_db),
):
    start, end = parse_range(start_date, end_date)
    settled = db.query(RestaurantTicket).options(
        joinedload(RestaurantTicket.sale), joinedload(RestaurantTicket.table), joinedload(RestaurantTicket.user),
    ).filter(RestaurantTicket.status == "settled")
    if start:
        settled = settled.filter(RestaurantTicket.settled_at >= start)
    if end:
        settled = settled.filter(RestaurantTicket.settled_at <= end)
    settled = settled.all()

    revenue = sum(float(t.total_amount) for t in settled)
    tips = sum(float(t.tip_amount or 0.0) for t in settled)
    tickets = len(settled)
    covers = sum(t.guest_count for t in settled)

    by_payment: dict[str, dict] = {}
    by_hour: dict[int, dict] = {}
    table_rev: dict[str, dict] = {}
    by_waiter: dict[str, dict] = {}
    for t in settled:
        sale = t.sale
        method = sale.payment_method if sale else "cash"
        bucket = by_payment.setdefault(method, {"count": 0, "total": 0.0, "tips": 0.0})
        bucket["count"] += 1
        bucket["total"] += float(t.total_amount)
        bucket["tips"] += float(t.tip_amount or 0.0)

        hour = t.settled_at.hour if t.settled_at else 0
        hb = by_hour.setdefault(hour, {"count": 0, "total": 0.0})
        hb["count"] += 1
        hb["total"] += float(t.total_amount)

        tnum = t.table_number or "Takeaway"
        tb = table_rev.setdefault(tnum, {"count": 0, "total": 0.0, "covers": 0})
        tb["count"] += 1
        tb["total"] += float(t.total_amount)
        tb["covers"] += t.guest_count

        waiter = t.username or "Unknown"
        wb = by_waiter.setdefault(waiter, {"count": 0, "total": 0.0, "tips": 0.0, "covers": 0})
        wb["count"] += 1
        wb["total"] += float(t.total_amount)
        wb["tips"] += float(t.tip_amount or 0.0)
        wb["covers"] += t.guest_count

    item_rows = (
        db.query(
            ProductOut.id,
            func.coalesce(ProductOut.name, "Unknown item"),
            func.sum(RestaurantTicketItem.quantity),
            func.sum(RestaurantTicketItem.quantity * RestaurantTicketItem.unit_price),
        )
        .select_from(RestaurantTicketItem)
        .join(RestaurantTicket, RestaurantTicketItem.ticket_id == RestaurantTicket.id)
        .outerjoin(ProductOut, ProductOut.id == RestaurantTicketItem.product_id)
.filter(RestaurantTicket.status == "settled", RestaurantTicketItem.status != "voided")
    )
    if start:
        item_rows = item_rows.filter(RestaurantTicket.settled_at >= start)
    if end:
        item_rows = item_rows.filter(RestaurantTicket.settled_at <= end)
    item_rows = item_rows.group_by(ProductOut.id, ProductOut.name).order_by(
        func.sum(RestaurantTicketItem.quantity * RestaurantTicketItem.unit_price).desc()
    ).limit(15).all()

    reservations_total = db.query(func.count(RestaurantReservation.id)).scalar() or 0
    reservations_completed = db.query(func.count(RestaurantReservation.id)).filter(
        RestaurantReservation.status == "completed"
    ).scalar() or 0

    return {
        "total_revenue": round(revenue, 2),
        "total_tips": round(tips, 2),
        "ticket_count": tickets,
        "average_ticket": round(revenue / tickets, 2) if tickets else 0.0,
        "total_covers": covers,
        "average_covers_per_ticket": round(covers / tickets, 2) if tickets else 0.0,
        "by_payment_method": [
            {"method": k, "count": v["count"], "total": round(v["total"], 2), "tips": round(v["tips"], 2)}
            for k, v in sorted(by_payment.items(), key=lambda kv: -kv[1]["total"])
        ],
        "by_hour_of_day": [
            {"hour": h, "count": v["count"], "total": round(v["total"], 2)}
            for h, v in sorted(by_hour.items())
        ],
        "top_tables": [
            {"table": k, "count": v["count"], "total": round(v["total"], 2), "covers": v["covers"]}
            for k, v in sorted(table_rev.items(), key=lambda kv: -kv[1]["total"])[:10]
        ],
        "by_waiter": [
            {"waiter": k, "count": v["count"], "total": round(v["total"], 2), "tips": round(v["tips"], 2), "covers": v["covers"]}
            for k, v in sorted(by_waiter.items(), key=lambda kv: -kv[1]["total"])
        ],
        "top_items": [
            {"product_id": r[0], "name": r[1], "quantity_sold": int(r[2] or 0), "revenue": float(r[3] or 0)}
            for r in item_rows
        ],
        "reservations_total": reservations_total,
        "reservations_completed": reservations_completed,
    }


@router.get("/restaurant-daily-trends")
def restaurant_daily_trends(
    start_date: str | None = None,
    end_date: str | None = None,
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
):
    start, end = parse_range(start_date, end_date)
    if start is None:
        start = datetime.now(timezone.utc) - timedelta(days=days - 1)
        start = start.replace(hour=0, minute=0, second=0, microsecond=0)
    if end is None:
        end = datetime.now(timezone.utc)

    rows = db.query(
        func.date(RestaurantTicket.settled_at),
        func.count(RestaurantTicket.id),
        func.coalesce(func.sum(RestaurantTicket.total_amount), 0),
        func.coalesce(func.sum(RestaurantTicket.tip_amount), 0),
        func.coalesce(func.sum(RestaurantTicket.guest_count), 0),
    ).filter(
        RestaurantTicket.status == "settled",
        RestaurantTicket.settled_at >= start,
        RestaurantTicket.settled_at <= end,
    ).group_by(func.date(RestaurantTicket.settled_at)).order_by(func.date(RestaurantTicket.settled_at)).all()

    daily = []
    for day, count, revenue, tips, covers in rows:
        daily.append({
            "date": day,
            "ticket_count": int(count),
            "revenue": round(float(revenue), 2),
            "tips": round(float(tips), 2),
            "covers": int(covers),
        })

    totals = {
        "ticket_count": sum(d["ticket_count"] for d in daily),
        "revenue": round(sum(d["revenue"] for d in daily), 2),
        "tips": round(sum(d["tips"] for d in daily), 2),
        "covers": sum(d["covers"] for d in daily),
    }

    table_rows = db.query(
        RestaurantTable.number,
        func.count(RestaurantTicket.id),
        func.coalesce(func.sum(RestaurantTicket.total_amount), 0),
    ).join(RestaurantTicket, RestaurantTicket.table_id == RestaurantTable.id).filter(
        RestaurantTicket.status == "settled",
        RestaurantTicket.settled_at >= start,
        RestaurantTicket.settled_at <= end,
    ).group_by(RestaurantTable.number).order_by(func.coalesce(func.sum(RestaurantTicket.total_amount), 0).desc()).limit(10).all()

    return {
        "start_date": start.date().isoformat(),
        "end_date": end.date().isoformat(),
        "daily": daily,
        "totals": totals,
        "top_tables": [{"table": r[0], "count": int(r[1]), "total": round(float(r[2]), 2)} for r in table_rows],
    }


def _percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    k = (len(ordered) - 1) * pct
    lo = int(k)
    hi = min(lo + 1, len(ordered) - 1)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (k - lo)


@router.get("/restaurant-turn-times")
def restaurant_turn_times(
    start_date: str | None = None,
    end_date: str | None = None,
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
):
    """Kitchen and table turn times for the settled tickets in the range.

    Item-level numbers come from the sent_at / ready_at / served_at stamps
    recorded while items move through the kitchen; ticket-level dwell time is
    opened_at -> settled_at for the same tickets.
    """
    start, end = parse_range(start_date, end_date)
    if start is None:
        start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    if end is None:
        end = datetime.now(timezone.utc)

    items = (
        db.query(
            RestaurantTicket.id,
            RestaurantTicket.ticket_number,
            RestaurantTable.number.label("table_number"),
            RestaurantTicket.opened_at,
            RestaurantTicket.guest_count,
            RestaurantTicketItem.product_id,
            RestaurantTicketItem.status,
            RestaurantTicketItem.sent_at,
            RestaurantTicketItem.ready_at,
            RestaurantTicketItem.served_at,
        )
        .join(RestaurantTicket, RestaurantTicketItem.ticket_id == RestaurantTicket.id)
        .outerjoin(RestaurantTable, RestaurantTable.id == RestaurantTicket.table_id)
        .filter(
            RestaurantTicket.status == "settled",
            RestaurantTicket.settled_at >= start,
            RestaurantTicket.settled_at <= end,
            RestaurantTicketItem.status != "voided",
            RestaurantTicketItem.sent_at.isnot(None),
        )
        .all()
    )

    product_names = dict(
        db.query(ProductOut.id, ProductOut.name).filter(
            ProductOut.id.in_({r[5] for r in items} or {0})
        ).all()
    )

    prep: list[float] = []
    total: list[float] = []
    slowest: list[dict] = []
    covers_by_hour: dict[int, dict] = {}
    seen_ticket_hour: set[tuple[int, int]] = set()

    for (ticket_id, ticket_number, table_number, opened_at, guest_count, product_id,
         status, sent_at, ready_at, served_at) in items:
        hour = sent_at.hour
        hb = covers_by_hour.setdefault(hour, {"tickets": 0, "covers": 0, "items": 0})
        hb["items"] += 1
        key = (ticket_id, hour)
        if key not in seen_ticket_hour:
            seen_ticket_hour.add(key)
            hb["tickets"] += 1
            hb["covers"] += guest_count or 0
        if ready_at is not None:
            prep_mins = (ready_at - sent_at).total_seconds() / 60.0
            if 0 <= prep_mins < 24 * 60:
                prep.append(prep_mins)
        if served_at is not None:
            mins = (served_at - sent_at).total_seconds() / 60.0
            if 0 <= mins < 24 * 60:
                total.append(mins)
                slowest.append({
                    "ticket_number": ticket_number,
                    "table_number": table_number or "Takeaway",
                    "item": product_names.get(product_id) or f"Item #{product_id}",
                    "minutes": round(mins, 1),
                    "sent_at": sent_at.isoformat(),
                    "status": status,
                })

    settled_tickets = (
        db.query(
            RestaurantTicket.id,
            RestaurantTicket.opened_at,
            RestaurantTicket.settled_at,
        )
        .filter(
            RestaurantTicket.status == "settled",
            RestaurantTicket.settled_at >= start,
            RestaurantTicket.settled_at <= end,
        )
        .all()
    )
    dwell = [
        (r[2] - r[1]).total_seconds() / 60.0
        for r in settled_tickets
        if r[1] is not None and r[2] is not None
    ]
    dwell = [d for d in dwell if 0 <= d < 24 * 60]

    slowest.sort(key=lambda r: -r["minutes"])
    return {
        "start_date": start.date().isoformat(),
        "end_date": end.date().isoformat(),
        "items_measured": len(total),
        "tickets_measured": len(dwell),
        "avg_prep_minutes": round(sum(prep) / len(prep), 1) if prep else 0.0,
        "avg_turn_minutes": round(sum(total) / len(total), 1) if total else 0.0,
        "p90_turn_minutes": round(_percentile(total, 0.9), 1),
        "avg_ticket_dwell_minutes": round(sum(dwell) / len(dwell), 1) if dwell else 0.0,
        "covers_by_hour": [
            {"hour": h, "tickets": v["tickets"], "covers": v["covers"], "items": v["items"]}
            for h, v in sorted(covers_by_hour.items())
        ],
        "slowest_items": slowest[:limit],
    }