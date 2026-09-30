import uuid

from tests.conftest import client, create_test_user


def _auth(role: str = "admin") -> dict:
    suffix = uuid.uuid4().hex[:8]
    username = f"{role}_{suffix}"
    create_test_user(username, f"{suffix}@{role}.example.com", "testpass123", role=role)
    resp = client.post("/api/auth/login", json={"username": username, "password": "testpass123"})
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _create_table(headers: dict, number: str = "T1", zone: str = "Main", capacity: int = 4) -> dict:
    resp = client.post("/api/restaurant/tables", json={"number": number, "zone": zone, "capacity": capacity}, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _create_menu_product(headers: dict, sku: str, qty: int = 10, price: float = 100.0) -> dict:
    resp = client.post("/api/products", json={
        "location_id": 1, "sku": sku, "name": f"Menu {sku}", "unit_price": price,
        "is_menu_item": True, "quantity": qty,
    }, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _open_ticket(headers: dict, table_id: int | None = None) -> dict:
    payload = {"guest_count": 2}
    if table_id is not None:
        payload["table_id"] = table_id
    resp = client.post("/api/restaurant/tickets", json=payload, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _add_item(headers: dict, ticket_id: int, product_id: int, quantity: int = 1) -> dict:
    resp = client.post(f"/api/restaurant/tickets/{ticket_id}/items", json={"product_id": product_id, "quantity": quantity}, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_restaurant_requires_restaurant_view_permission():
    headers = _auth("supplier")
    resp = client.get("/api/restaurant/tables", headers=headers)
    assert resp.status_code == 403


def test_table_crud_and_occupancy(auth_headers):
    table = _create_table(auth_headers)
    assert table["status"] == "available"
    dup = client.post("/api/restaurant/tables", json={"number": "T1"}, headers=auth_headers)
    assert dup.status_code == 400

    tables = client.get("/api/restaurant/tables", headers=auth_headers).json()
    assert any(t["number"] == "T1" and t["status"] == "available" for t in tables)

    # Rename the table.
    renamed = client.put(f"/api/restaurant/tables/{table['id']}", json={"zone": "Terrace"}, headers=auth_headers)
    assert renamed.status_code == 200
    assert renamed.json()["zone"] == "Terrace"

    # Opening a ticket occupies the table.
    ticket = _open_ticket(auth_headers, table["id"])
    tables = client.get("/api/restaurant/tables", headers=auth_headers).json()
    occupied = next(t for t in tables if t["id"] == table["id"])
    assert occupied["status"] == "occupied"
    assert occupied["active_ticket_id"] == ticket["id"]

    # Duplicate ticket on same table is rejected.
    dup_ticket = client.post("/api/restaurant/tickets", json={"table_id": table["id"]}, headers=auth_headers)
    assert dup_ticket.status_code == 400

    # Table used by tickets cannot be deleted.
    resp = client.delete(f"/api/restaurant/tables/{table['id']}", headers=auth_headers)
    assert resp.status_code == 400

    # Settling frees the table; it still cannot be deleted (has history).
    product = _create_menu_product(auth_headers, "TBLPRD1", qty=10)
    _add_item(auth_headers, ticket["id"], product["id"], quantity=2)
    settled = client.post(f"/api/restaurant/tickets/{ticket['id']}/settle", json={"payment_method": "cash"}, headers=auth_headers)
    assert settled.status_code == 200
    assert settled.json()["status"] == "settled"
    tables = client.get("/api/restaurant/tables", headers=auth_headers).json()
    freed = next(t for t in tables if t["id"] == table["id"])
    assert freed["status"] == "available"
    assert client.delete(f"/api/restaurant/tables/{table['id']}", headers=auth_headers).status_code == 400


def test_ticket_lifecycle_decrements_stock_and_cancels_restores(auth_headers):
    product = _create_menu_product(auth_headers, "LIFEPRD", qty=10, price=50.0)
    ticket = _open_ticket(auth_headers)  # takeaway (no table)
    assert ticket["status"] == "open"
    assert ticket["table_number"] == "Takeaway"

    added = _add_item(auth_headers, ticket["id"], product["id"], quantity=2)
    item = added["items"][0]
    assert item["unit_price"] == 50.0
    assert added["subtotal"] == 100.0
    assert added["total_amount"] == 100.0

    product_after_add = client.get(f"/api/products/{product['id']}", headers=auth_headers).json()
    assert product_after_add["quantity"] == 10  # stock untouched until sent

    # Send to kitchen -> stock consumed.
    sent = client.post(f"/api/restaurant/tickets/{ticket['id']}/send", headers=auth_headers)
    assert sent.status_code == 200
    assert sent.json()["status"] == "preparing"
    assert sent.json()["items"][0]["status"] == "queued"
    product_after_send = client.get(f"/api/products/{product['id']}", headers=auth_headers).json()
    assert product_after_send["quantity"] == 8

    # Kitchen polish: queued -> preparing -> ready.
    for step in ("preparing", "ready"):
        r = client.put(f"/api/restaurant/tickets/{ticket['id']}/items/{item['id']}/status", json={"status": step}, headers=auth_headers)
        assert r.status_code == 200, r.text
    assert r.json()["status"] == "ready"

    # Invalid transition rejected.
    bad = client.put(f"/api/restaurant/tickets/{ticket['id']}/items/{item['id']}/status", json={"status": "queued"}, headers=auth_headers)
    assert bad.status_code == 400

    # Board shows the ticket while preparing/ready.
    board = client.get("/api/restaurant/kitchen/board", headers=auth_headers).json()
    assert any(t["ticket_number"] == ticket["ticket_number"] and t["stage"] == "ready" for t in board)

    # Waiter serves it.
    served = client.post(f"/api/restaurant/tickets/{ticket['id']}/serve", headers=auth_headers)
    assert served.status_code == 200
    assert served.json()["status"] == "served"

    # Cancel restores stock.
    cancelled = client.post(f"/api/restaurant/tickets/{ticket['id']}/cancel", headers=auth_headers)
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"
    product_restored = client.get(f"/api/products/{product['id']}", headers=auth_headers).json()
    assert product_restored["quantity"] == 10


def test_settle_cash_creates_completed_sale(auth_headers):
    product = _create_menu_product(auth_headers, "CASHPRD", qty=5, price=200.0)
    ticket = _open_ticket(auth_headers)
    _add_item(auth_headers, ticket["id"], product["id"], quantity=1)

    resp = client.post(f"/api/restaurant/tickets/{ticket['id']}/settle", json={"payment_method": "cash"}, headers=auth_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "settled"
    assert body["subtotal"] == 200.0
    assert body["sale_id"] is not None

    sale_id = body["sale_id"]
    sale = client.get(f"/api/sales/{sale_id}", headers=auth_headers).json()
    assert sale["status"] == "completed"
    assert sale["payment_method"] == "cash"
    assert sale["total_amount"] == 200.0
    assert len(sale["items"]) == 1

    # Stock was decremented once at send-with-settle.
    product_after = client.get(f"/api/products/{product['id']}", headers=auth_headers).json()
    assert product_after["quantity"] == 4


def test_settle_mobile_money_pending_until_confirmed(auth_headers):
    product = _create_menu_product(auth_headers, "MPESAPRD", qty=5, price=150.0)
    ticket = _open_ticket(auth_headers)
    _add_item(auth_headers, ticket["id"], product["id"], quantity=1)

    resp = client.post(f"/api/restaurant/tickets/{ticket['id']}/settle", json={
        "payment_method": "mobile_money", "payment_provider": "m-pesa", "payment_phone": "0712345678",
    }, headers=auth_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "paying"
    sale_id = body["sale_id"]

    sale = client.get(f"/api/sales/{sale_id}", headers=auth_headers).json()
    assert sale["status"] == "pending"
    assert sale["payment_method"] == "mobile_money"
    assert sale["payment_provider"] == "m-pesa"

    # Simulate the STK callback confirming payment.
    client.put(f"/api/sales/{sale_id}/checkout-id", params={"checkout_request_id": "ws_CO_MOCK123"}, headers=auth_headers)
    confirm = client.post("/api/daraja/mock-confirm", params={"checkout_request_id": "ws_CO_MOCK123"}, headers=auth_headers)
    assert confirm.status_code == 200

    confirmed = client.get(f"/api/restaurant/tickets/{ticket['id']}", headers=auth_headers).json()
    assert confirmed["status"] == "settled"
    assert confirmed["settled_at"] is not None

    # Stock stays decremented after the paid sale completes.
    product_after = client.get(f"/api/products/{product['id']}", headers=auth_headers).json()
    assert product_after["quantity"] == 4


def test_settle_mobile_money_charges_bill_plus_tip(auth_headers):
    product = _create_menu_product(auth_headers, "TIPPRD", qty=5, price=100.0)
    ticket = _open_ticket(auth_headers)
    _add_item(auth_headers, ticket["id"], product["id"], quantity=1)

    resp = client.post(f"/api/restaurant/tickets/{ticket['id']}/settle", json={
        "payment_method": "mobile_money", "payment_provider": "m-pesa",
        "payment_phone": "0712345678", "tip_amount": 20.0,
    }, headers=auth_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["tip_amount"] == 20.0
    sale_id = body["sale_id"]

    sale = client.get(f"/api/sales/{sale_id}", headers=auth_headers).json()
    # The receipt totals bill + tip, so the STK prompt has to ask for the same
    # figure. Tax is 0 in tests, so this is 100 + 20.
    assert sale["payment_provider_amount"] == 120.0

    # And the push uses the recorded amount, rounded the way Daraja charges.
    push = client.post(f"/api/sales/{sale_id}/stk-push", json={}, headers=auth_headers)
    assert push.status_code == 200, push.text
    assert push.json()["amount"] == 120.0


def test_settle_mobile_money_amount_is_rounded_for_daraja(auth_headers):
    product = _create_menu_product(auth_headers, "ROUNDPRD", qty=5, price=100.64)
    ticket = _open_ticket(auth_headers)
    _add_item(auth_headers, ticket["id"], product["id"], quantity=1)

    resp = client.post(f"/api/restaurant/tickets/{ticket['id']}/settle", json={
        "payment_method": "mobile_money", "payment_provider": "m-pesa",
        "payment_phone": "0712345678",
    }, headers=auth_headers)
    sale_id = resp.json()["sale_id"]
    sale = client.get(f"/api/sales/{sale_id}", headers=auth_headers).json()
    # 100.64 is pushed as 101, so verification compares the callback against
    # 101 rather than flagging every cents-bearing bill as short-paid.
    assert sale["payment_provider_amount"] == 101.0

    push = client.post(f"/api/sales/{sale_id}/stk-push", json={}, headers=auth_headers)
    assert push.json()["amount"] == 101.0


def test_settle_cash_ticket_has_no_provider_amount(auth_headers):
    product = _create_menu_product(auth_headers, "CASHTIP", qty=5, price=100.0)
    ticket = _open_ticket(auth_headers)
    _add_item(auth_headers, ticket["id"], product["id"], quantity=1)

    resp = client.post(f"/api/restaurant/tickets/{ticket['id']}/settle", json={
        "payment_method": "cash", "tip_amount": 20.0,
    }, headers=auth_headers)
    assert resp.status_code == 200, resp.text
    sale = client.get(f"/api/sales/{resp.json()['sale_id']}", headers=auth_headers).json()
    assert sale["payment_provider_amount"] is None


def test_settle_requires_restaurant_settle_permission():
    product = _create_menu_product(_auth(), "PERMPRD", qty=5)
    ticket = _open_ticket(_auth())
    _add_item(_auth(), ticket["id"], product["id"])
    resp = client.post(f"/api/restaurant/tickets/{ticket['id']}/settle", json={"payment_method": "cash"}, headers=_auth("customer"))
    assert resp.status_code == 403


def test_cancel_pending_mobile_ticket_cancels_sale(auth_headers):
    product = _create_menu_product(auth_headers, "CANCELMP", qty=5, price=90.0)
    ticket = _open_ticket(auth_headers)
    _add_item(auth_headers, ticket["id"], product["id"])

    resp = client.post(f"/api/restaurant/tickets/{ticket['id']}/settle", json={
        "payment_method": "mobile_money", "payment_provider": "m-pesa", "payment_phone": "0712345678",
    }, headers=auth_headers)
    sale_id = resp.json()["sale_id"]

    cancelled = client.post(f"/api/restaurant/tickets/{ticket['id']}/cancel", headers=auth_headers)
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"

    sale = client.get(f"/api/sales/{sale_id}", headers=auth_headers).json()
    assert sale["status"] == "cancelled"
    product_after = client.get(f"/api/products/{product['id']}", headers=auth_headers).json()
    assert product_after["quantity"] == 5


def test_menu_only_products_filter(auth_headers):
    _create_menu_product(auth_headers, "MENUONLY1", qty=1)
    resp = client.post("/api/products", json={
        "location_id": 1, "sku": "NOTMENU1", "name": "Not menu", "quantity": 1,
    }, headers=auth_headers)
    assert resp.status_code == 201

    menu = client.get("/api/products", params={"menu_only": True, "active_only": True}, headers=auth_headers).json()
    assert any(p["sku"] == "MENUONLY1" for p in menu["items"])
    assert not any(p["sku"] == "NOTMENU1" for p in menu["items"])
