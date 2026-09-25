"""Dine-in attribution: tickets carry a contact phone that settlement uses to
link the resulting ``Sale`` to a ``Customer`` and to pick the restaurant sales
channel (dine-in vs guest QR order)."""
import uuid
from datetime import datetime, timezone

from tests.conftest import client, create_test_user
from tests.test_restaurant import _add_item, _create_menu_product, _create_table, _open_ticket


def _auth(role: str = "admin") -> dict:
    suffix = uuid.uuid4().hex[:8]
    username = f"{role}_{suffix}"
    create_test_user(username, f"{suffix}@{role}.example.com", "testpass123", role=role)
    resp = client.post("/api/auth/login", json={"username": username, "password": "testpass123"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _make_customer(headers: dict, name: str, phone: str = "") -> dict:
    resp = client.post("/api/customers", json={"name": name, "phone": phone}, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_settle_creates_customer_from_phone_and_uses_dine_in_channel(auth_headers):
    product = _create_menu_product(auth_headers, "ATTRCUST", qty=5, price=100.0)
    ticket = client.post("/api/restaurant/tickets", json={
        "guest_count": 2, "customer_name": "Jane Doe", "customer_phone": "0712345678",
    }, headers=auth_headers)
    assert ticket.status_code == 201, ticket.text
    assert ticket.json()["customer_phone"] == "0712345678"
    _add_item(auth_headers, ticket.json()["id"], product["id"], quantity=1)

    resp = client.post(f"/api/restaurant/tickets/{ticket.json()['id']}/settle",
                       json={"payment_method": "cash", "customer_phone": "0755778899"}, headers=auth_headers)
    assert resp.status_code == 200, resp.text
    sale_id = resp.json()["sale_id"]

    sale = client.get(f"/api/sales/{sale_id}", headers=auth_headers).json()
    assert sale["customer_id"] is not None
    assert sale["customer_name"] == "Jane Doe"
    assert sale["channel_id"] is not None
    assert sale["channel_name"] == "Restaurant (Dine-in)"

    customers = client.get("/api/customers", params={"search": "Jane Doe"}, headers=auth_headers).json()
    created = next((c for c in customers["items"] if c["name"] == "Jane Doe"), None)
    assert created is not None
    assert created["phone"] == "254755778899"


def test_settle_links_existing_customer_by_phone(auth_headers):
    existing = _make_customer(auth_headers, "Existing Diner", phone="0712345678")
    product = _create_menu_product(auth_headers, "ATTRLINK", qty=5, price=50.0)
    ticket = _open_ticket(auth_headers)
    _add_item(auth_headers, ticket["id"], product["id"], quantity=1)

    # Stored phone is "0712345678"; settlement normalizes "254712345678" and
    # falls back to the trailing digits, so both forms link the same customer.
    resp = client.post(f"/api/restaurant/tickets/{ticket['id']}/settle", json={
        "payment_method": "cash", "payment_phone": "254712345678",
    }, headers=auth_headers)
    assert resp.status_code == 200, resp.text
    sale = client.get(f"/api/sales/{resp.json()['sale_id']}", headers=auth_headers).json()
    assert sale["customer_id"] == existing["id"]

    # Re-settling a new phone digit-setter must not duplicate the customer.
    customers = client.get("/api/customers", params={"search": "Existing Diner"}, headers=auth_headers).json()
    assert len(customers["items"]) == 1


def test_settle_without_phone_keeps_customer_null_but_sets_channel(auth_headers):
    product = _create_menu_product(auth_headers, "ATTRNONE", qty=5, price=25.0)
    ticket = _open_ticket(auth_headers)
    _add_item(auth_headers, ticket["id"], product["id"], quantity=1)

    resp = client.post(f"/api/restaurant/tickets/{ticket['id']}/settle", json={"payment_method": "cash"}, headers=auth_headers)
    assert resp.status_code == 200, resp.text
    sale = client.get(f"/api/sales/{resp.json()['sale_id']}", headers=auth_headers).json()
    assert sale["customer_id"] is None
    assert sale["channel_name"] == "Restaurant (Dine-in)"


def test_guest_order_captures_phone_and_settles_via_guest_channel(auth_headers):
    table = _create_table(auth_headers, number="G1")
    product = _create_menu_product(auth_headers, "ATTRGUEST", qty=5, price=80.0)

    # Public guest order (no auth) submits a contact phone.
    resp = client.post("/api/restaurant/public/orders", json={
        "table_id": table["id"], "guest_name": "Guest You", "guest_phone": "0799887766",
        "items": [{"product_id": product["id"], "quantity": 2}],
    })
    assert resp.status_code == 201, resp.text
    guest = resp.json()
    assert guest["guest_name"] == "Guest You"
    assert guest["guest_phone"] == "0799887766"

    # The staff ticket carries the phone, and settlement attributes + channels it.
    ticket = client.get(f"/api/restaurant/tickets/{guest['id']}", headers=auth_headers).json()
    assert ticket["customer_phone"] == "0799887766"

    resp = client.post(f"/api/restaurant/tickets/{guest['id']}/settle", json={"payment_method": "cash"}, headers=auth_headers)
    assert resp.status_code == 200, resp.text
    sale = client.get(f"/api/sales/{resp.json()['sale_id']}", headers=auth_headers).json()
    assert sale["customer_id"] is not None
    assert sale["customer_name"] == "Guest You"
    assert sale["channel_name"] == "Restaurant (Guest Order)"


def test_reservation_ticket_inherits_guest_phone(auth_headers):
    table = _create_table(auth_headers, number="G2")
    when = datetime.now(timezone.utc).isoformat()
    resp = client.post("/api/restaurant/reservations", json={
        "table_id": table["id"], "guest_name": "Reserved Guest", "guest_phone": "0733221100",
        "guest_count": 3, "reserved_at": when,
    }, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    reservation = resp.json()

    product = _create_menu_product(auth_headers, "ATTRRESV", qty=5, price=60.0)
    ticket = client.post("/api/restaurant/tickets", json={
        "reservation_id": reservation["id"], "guest_count": 3,
    }, headers=auth_headers)
    assert ticket.status_code == 201, ticket.text
    assert ticket.json()["customer_name"] == "Reserved Guest"
    assert ticket.json()["customer_phone"] == "0733221100"
    _add_item(auth_headers, ticket.json()["id"], product["id"], quantity=1)

    resp = client.post(f"/api/restaurant/tickets/{ticket.json()['id']}/settle", json={"payment_method": "cash"}, headers=auth_headers)
    assert resp.status_code == 200, resp.text
    sale = client.get(f"/api/sales/{resp.json()['sale_id']}", headers=auth_headers).json()
    assert sale["customer_id"] is not None
    assert sale["customer_name"] == "Reserved Guest"
    assert sale["channel_name"] == "Restaurant (Dine-in)"