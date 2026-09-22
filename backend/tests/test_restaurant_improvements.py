import uuid
from datetime import datetime, timedelta, timezone

from tests.conftest import TestingSessionLocal, client
from tests.test_restaurant import _add_item, _create_menu_product, _create_table, _open_ticket


def _auth(role: str = "admin") -> dict:
    suffix = uuid.uuid4().hex[:8]
    from tests.conftest import create_test_user
    username = f"{role}_{suffix}"
    create_test_user(username, f"{suffix}@{role}.example.com", "testpass123", role=role)
    resp = client.post("/api/auth/login", json={"username": username, "password": "testpass123"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _create_reservation(headers: dict, table_id: int, hours: float = 4.0, name: str = "Guest") -> dict:
    reserved_at = (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()
    resp = client.post("/api/restaurant/reservations", json={
        "table_id": table_id, "guest_name": name, "guest_count": 4,
        "reserved_at": reserved_at, "duration_minutes": 60,
    }, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_required_modifiers_enforced_across_all_groups(auth_headers):
    product = _create_menu_product(auth_headers, f"REQALL{uuid.uuid4().hex[:4]}", qty=10, price=100.0)
    size = client.post(f"/api/restaurant/menu-items/{product['id']}/modifiers", json={
        "name": "Size", "min_select": 1, "max_select": 1, "is_required": True,
        "options": [{"name": "Large", "price_delta": 20.0}],
    }, headers=auth_headers).json()
    temp = client.post(f"/api/restaurant/menu-items/{product['id']}/modifiers", json={
        "name": "Temp", "min_select": 1, "max_select": 1, "is_required": True,
        "options": [{"name": "Hot", "price_delta": 0.0}],
    }, headers=auth_headers).json()
    large = size["options"][0]["id"]
    hot = temp["options"][0]["id"]

    ticket = _open_ticket(auth_headers)

    # Selecting only one of the two required groups must be rejected.
    partial = client.post(f"/api/restaurant/tickets/{ticket['id']}/items", json={
        "product_id": product["id"], "quantity": 1, "modifiers": [{"option_id": large}],
    }, headers=auth_headers)
    assert partial.status_code == 400
    assert "required" in partial.json()["detail"].lower()

    # Fulfilling both required groups succeeds.
    full = client.post(f"/api/restaurant/tickets/{ticket['id']}/items", json={
        "product_id": product["id"], "quantity": 1,
        "modifiers": [{"option_id": large}, {"option_id": hot}],
    }, headers=auth_headers)
    assert full.status_code == 201, full.text
    assert full.json()["items"][0]["unit_price"] == 120.0


def test_reservation_cannot_seat_an_occupied_table(auth_headers):
    table = _create_table(auth_headers)
    reservation = _create_reservation(auth_headers, table["id"], name="Booked")
    # A walk-in already occupies the table.
    _open_ticket(auth_headers, table["id"])

    # Seating the reservation without a table_id must still spot the busy table.
    resp = client.post("/api/restaurant/tickets", json={"reservation_id": reservation["id"]}, headers=auth_headers)
    assert resp.status_code == 400
    assert "open ticket" in resp.json()["detail"].lower()

    # A free table seats cleanly through the reservation.
    other = _create_table(auth_headers, "FREE2")
    reservation2 = _create_reservation(auth_headers, other["id"], name="Walked")
    ok = client.post("/api/restaurant/tickets", json={"reservation_id": reservation2["id"]}, headers=auth_headers)
    assert ok.status_code == 201, ok.text
    assert ok.json()["table_id"] == other["id"]
    assert ok.json()["status"] == "open"
    seated = client.get(f"/api/restaurant/reservations/{reservation2['id']}", headers=auth_headers).json()
    assert seated["status"] == "seated"


def test_seated_reservation_cannot_revert_via_put(auth_headers):
    table = _create_table(auth_headers)
    reservation = _create_reservation(auth_headers, table["id"], hours=3.0)
    ok = client.post(f"/api/restaurant/reservations/{reservation['id']}/status", json={"status": "seated"}, headers=auth_headers)
    assert ok.json()["status"] == "seated"

    # PUT with an unrelated field stays seated; PUT flipping to confirmed is blocked.
    renamed = client.put(f"/api/restaurant/reservations/{reservation['id']}", json={"guest_name": "New Name"}, headers=auth_headers)
    assert renamed.status_code == 200
    assert renamed.json()["guest_name"] == "New Name"

    revert = client.put(f"/api/restaurant/reservations/{reservation['id']}", json={"status": "confirmed"}, headers=auth_headers)
    assert revert.status_code == 400


def test_seated_reservation_completes_on_settle_and_cancel(auth_headers):
    for scenario in ("settle", "cancel"):
        table = _create_table(auth_headers, f"TAB{scenario}")
        reservation = _create_reservation(auth_headers, table["id"], hours=2.0, name=scenario.title())
        ticket = client.post("/api/restaurant/tickets", json={"reservation_id": reservation["id"]}, headers=auth_headers)
        assert ticket.status_code == 201, ticket.text
        product = _create_menu_product(auth_headers, f"FIN{scenario}{uuid.uuid4().hex[:4]}", qty=5, price=80.0)
        _add_item(auth_headers, ticket.json()["id"], product["id"])

        if scenario == "settle":
            r = client.post(f"/api/restaurant/tickets/{ticket.json()['id']}/settle", json={"payment_method": "cash"}, headers=auth_headers)
            assert r.status_code == 200, r.text
        else:
            r = client.post(f"/api/restaurant/tickets/{ticket.json()['id']}/cancel", headers=auth_headers)
            assert r.status_code == 200, r.text

        after = client.get(f"/api/restaurant/reservations/{reservation['id']}", headers=auth_headers).json()
        assert after["status"] == "completed", f"{scenario}: reservation should auto-complete"
        assert after["ticket_id"] == ticket.json()["id"]


def test_tip_recorded_at_settle_and_bill_pdf(auth_headers):
    product = _create_menu_product(auth_headers, f"TIP{uuid.uuid4().hex[:4]}", qty=5, price=100.0)
    ticket = _open_ticket(auth_headers)
    _add_item(auth_headers, ticket["id"], product["id"])

    resp = client.post(f"/api/restaurant/tickets/{ticket['id']}/settle", json={
        "payment_method": "cash", "tip_amount": 50.0,
    }, headers=auth_headers)
    assert resp.status_code == 200, resp.text
    assert float(resp.json()["tip_amount"]) == 50.0

    bill = client.get(f"/api/restaurant/tickets/{ticket['id']}/bill", headers=auth_headers)
    assert bill.status_code == 200
    assert b"%PDF" in bill.content


def test_reservations_day_sheet_pdf(auth_headers):
    table = _create_table(auth_headers)
    token = uuid.uuid4().hex[:8]
    _create_reservation(auth_headers, table["id"], hours=5.0, name=f"Sheet {token}")

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    sheet = client.get("/api/restaurant/reservations/sheet", params={"date": today}, headers=auth_headers)
    assert sheet.status_code == 200
    assert sheet.headers["content-type"] == "application/pdf"
    assert b"%PDF" in sheet.content

    bad = client.get("/api/restaurant/reservations/sheet", params={"date": "not-a-date"}, headers=auth_headers)
    assert bad.status_code == 400


def test_stk_failure_releases_paying_ticket(auth_headers):
    product = _create_menu_product(auth_headers, f"STKFAIL{uuid.uuid4().hex[:4]}", qty=5, price=120.0)
    ticket = _open_ticket(auth_headers)
    _add_item(auth_headers, ticket["id"], product["id"])

    resp = client.post(f"/api/restaurant/tickets/{ticket['id']}/settle", json={
        "payment_method": "mobile_money", "payment_provider": "m-pesa", "payment_phone": "0712345678",
    }, headers=auth_headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "paying"
    sale_id = resp.json()["sale_id"]

    from app.routers.restaurant import fail_ticket_payment
    db = TestingSessionLocal()
    try:
        fail_ticket_payment(db, sale_id, reason="STK failure")
    finally:
        db.close()

    released = client.get(f"/api/restaurant/tickets/{ticket['id']}", headers=auth_headers).json()
    assert released["status"] == "open"
    assert all(i["status"] == "pending" for i in released["items"])


def test_ticket_status_reacts_to_pending_item(auth_headers):
    product = _create_menu_product(auth_headers, f"REACT{uuid.uuid4().hex[:4]}", qty=5, price=50.0)
    ticket = _open_ticket(auth_headers)
    _add_item(auth_headers, ticket["id"], product["id"])
    sent = client.post(f"/api/restaurant/tickets/{ticket['id']}/send", headers=auth_headers)
    assert sent.json()["status"] == "preparing"

    # Adding a new pending item to an otherwise-sent ticket keeps it live (preparing).
    re = client.post(f"/api/restaurant/tickets/{ticket['id']}/items", json={"product_id": product["id"], "quantity": 1}, headers=auth_headers)
    assert re.status_code == 201, re.text
    assert re.json()["status"] == "preparing"


def test_table_list_sorts_naturally(auth_headers):
    tab2 = _create_table(auth_headers, "2")
    tab10 = _create_table(auth_headers, "10")
    _create_table(auth_headers, "Bar 1")
    tables = client.get("/api/restaurant/tables", headers=auth_headers).json()
    idx = {t["id"]: i for i, t in enumerate(tables)}
    assert idx[tab2["id"]] < idx[tab10["id"]]