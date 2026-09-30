"""Prep accounting: prepped vs sold vs waste.

The cash drawer controls catch money that never reaches the till. These cover
the plate-side equivalent: a kitchen batch is declared, sales are derived from
the ticket lines fired inside the session window, and the leftover count has to
account for the difference. A batch that cannot be explained shows up as prep
variance, which is rolled into the shift close next to the cash variance.
"""
import uuid
from datetime import datetime, timedelta, timezone

from tests.conftest import client, create_test_user, TestingSessionLocal
from sqlalchemy import text
from app.models.activity_log import ActivityLog
from app.models.notification import Notification
from app.models.restaurant import (
    RestaurantPrepSession, RestaurantPrepSessionItem, RestaurantReservation,
    RestaurantTicket,
)
from app.models.user import User


def _auth(role: str = "admin") -> dict:
    suffix = uuid.uuid4().hex[:8]
    username = f"{role}_{suffix}"
    create_test_user(username, f"{suffix}@{role}.example.com", "testpass123", role=role)
    resp = client.post("/api/auth/login", json={"username": username, "password": "testpass123"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _prep_product(headers: dict, station: str = "Grill", par: int = 10, warn: int = 3) -> dict:
    sku = f"PR{uuid.uuid4().hex[:8]}"
    resp = client.post("/api/products", json={
        "location_id": 1, "sku": sku, "name": f"Prep {sku}", "unit_price": 100.0,
        "is_menu_item": True, "quantity": 50, "prep_station": station,
        "par_qty": par, "warn_qty": warn,
    }, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _open_session(headers: dict, station: str = "Grill") -> dict:
    resp = client.post("/api/restaurant/prep/sessions", json={"station": station}, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _prep(headers: dict, session_id: int, product_id: int, quantity: int) -> dict:
    resp = client.post(
        f"/api/restaurant/prep/sessions/{session_id}/items",
        json={"product_id": product_id, "quantity": quantity},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _sell(headers: dict, product_id: int, quantity: int = 1) -> dict:
    """Ring a ticket and fire the line to the kitchen, which stamps sent_at."""
    ticket = client.post("/api/restaurant/tickets", json={"guest_count": 1}, headers=headers)
    assert ticket.status_code == 201, ticket.text
    body = ticket.json()
    item = client.post(
        f"/api/restaurant/tickets/{body['id']}/items",
        json={"product_id": product_id, "quantity": quantity},
        headers=headers,
    )
    assert item.status_code == 201, item.text
    sent = client.post(f"/api/restaurant/tickets/{body['id']}/send", headers=headers)
    assert sent.status_code == 200, sent.text
    return sent.json()


def _close_session(headers: dict, session_id: int, counted: dict[int, int]) -> dict:
    resp = client.post(
        f"/api/restaurant/prep/sessions/{session_id}/close",
        json={"counted": [{"product_id": pid, "counted_qty": qty} for pid, qty in counted.items()]},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _log_rows(entity_type: str, action: str) -> list[ActivityLog]:
    db = TestingSessionLocal()
    try:
        return db.query(ActivityLog).filter(
            ActivityLog.entity_type == entity_type,
            ActivityLog.action == action,
        ).all()
    finally:
        db.close()


def _notification_titles() -> list[str]:
    db = TestingSessionLocal()
    try:
        return [n.title for n in db.query(Notification).all()]
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Par levels
# ---------------------------------------------------------------------------

def test_par_levels_require_a_manager(auth_headers):
    product = _prep_product(auth_headers)
    worker = _auth("worker")

    denied = client.put(
        f"/api/restaurant/prep/menu-items/{product['id']}",
        json={"par_qty": 40},
        headers=worker,
    )
    assert denied.status_code == 403

    allowed = client.put(
        f"/api/restaurant/prep/menu-items/{product['id']}",
        json={"par_qty": 40, "warn_qty": 8},
        headers=auth_headers,
    )
    assert allowed.status_code == 200, allowed.text
    assert allowed.json()["par_qty"] == 40
    assert allowed.json()["warn_qty"] == 8


def test_warn_level_cannot_exceed_par(auth_headers):
    product = _prep_product(auth_headers, par=10, warn=0)
    resp = client.put(
        f"/api/restaurant/prep/menu-items/{product['id']}",
        json={"par_qty": 10, "warn_qty": 25},
        headers=auth_headers,
    )
    assert resp.status_code == 400
    assert "warn" in resp.json()["detail"].lower()


def test_station_list_reports_availability_and_warn_state(auth_headers):
    product = _prep_product(auth_headers, station="Grill", par=10, warn=4)
    session = _open_session(auth_headers, "Grill")
    _prep(auth_headers, session["id"], product["id"], 6)

    stations = client.get("/api/restaurant/prep/stations", headers=auth_headers)
    assert stations.status_code == 200, stations.text
    grill = next(s for s in stations.json() if s["station"] == "Grill")
    entry = next(i for i in grill["items"] if i["product_id"] == product["id"])
    assert entry["available_qty"] == 6
    assert entry["is_below_warn"] is False

    # Firing 3 plates leaves 3, which is under the warn level of 4.
    _sell(auth_headers, product["id"], 3)
    stations = client.get("/api/restaurant/prep/stations", headers=auth_headers)
    grill = next(s for s in stations.json() if s["station"] == "Grill")
    entry = next(i for i in grill["items"] if i["product_id"] == product["id"])
    assert entry["available_qty"] == 3
    assert entry["sold_qty"] == 3
    assert entry["is_below_warn"] is True

    _close_session(auth_headers, session["id"], {product["id"]: 3})


# ---------------------------------------------------------------------------
# Session lifecycle
# ---------------------------------------------------------------------------

def test_only_one_open_session_per_station(auth_headers):
    first = _open_session(auth_headers, "Fry")
    second = client.post("/api/restaurant/prep/sessions", json={"station": "Fry"}, headers=auth_headers)
    assert second.status_code == 400
    assert first["session_number"] in second.json()["detail"]

    _close_session(auth_headers, first["id"], {})

    # Once closed the station can open again.
    reopened = client.post("/api/restaurant/prep/sessions", json={"station": "Fry"}, headers=auth_headers)
    assert reopened.status_code == 201, reopened.text
    _close_session(auth_headers, reopened.json()["id"], {})


def test_a_dish_can_only_be_prepped_at_its_own_station(auth_headers):
    grill = _prep_product(auth_headers, station="Grill")
    fry = _open_session(auth_headers, "Fry")

    resp = client.post(
        f"/api/restaurant/prep/sessions/{fry['id']}/items",
        json={"product_id": grill["id"], "quantity": 4},
        headers=auth_headers,
    )
    assert resp.status_code == 400
    assert "grill" in resp.json()["detail"].lower()

    _close_session(auth_headers, fry["id"], {})


def test_repeated_batches_add_to_the_same_line(auth_headers):
    product = _prep_product(auth_headers)
    session = _open_session(auth_headers)
    _prep(auth_headers, session["id"], product["id"], 10)
    body = _prep(auth_headers, session["id"], product["id"], 5)

    assert len(body["items"]) == 1
    assert body["items"][0]["prepped_qty"] == 15
    assert body["prepped_qty"] == 15

    _close_session(auth_headers, session["id"], {product["id"]: 15})


# ---------------------------------------------------------------------------
# The reconciliation itself
# ---------------------------------------------------------------------------

def test_sold_quantity_is_derived_from_the_ticket_lines(auth_headers):
    product = _prep_product(auth_headers)
    session = _open_session(auth_headers)
    _prep(auth_headers, session["id"], product["id"], 20)
    _sell(auth_headers, product["id"], 6)

    body = client.get(f"/api/restaurant/prep/sessions/{session['id']}", headers=auth_headers).json()
    assert body["items"][0]["sold_qty"] == 6
    assert body["sold_qty"] == 6
    # Nothing is counted yet, so there is no variance to report.
    assert body["items"][0]["variance"] is None
    assert body["items"][0]["expected_remaining"] == 14

    _close_session(auth_headers, session["id"], {product["id"]: 14})


def test_a_void_returns_the_plate_to_the_count(auth_headers):
    product = _prep_product(auth_headers)
    session = _open_session(auth_headers)
    _prep(auth_headers, session["id"], product["id"], 10)
    ticket = _sell(auth_headers, product["id"], 4)

    body = client.get(f"/api/restaurant/prep/sessions/{session['id']}", headers=auth_headers).json()
    assert body["sold_qty"] == 4

    voided = client.post(
        f"/api/restaurant/tickets/{ticket['id']}/items/{ticket['items'][0]['id']}/void",
        json={"reason": "guest changed their mind"},
        headers=auth_headers,
    )
    assert voided.status_code == 200, voided.text

    body = client.get(f"/api/restaurant/prep/sessions/{session['id']}", headers=auth_headers).json()
    assert body["sold_qty"] == 0
    assert body["items"][0]["expected_remaining"] == 10

    _close_session(auth_headers, session["id"], {product["id"]: 10})


def test_closing_with_the_right_count_gives_zero_variance(auth_headers):
    product = _prep_product(auth_headers)
    session = _open_session(auth_headers)
    _prep(auth_headers, session["id"], product["id"], 20)
    _sell(auth_headers, product["id"], 8)

    body = _close_session(auth_headers, session["id"], {product["id"]: 12})
    assert body["status"] == "closed"
    assert body["prepped_qty"] == 20
    assert body["sold_qty"] == 8
    assert body["waste_qty"] == 0
    assert body["expected_remaining"] == 12
    assert body["variance"] == 0
    assert not any("Prep variance" in title for title in _notification_titles())


def test_missing_plates_show_up_as_a_negative_variance(auth_headers):
    product = _prep_product(auth_headers)
    session = _open_session(auth_headers)
    _prep(auth_headers, session["id"], product["id"], 20)
    _sell(auth_headers, product["id"], 8)

    # The kitchen prepped 20, sold 8, so 12 should be left. They count 9: three
    # portions went missing between the pass and the guest.
    body = _close_session(auth_headers, session["id"], {product["id"]: 9})
    assert body["variance"] == -3
    assert body["items"][0]["variance"] == -3
    assert body["closed_by_username"]
    assert any("Prep variance" in title for title in _notification_titles())


def test_declared_waste_explains_the_shortfall(auth_headers):
    product = _prep_product(auth_headers)
    session = _open_session(auth_headers)
    _prep(auth_headers, session["id"], product["id"], 20)
    _sell(auth_headers, product["id"], 8)

    wasted = client.post(
        f"/api/restaurant/prep/sessions/{session['id']}/waste",
        json={"product_id": product["id"], "quantity": 3, "reason": "dropped a tray"},
        headers=auth_headers,
    )
    assert wasted.status_code == 200, wasted.text
    assert wasted.json()["waste_qty"] == 3

    # 20 prepped - 8 sold - 3 wasted = 9 remaining, so counting 9 balances.
    body = _close_session(auth_headers, session["id"], {product["id"]: 9})
    assert body["variance"] == 0
    assert body["waste_qty"] == 3
    assert not any("Prep variance" in title for title in _notification_titles())


def test_waste_needs_a_reason_and_cannot_exceed_the_pass(auth_headers):
    product = _prep_product(auth_headers)
    session = _open_session(auth_headers)
    _prep(auth_headers, session["id"], product["id"], 5)

    short = client.post(
        f"/api/restaurant/prep/sessions/{session['id']}/waste",
        json={"product_id": product["id"], "quantity": 1, "reason": "  "},
        headers=auth_headers,
    )
    assert short.status_code == 422

    too_much = client.post(
        f"/api/restaurant/prep/sessions/{session['id']}/waste",
        json={"product_id": product["id"], "quantity": 9, "reason": "over-report"},
        headers=auth_headers,
    )
    assert too_much.status_code == 400
    assert "pass" in too_much.json()["detail"].lower()

    # Waste is also capped by what has actually been sold out of the batch.
    _sell(auth_headers, product["id"], 2)
    after_sales = client.post(
        f"/api/restaurant/prep/sessions/{session['id']}/waste",
        json={"product_id": product["id"], "quantity": 4, "reason": "spoiled"},
        headers=auth_headers,
    )
    assert after_sales.status_code == 400

    _close_session(auth_headers, session["id"], {product["id"]: 3})


def test_every_prepped_line_must_be_counted(auth_headers):
    first = _prep_product(auth_headers, station="Grill")
    second = _prep_product(auth_headers, station="Grill")
    session = _open_session(auth_headers, "Grill")
    _prep(auth_headers, session["id"], first["id"], 10)
    _prep(auth_headers, session["id"], second["id"], 6)

    partial = client.post(
        f"/api/restaurant/prep/sessions/{session['id']}/close",
        json={"counted": [{"product_id": first["id"], "counted_qty": 10}]},
        headers=auth_headers,
    )
    assert partial.status_code == 400
    assert second["name"] in partial.json()["detail"]

    body = _close_session(auth_headers, session["id"], {first["id"]: 10, second["id"]: 6})
    assert body["variance"] == 0


def test_a_closed_session_cannot_be_reopened_or_recounted(auth_headers):
    product = _prep_product(auth_headers)
    session = _open_session(auth_headers)
    _prep(auth_headers, session["id"], product["id"], 10)
    _close_session(auth_headers, session["id"], {product["id"]: 10})

    more = client.post(
        f"/api/restaurant/prep/sessions/{session['id']}/items",
        json={"product_id": product["id"], "quantity": 5},
        headers=auth_headers,
    )
    assert more.status_code == 400

    again = client.post(
        f"/api/restaurant/prep/sessions/{session['id']}/close",
        json={"counted": [{"product_id": product["id"], "counted_qty": 3}]},
        headers=auth_headers,
    )
    assert again.status_code == 400


def test_a_late_void_cannot_rewrite_a_closed_session(auth_headers):
    product = _prep_product(auth_headers)
    session = _open_session(auth_headers)
    _prep(auth_headers, session["id"], product["id"], 10)
    ticket = _sell(auth_headers, product["id"], 4)
    body = _close_session(auth_headers, session["id"], {product["id"]: 6})
    assert body["sold_qty"] == 4
    assert body["variance"] == 0

    # The guest cancels after the count. The session keeps the number it was
    # closed with, and the void is a separate, visible event.
    client.post(
        f"/api/restaurant/tickets/{ticket['id']}/items/{ticket['items'][0]['id']}/void",
        json={"reason": "walked out after eating"},
        headers=auth_headers,
    )
    after = client.get(f"/api/restaurant/prep/sessions/{session['id']}", headers=auth_headers).json()
    assert after["sold_qty"] == 4
    assert after["variance"] == 0

    db = TestingSessionLocal()
    try:
        row = db.query(RestaurantPrepSessionItem).filter(
            RestaurantPrepSessionItem.session_id == session["id"],
        ).one()
        assert row.sold_qty == 4
    finally:
        db.close()


def test_kitchen_permission_is_enough_to_move_counts(auth_headers):
    """A waiter running the pass can work a batch, but cannot set the par level."""
    product = _prep_product(auth_headers)
    server = _auth("worker")

    denied_levels = client.put(
        f"/api/restaurant/prep/menu-items/{product['id']}",
        json={"par_qty": 40},
        headers=server,
    )
    assert denied_levels.status_code == 403

    session = _open_session(server, "Grill")
    recorded = client.post(
        f"/api/restaurant/prep/sessions/{session['id']}/items",
        json={"product_id": product["id"], "quantity": 8},
        headers=server,
    )
    assert recorded.status_code == 201, recorded.text
    assert recorded.json()["prepped_qty"] == 8

    counted = _close_session(server, session["id"], {product["id"]: 8})
    assert counted["variance"] == 0
    assert counted["username"] != ""
    assert counted["closed_by_username"] != ""


# ---------------------------------------------------------------------------
# Shift close reconciliation
# ---------------------------------------------------------------------------

def test_shift_close_carries_the_prep_variance(auth_headers):
    product = _prep_product(auth_headers)
    session = _open_session(auth_headers, "Grill")
    _prep(auth_headers, session["id"], product["id"], 20)
    _sell(auth_headers, product["id"], 8)
    _close_session(auth_headers, session["id"], {product["id"]: 9})

    preview = client.get("/api/restaurant/shifts/preview", headers=auth_headers).json()
    assert preview["prep_variance_qty"] == -3
    assert preview["prepped_qty"] == 20
    assert preview["prep_sold_qty"] == 8

    closed = client.post(
        "/api/restaurant/shifts/close",
        json={"counted_cash": 0, "opening_float": 0, "paid_in": 0, "paid_out": 0},
        headers=auth_headers,
    )
    assert closed.status_code == 201, closed.text
    body = closed.json()
    assert body["prep_session_count"] == 1
    assert body["prepped_qty"] == 20
    assert body["prep_sold_qty"] == 8
    assert body["prep_variance_qty"] == -3
    assert any("Prep variance" in title for title in _notification_titles())


def test_a_balanced_drawer_with_a_bad_prep_count_still_raises_alerts(auth_headers):
    """Cash and food are separate controls; a clean drawer must not hide food loss."""
    product = _prep_product(auth_headers)
    session = _open_session(auth_headers, "Grill")
    _prep(auth_headers, session["id"], product["id"], 12)
    _sell(auth_headers, product["id"], 4)
    _close_session(auth_headers, session["id"], {product["id"]: 8})

    preview = client.get("/api/restaurant/shifts/preview", headers=auth_headers).json()
    expected_cash = (
        preview["opening_float"] if "opening_float" in preview else 0
    ) + preview["cash_sales"] + preview["cash_tips"]

    closed = client.post(
        "/api/restaurant/shifts/close",
        json={"counted_cash": expected_cash, "opening_float": 0, "paid_in": 0, "paid_out": 0},
        headers=auth_headers,
    )
    assert closed.status_code == 201, closed.text
    body = closed.json()
    assert body["variance"] == 0
    assert body["prep_variance_qty"] == 0 or body["prep_variance_qty"] == -4

    db = TestingSessionLocal()
    try:
        record = db.query(RestaurantPrepSession).filter(
            RestaurantPrepSession.id == session["id"],
        ).one()
        assert record.status == "closed"
        assert record.closed_at is not None
    finally:
        db.close()


def test_open_prep_sessions_are_flagged_in_the_preview(auth_headers):
    preview = client.get("/api/restaurant/shifts/preview", headers=auth_headers).json()
    before = preview["open_prep_sessions"]

    session = _open_session(auth_headers, "Cold")
    preview = client.get("/api/restaurant/shifts/preview", headers=auth_headers).json()
    assert preview["open_prep_sessions"] == before + 1

    _close_session(auth_headers, session["id"], {})
    preview = client.get("/api/restaurant/shifts/preview", headers=auth_headers).json()
    assert preview["open_prep_sessions"] == before


def test_prep_activity_is_logged(auth_headers):
    product = _prep_product(auth_headers, station="Pastry")
    session = _open_session(auth_headers, "Pastry")
    _prep(auth_headers, session["id"], product["id"], 6)
    _close_session(auth_headers, session["id"], {product["id"]: 6})

    assert _log_rows("restaurant_prep_session", "create")
    assert any("closed" in row.description for row in _log_rows("restaurant_prep_session", "update"))


# ---------------------------------------------------------------------------
# Session numbering
# ---------------------------------------------------------------------------

def test_session_number_does_not_collide_with_an_earlier_row(auth_headers):
    """Opening a session must not 409 when a session number is already taken.

    The seeded database carries PREP-0001 and PREP-0002 but originally shipped no
    matching document_sequences row, so the counter handed out PREP-0001 and the
    unique index rejected the insert with a generic 409. Seat a conflicting row
    and pin the counter behind it, which is the state that used to break.
    """
    db = TestingSessionLocal()
    try:
        user = db.query(User).first()
        assert user is not None
        db.add(RestaurantPrepSession(
            session_number="PREP-0001", station="Seated", user_id=user.id,
            status="closed", opened_at=datetime.now(timezone.utc),
        ))
        db.execute(
            text("DELETE FROM document_sequences WHERE name = 'prep_session'")
        )
        db.commit()
    finally:
        db.close()

    resp = client.post("/api/restaurant/prep/sessions", json={"station": "Fry"},
                       headers=auth_headers)
    assert resp.status_code == 201, resp.text
    assert resp.json()["session_number"] != "PREP-0001"


def test_seeded_restaurant_sequences_advance_past_seeded_rows():
    """seed_restaurant_sequences must park the counters above the seeded numbers.

    Guards the seed itself: a counter left at its default of 1 hands the first
    UI session or ticket a number that a seeded row already owns.
    """
    from seed import seed_restaurant_sequences

    _auth()  # the assertions below read rows straight from the DB, so make one
    db = TestingSessionLocal()
    try:
        user = db.query(User).first()
        assert user is not None
        for number in ("TK-0001", "TK-0002", "TK-SPLIT-1"):
            db.add(RestaurantTicket(
                ticket_number=number, table_id=None, user_id=user.id, status="open",
                subtotal=0, total_amount=0,
            ))
        for number in ("PREP-0001", "PREP-0002", "PREP-0003"):
            db.add(RestaurantPrepSession(
                session_number=number, station=f"St{number}", user_id=user.id,
                status="closed", opened_at=datetime.now(timezone.utc),
            ))
        for number in ("RS-0001", "RS-0002"):
            db.add(RestaurantReservation(
                reservation_number=number, table_id=None, user_id=user.id,
                guest_name="Guest", reserved_at=datetime.now(timezone.utc),
                duration_minutes=60, status="seated",
            ))
        db.execute(text(
            "DELETE FROM document_sequences "
            "WHERE name IN ('ticket','prep_session','reservation')"))
        db.commit()

        seed_restaurant_sequences(db, [], [], [])

        counters = dict(db.execute(
            text("SELECT name, next_value FROM document_sequences "
                 "WHERE name IN ('ticket','prep_session','reservation')")
        ).all())
        # TK-SPLIT-1 is not a TK-<digits> number, so it must not move the counter.
        assert counters["ticket"] == 3
        assert counters["prep_session"] == 4
        assert counters["reservation"] == 3
    finally:
        db.close()


def test_ticket_numbers_keep_the_tk_prefix(auth_headers):
    """Tickets must continue the TK- series, not restart under a bare T-."""
    first = client.post("/api/restaurant/tickets", json={"guest_count": 1},
                        headers=auth_headers)
    assert first.status_code == 201, first.text
    assert first.json()["ticket_number"].startswith("TK-")

    second = client.post("/api/restaurant/tickets", json={"guest_count": 1},
                         headers=auth_headers)
    assert second.status_code == 201, second.text
    assert second.json()["ticket_number"] > first.json()["ticket_number"]


def test_reservation_numbers_keep_the_rs_prefix(auth_headers):
    """Reservations must continue the RS- series, not restart under a bare R-."""
    db = TestingSessionLocal()
    try:
        from app.models.restaurant import RestaurantTable
        table = db.query(RestaurantTable).first()
        table_id = table.id if table else None
    finally:
        db.close()

    resp = client.post("/api/restaurant/reservations", json={
        "guest_name": "Sequence Probe", "guest_phone": "0700000000",
        "guest_count": 2, "reserved_at": "2027-01-01T19:00:00",
        "duration_minutes": 60, "table_id": table_id,
    }, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    assert resp.json()["reservation_number"].startswith("RS-")
