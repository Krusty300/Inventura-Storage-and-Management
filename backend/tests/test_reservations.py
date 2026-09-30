import uuid
from datetime import datetime, timedelta, timezone

from tests.conftest import client, create_test_user


def _auth(role: str = "admin") -> dict:
    suffix = uuid.uuid4().hex[:8]
    username = f"{role}_{suffix}"
    create_test_user(username, f"{suffix}@{role}.example.com", "testpass123", role=role)
    resp = client.post("/api/auth/login", json={"username": username, "password": "testpass123"})
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _create_table(headers: dict, number: str = "R1", capacity: int = 4) -> dict:
    resp = client.post("/api/restaurant/tables", json={"number": number, "capacity": capacity}, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _create_reservation(headers: dict, table_id: int, hours: float = 2.0, name: str = "Alice") -> dict:
    reserved_at = (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()
    resp = client.post("/api/restaurant/reservations", json={
        "table_id": table_id, "guest_name": name, "guest_phone": "0712000000",
        "guest_count": 4, "reserved_at": reserved_at, "duration_minutes": 90,
    }, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_reservations_require_restaurant_permissions():
    resp = client.get("/api/restaurant/reservations", headers=_auth("supplier"))
    assert resp.status_code == 403


def test_create_and_list_reservation(auth_headers):
    table = _create_table(auth_headers)
    reservation = _create_reservation(auth_headers, table["id"])
    assert reservation["status"] == "pending"
    # "RS-" is the series already on the books. Asserting the full prefix keeps
    # this honest: "R-" also passes startswith("R-"), which hid a real bug where
    # new reservations were numbered R-0001 against seeded RS-0001 rows.
    assert reservation["reservation_number"].startswith("RS-")
    assert reservation["table_number"] == table["number"]
    assert reservation["guest_name"] == "Alice"

    # Validation: blank guest name rejected, missing/invalid date rejected.
    bad = client.post("/api/restaurant/reservations", json={"guest_name": "  ", "reserved_at": "not-a-date"}, headers=auth_headers)
    assert bad.status_code == 422

    items = client.get("/api/restaurant/reservations", headers=auth_headers).json()
    assert items["total"] >= 1
    assert any(r["id"] == reservation["id"] for r in items["items"])

    # Filter by table and status.
    by_table = client.get("/api/restaurant/reservations", params={"table_id": table["id"], "status": "pending"}, headers=auth_headers).json()
    assert by_table["total"] == 1


def test_overlapping_reservations_rejected(auth_headers):
    table = _create_table(auth_headers)
    _create_reservation(auth_headers, table["id"], hours=2.0, name="Alice")
    # Same table, overlapping window -> error.
    conflict = client.post("/api/restaurant/reservations", json={
        "table_id": table["id"], "guest_name": "Bob",
        "reserved_at": (datetime.now(timezone.utc) + timedelta(hours=2, minutes=20)).isoformat(),
        "duration_minutes": 120,
    }, headers=auth_headers)
    assert conflict.status_code == 400
    assert "already" in conflict.json()["detail"].lower()

    # Non-overlapping window on the same table is fine.
    ok = client.post("/api/restaurant/reservations", json={
        "table_id": table["id"], "guest_name": "Carol",
        "reserved_at": (datetime.now(timezone.utc) + timedelta(hours=6)).isoformat(),
        "duration_minutes": 60,
    }, headers=auth_headers)
    assert ok.status_code == 201

    # A different table never conflicts.
    other_table = _create_table(auth_headers, "R2")
    ok2 = client.post("/api/restaurant/reservations", json={
        "table_id": other_table["id"], "guest_name": "Dave",
        "reserved_at": (datetime.now(timezone.utc) + timedelta(hours=2, minutes=20)).isoformat(),
        "duration_minutes": 120,
    }, headers=auth_headers)
    assert ok2.status_code == 201


def test_reservation_status_lifecycle(auth_headers):
    table = _create_table(auth_headers)
    reservation = _create_reservation(auth_headers, table["id"])

    # Confirm -> seated.
    confirmed = client.post(f"/api/restaurant/reservations/{reservation['id']}/status", json={"status": "confirmed"}, headers=auth_headers)
    assert confirmed.status_code == 200
    seated = client.post(f"/api/restaurant/reservations/{reservation['id']}/status", json={"status": "seated"}, headers=auth_headers)
    assert seated.json()["status"] == "seated"

    # Seated can only be cancelled, not moved back.
    bad = client.post(f"/api/restaurant/reservations/{reservation['id']}/status", json={"status": "pending"}, headers=auth_headers)
    assert bad.status_code == 400

    cancelled = client.post(f"/api/restaurant/reservations/{reservation['id']}/status", json={"status": "cancelled"}, headers=auth_headers)
    assert cancelled.json()["status"] == "cancelled"

    # Terminal reservations reject further changes.
    closed = client.post(f"/api/restaurant/reservations/{reservation['id']}/status", json={"status": "confirmed"}, headers=auth_headers)
    assert closed.status_code == 400

    # Invalid status rejected.
    invalid = client.post(f"/api/restaurant/reservations/{reservation['id']}/status", json={"status": "flagged"}, headers=auth_headers)
    assert invalid.status_code == 400


def test_edit_reservation_and_no_show(auth_headers):
    table = _create_table(auth_headers)
    reservation = _create_reservation(auth_headers, table["id"], hours=3.0)

    updated = client.put(f"/api/restaurant/reservations/{reservation['id']}", json={
        "guest_name": "Alicia", "guest_count": 6, "status": "confirmed",
        "reserved_at": (datetime.now(timezone.utc) + timedelta(hours=4)).isoformat(),
    }, headers=auth_headers)
    assert updated.status_code == 200, updated.text
    assert updated.json()["guest_name"] == "Alicia"
    assert updated.json()["guest_count"] == 6
    assert updated.json()["status"] == "confirmed"

    # Editing an editable reservation to conflict is rejected.
    other = _create_reservation(auth_headers, table["id"], hours=8.0, name="Zed")
    conflict = client.put(f"/api/restaurant/reservations/{other['id']}", json={
        "reserved_at": (datetime.now(timezone.utc) + timedelta(hours=4)).isoformat(),
    }, headers=auth_headers)
    assert conflict.status_code == 400

    no_show = client.post(f"/api/restaurant/reservations/{other['id']}/status", json={"status": "no_show"}, headers=auth_headers)
    assert no_show.json()["status"] == "no_show"


def test_delete_reservation(auth_headers):
    table = _create_table(auth_headers)
    reservation = _create_reservation(auth_headers, table["id"])
    resp = client.delete(f"/api/restaurant/reservations/{reservation['id']}", headers=auth_headers)
    assert resp.status_code == 200
    gone = client.get(f"/api/restaurant/reservations/{reservation['id']}", headers=auth_headers)
    assert gone.status_code == 404


def test_ticket_can_seat_a_reservation(auth_headers):
    table = _create_table(auth_headers)
    reservation = _create_reservation(auth_headers, table["id"], hours=1.0, name="Grace")

    ticket = client.post("/api/restaurant/tickets", json={
        "table_id": table["id"], "reservation_id": reservation["id"], "guest_count": 2,
    }, headers=auth_headers)
    assert ticket.status_code == 201, ticket.text
    assert ticket.json()["customer_name"] == "Grace"  # inherited from reservation

    seated = client.get(f"/api/restaurant/reservations/{reservation['id']}", headers=auth_headers).json()
    assert seated["status"] == "seated"
    assert seated["ticket_id"] == ticket.json()["id"]

    # A ticket cannot repurpose an already-seated reservation.
    closed_ticket = client.post("/api/restaurant/tickets", json={
        "table_id": _create_table(auth_headers, "R9")["id"],
        "reservation_id": reservation["id"],
    }, headers=auth_headers)
    assert closed_ticket.status_code == 400


def test_table_positions_round_trip(auth_headers):
    table = _create_table(auth_headers, "POS1")
    moved = client.put(f"/api/restaurant/tables/{table['id']}", json={"pos_x": 240, "pos_y": 120}, headers=auth_headers)
    assert moved.status_code == 200
    assert moved.json()["pos_x"] == 240
    assert moved.json()["pos_y"] == 120

    tables = client.get("/api/restaurant/tables", headers=auth_headers).json()
    assert next(t for t in tables if t["id"] == table["id"])["pos_x"] == 240

    # Positions are optional on create.
    created = _create_table(auth_headers, "POS2")
    assert created["pos_x"] == 0
    assert created["pos_y"] == 0