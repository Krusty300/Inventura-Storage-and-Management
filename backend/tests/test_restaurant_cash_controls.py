"""Cash and discount integrity controls for the restaurant module.

These cover the anti-theft batch: a discount can no longer be applied silently,
voiding is attributed and manager-gated, and a shift close reconciles a real
drawer over a server-derived window.
"""
import uuid

from tests.conftest import client, create_test_user, TestingSessionLocal
from app.models.activity_log import ActivityLog
from app.models.notification import Notification


def _auth(role: str = "admin") -> dict:
    suffix = uuid.uuid4().hex[:8]
    username = f"{role}_{suffix}"
    create_test_user(username, f"{suffix}@{role}.example.com", "testpass123", role=role)
    resp = client.post("/api/auth/login", json={"username": username, "password": "testpass123"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _menu_product(headers: dict, price: float = 100.0, qty: int = 50) -> dict:
    sku = f"CC{uuid.uuid4().hex[:8]}"
    resp = client.post("/api/products", json={
        "location_id": 1, "sku": sku, "name": f"Cash {sku}", "unit_price": price,
        "is_menu_item": True, "quantity": qty,
    }, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _open_ticket(headers: dict, table_id: int | None = None) -> dict:
    payload: dict = {"guest_count": 2}
    if table_id is not None:
        payload["table_id"] = table_id
    resp = client.post("/api/restaurant/tickets", json=payload, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _add_item(headers: dict, ticket_id: int, product_id: int, quantity: int = 1) -> dict:
    resp = client.post(
        f"/api/restaurant/tickets/{ticket_id}/items",
        json={"product_id": product_id, "quantity": quantity},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _logs(ticket_id: int, action: str) -> list[ActivityLog]:
    db = TestingSessionLocal()
    try:
        return db.query(ActivityLog).filter(
            ActivityLog.entity_type == "restaurant_ticket",
            ActivityLog.entity_id == ticket_id,
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
# Batch 1: discounts are capped, attributed and never silent
# ---------------------------------------------------------------------------

def test_worker_cannot_apply_a_discount(auth_headers):
    worker = _auth("worker")
    product = _menu_product(auth_headers)
    ticket = _open_ticket(worker)
    _add_item(worker, ticket["id"], product["id"])

    resp = client.put(
        f"/api/restaurant/tickets/{ticket['id']}",
        json={"discount_amount": 10.0, "discount_reason": "goodwill"},
        headers=worker,
    )
    assert resp.status_code == 403
    assert "permission" in resp.json()["detail"].lower()


def test_discount_requires_a_written_reason(auth_headers):
    product = _menu_product(auth_headers)
    ticket = _open_ticket(auth_headers)
    _add_item(auth_headers, ticket["id"], product["id"])

    for reason in ("", "  "):
        resp = client.put(
            f"/api/restaurant/tickets/{ticket['id']}",
            json={"discount_amount": 10.0, "discount_reason": reason},
            headers=auth_headers,
        )
        assert resp.status_code == 400, resp.text
        assert "reason" in resp.json()["detail"].lower()

    # A reason that is too short to be meaningful is rejected too.
    short = client.put(
        f"/api/restaurant/tickets/{ticket['id']}",
        json={"discount_amount": 10.0, "discount_reason": "ok"},
        headers=auth_headers,
    )
    assert short.status_code == 400


def test_discount_is_capped_below_a_full_comp(auth_headers):
    product = _menu_product(auth_headers, price=100.0)
    ticket = _open_ticket(auth_headers)
    _add_item(auth_headers, ticket["id"], product["id"], quantity=2)  # subtotal 200

    # The old behaviour: discount == subtotal settles the ticket for zero.
    comp = client.put(
        f"/api/restaurant/tickets/{ticket['id']}",
        json={"discount_amount": 200.0, "discount_reason": "manager comp"},
        headers=auth_headers,
    )
    assert comp.status_code == 400, comp.text
    assert "50%" in comp.json()["detail"]

    # Half the subtotal is the ceiling, and it is accepted.
    at_cap = client.put(
        f"/api/restaurant/tickets/{ticket['id']}",
        json={"discount_amount": 100.0, "discount_reason": "service recovery"},
        headers=auth_headers,
    )
    assert at_cap.status_code == 200, at_cap.text
    assert float(at_cap.json()["discount_amount"]) == 100.0


def test_discount_is_logged_as_its_own_action_and_alerts_admins(auth_headers):
    product = _menu_product(auth_headers)
    ticket = _open_ticket(auth_headers)
    _add_item(auth_headers, ticket["id"], product["id"])

    resp = client.put(
        f"/api/restaurant/tickets/{ticket['id']}",
        json={"discount_amount": 10.0, "discount_reason": "kitchen sent wrong dish"},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text

    entries = _logs(ticket["id"], "discount")
    assert entries, "a discount must leave its own activity-log entry"
    assert "kitchen sent wrong dish" in entries[0].description
    assert any("Discount on" in title for title in _notification_titles())


def test_settle_time_discount_is_also_gated(auth_headers):
    worker = _auth("worker")
    product = _menu_product(auth_headers)
    ticket = _open_ticket(worker)
    _add_item(worker, ticket["id"], product["id"])

    denied = client.post(
        f"/api/restaurant/tickets/{ticket['id']}/settle",
        json={"payment_method": "cash", "discount_amount": 10.0, "discount_reason": "comp"},
        headers=worker,
    )
    assert denied.status_code == 403

    admin_ticket = _open_ticket(auth_headers)
    _add_item(auth_headers, admin_ticket["id"], product["id"])
    no_reason = client.post(
        f"/api/restaurant/tickets/{admin_ticket['id']}/settle",
        json={"payment_method": "cash", "discount_amount": 10.0},
        headers=auth_headers,
    )
    assert no_reason.status_code == 400, no_reason.text

    ok = client.post(
        f"/api/restaurant/tickets/{admin_ticket['id']}/settle",
        json={"payment_method": "cash", "discount_amount": 10.0, "discount_reason": "complimentary dessert"},
        headers=auth_headers,
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["status"] == "settled"
    assert _logs(admin_ticket["id"], "discount")


def test_void_that_shrinks_the_bill_cuts_the_discount_loudly(auth_headers):
    big_product = _menu_product(auth_headers, price=100.0)
    small_product = _menu_product(auth_headers, price=100.0)
    ticket = _open_ticket(auth_headers)
    big = _add_item(auth_headers, ticket["id"], big_product["id"], quantity=6)  # 600
    _add_item(auth_headers, ticket["id"], small_product["id"], quantity=1)  # +100

    discounted = client.put(
        f"/api/restaurant/tickets/{ticket['id']}",
        json={"discount_amount": 240.0, "discount_reason": "long party discount"},  # 40% of 700
        headers=auth_headers,
    )
    assert discounted.status_code == 200, discounted.text
    assert float(discounted.json()["subtotal"]) == 700.0

    # Dropping the 600 line leaves a 100 bill; the 240 discount must not
    # silently survive as a full comp.
    resp = client.delete(
        f"/api/restaurant/tickets/{ticket['id']}/items/{big['items'][-1]['id']}",
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert float(body["subtotal"]) == 100.0
    assert float(body["discount_amount"]) == 100.0
    assert float(body["total_amount"]) == 0.0

    entries = _logs(ticket["id"], "discount")
    assert len(entries) == 2, "the clamp must leave a second, explicit entry"
    assert "cut by" in entries[1].description


def test_removing_a_line_actually_reduces_the_bill(auth_headers):
    product = _menu_product(auth_headers, price=100.0)
    ticket = _open_ticket(auth_headers)
    item = _add_item(auth_headers, ticket["id"], product["id"], quantity=3)

    resp = client.delete(
        f"/api/restaurant/tickets/{ticket['id']}/items/{item['items'][-1]['id']}",
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert float(body["subtotal"]) == 0.0
    assert float(body["total_amount"]) == 0.0
    assert body["items"] == []


def test_split_will_not_silently_comp_the_remaining_bill(auth_headers):
    small_product = _menu_product(auth_headers, price=100.0)
    big_product = _menu_product(auth_headers, price=100.0)
    ticket = _open_ticket(auth_headers)
    _add_item(auth_headers, ticket["id"], small_product["id"], quantity=1)   # 100 stays
    big = _add_item(auth_headers, ticket["id"], big_product["id"], quantity=2)  # 200 moves

    discounted = client.put(
        f"/api/restaurant/tickets/{ticket['id']}",
        json={"discount_amount": 150.0, "discount_reason": "birthday package"},  # 50% of 300
        headers=auth_headers,
    )
    assert discounted.status_code == 200, discounted.text

    # Moving the 200 line away would leave a 100 bill holding a 150 discount,
    # i.e. a free table created as a side effect of splitting.
    resp = client.post(
        f"/api/restaurant/tickets/{ticket['id']}/split",
        json={"item_ids": [big["items"][-1]["id"]]},
        headers=auth_headers,
    )
    assert resp.status_code == 400, resp.text
    assert "discount" in resp.json()["detail"].lower()



# ---------------------------------------------------------------------------
# Batch 2: voids are attributed, reasoned and manager-gated across servers
# ---------------------------------------------------------------------------

def test_void_requires_a_reason(auth_headers):
    product = _menu_product(auth_headers)
    ticket = _open_ticket(auth_headers)
    item = _add_item(auth_headers, ticket["id"], product["id"])
    item_id = item["items"][-1]["id"]

    for payload in ({}, {"reason": ""}, {"reason": "  "}):
        resp = client.post(
            f"/api/restaurant/tickets/{ticket['id']}/items/{item_id}/void",
            json=payload, headers=auth_headers,
        )
        assert resp.status_code in (400, 422), resp.text

    ok = client.post(
        f"/api/restaurant/tickets/{ticket['id']}/items/{item_id}/void",
        json={"reason": "customer changed mind"}, headers=auth_headers,
    )
    assert ok.status_code == 200, ok.text
    voided = next(i for i in ok.json()["items"] if i["id"] == item_id)
    assert voided["status"] == "voided"
    assert voided["void_reason"] == "customer changed mind"


def test_void_records_who_did_it_and_logs_a_void_action(auth_headers):
    product = _menu_product(auth_headers)
    ticket = _open_ticket(auth_headers)
    item = _add_item(auth_headers, ticket["id"], product["id"])
    item_id = item["items"][-1]["id"]

    resp = client.post(
        f"/api/restaurant/tickets/{ticket['id']}/items/{item_id}/void",
        json={"reason": "sent to the wrong table"}, headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    voided = next(i for i in resp.json()["items"] if i["id"] == item_id)
    assert voided["voided_by"] is not None
    assert voided["voided_by_username"] == "testuser"

    entries = _logs(ticket["id"], "void")
    assert entries, "a void must be logged as its own action"
    assert "sent to the wrong table" in entries[0].description


def test_worker_cannot_void_another_servers_ticket(auth_headers):
    server = _auth("worker")
    other = _auth("worker")
    manager = _auth("manager")
    product = _menu_product(auth_headers)

    ticket = _open_ticket(server)
    item = _add_item(server, ticket["id"], product["id"])
    item_id = item["items"][-1]["id"]

    denied = client.post(
        f"/api/restaurant/tickets/{ticket['id']}/items/{item_id}/void",
        json={"reason": "helping myself"}, headers=other,
    )
    assert denied.status_code == 403, denied.text
    assert "manager" in denied.json()["detail"].lower()

    allowed = client.post(
        f"/api/restaurant/tickets/{ticket['id']}/items/{item_id}/void",
        json={"reason": "kitchen never plated it"}, headers=manager,
    )
    assert allowed.status_code == 200, allowed.text
    voided = next(i for i in allowed.json()["items"] if i["id"] == item_id)
    assert voided["status"] == "voided"
    assert "another server" in _logs(ticket["id"], "void")[0].description


def test_a_server_can_still_void_their_own_ticket(auth_headers):
    server = _auth("worker")
    product = _menu_product(auth_headers)
    ticket = _open_ticket(server)
    item = _add_item(server, ticket["id"], product["id"])

    resp = client.post(
        f"/api/restaurant/tickets/{ticket['id']}/items/{item['items'][-1]['id']}/void",
        json={"reason": "dropped it"}, headers=server,
    )
    assert resp.status_code == 200, resp.text


# ---------------------------------------------------------------------------
# Batch 3: the drawer reconciles over a server-derived window
# ---------------------------------------------------------------------------

def test_shift_close_ignores_a_client_supplied_window(auth_headers):
    product = _menu_product(auth_headers, price=100.0)
    ticket = _open_ticket(auth_headers)
    _add_item(auth_headers, ticket["id"], product["id"], quantity=3)
    client.post(
        f"/api/restaurant/tickets/{ticket['id']}/settle",
        json={"payment_method": "cash"}, headers=auth_headers,
    )

    # The old hole: a far-future period_start made the window empty, so a
    # counted_cash of 0 reconciled as a perfectly balanced drawer.
    resp = client.post("/api/restaurant/shifts/close", json={
        "counted_cash": 0, "period_start": "2099-01-01T00:00:00Z", "period_end": "2099-01-02T00:00:00Z",
    }, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    row = resp.json()
    assert row["period_start"] < row["created_at"], "window must end in the present"
    assert float(row["expected_cash"]) == 300.0
    assert float(row["variance"]) == -300.0


def test_shift_close_accounts_for_float_and_pay_movements(auth_headers):
    product = _menu_product(auth_headers, price=100.0)
    ticket = _open_ticket(auth_headers)
    _add_item(auth_headers, ticket["id"], product["id"], quantity=2)
    client.post(
        f"/api/restaurant/tickets/{ticket['id']}/settle",
        json={"payment_method": "cash", "tip_amount": 20.0}, headers=auth_headers,
    )

    resp = client.post("/api/restaurant/shifts/close", json={
        "counted_cash": 720.0,
        "opening_float": 500.0,
        "paid_in": 100.0,
        "paid_out": 120.0,
        "notes": "dropped a note in the safe",
    }, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    row = resp.json()
    # 200 cash sales + 20 tips + 500 float + 100 in - 120 out
    assert float(row["cash_sales"]) == 200.0
    assert float(row["cash_tips"]) == 20.0
    assert float(row["expected_cash"]) == 700.0
    assert float(row["variance"]) == 20.0
    assert float(row["opening_float"]) == 500.0
    assert float(row["paid_in"]) == 100.0
    assert float(row["paid_out"]) == 120.0


def test_shift_close_flags_a_short_mobile_money_payment(auth_headers):
    product = _menu_product(auth_headers, price=100.0)
    ticket = _open_ticket(auth_headers)
    _add_item(auth_headers, ticket["id"], product["id"], quantity=1)
    settled = client.post(
        f"/api/restaurant/tickets/{ticket['id']}/settle",
        json={"payment_method": "mobile_money", "payment_provider": "m-pesa", "payment_phone": "0712345678"},
        headers=auth_headers,
    )
    assert settled.status_code == 200, settled.text
    sale_id = settled.json()["sale_id"]

    # The customer only authorises part of the bill. The sale stays paid, and
    # the shortfall has to be visible at shift close rather than quietly
    # counted as a clean mobile money sale.
    db = TestingSessionLocal()
    from app.models.sale import Sale
    row = db.query(Sale).filter(Sale.id == sale_id).first()
    row.status = "completed"
    row.payment_status = "completed"
    row.payment_checkout_request_id = "ws_CO_SHORT"
    db.commit()
    db.close()
    client.post("/api/daraja/callback/stk", json={
        "Body": {"stkCallback": {
            "CheckoutRequestID": "ws_CO_SHORT", "ResultCode": 0, "ResultDesc": "Success",
            "CallbackMetadata": {"Item": [{"Name": "Amount", "Value": 40.0}]},
        }}
    })

    sale = client.get(f"/api/sales/{sale_id}", headers=auth_headers).json()
    assert sale["payment_amount_status"] == "short"

    # Check the preview before closing: closing moves the window start past
    # this ticket, which is the whole point of a close being a period boundary.
    preview = client.get("/api/restaurant/shifts/preview", headers=auth_headers).json()
    assert preview["payment_review_count"] == 1
    assert float(preview["payment_review_amount"]) == 40.0
    # The shortfall is not cash, so it must not distort the drawer either way.
    assert float(preview["cash_sales"]) == 0.0

    close = client.post("/api/restaurant/shifts/close", json={
        "counted_cash": 500.0, "opening_float": 500.0,
    }, headers=auth_headers)
    assert close.status_code == 201, close.text
    assert float(close.json()["expected_cash"]) == 500.0
    assert float(close.json()["variance"]) == 0.0

    # The shift close raises the review for the admins to chase.
    notifications = client.get("/api/notifications", headers=auth_headers).json()
    items = notifications["items"] if isinstance(notifications, dict) else notifications
    assert any("Payment review pending" in (n.get("title") or "") for n in items)


def test_shift_close_summary_is_clean_when_amounts_match(auth_headers):
    product = _menu_product(auth_headers, price=100.0)
    ticket = _open_ticket(auth_headers)
    _add_item(auth_headers, ticket["id"], product["id"], quantity=1)
    settled = client.post(
        f"/api/restaurant/tickets/{ticket['id']}/settle",
        json={"payment_method": "mobile_money", "payment_provider": "m-pesa", "payment_phone": "0712345678"},
        headers=auth_headers,
    )
    sale_id = settled.json()["sale_id"]
    client.put(f"/api/sales/{sale_id}/checkout-id", params={"checkout_request_id": "ws_CO_OK"}, headers=auth_headers)
    client.post("/api/daraja/mock-confirm", params={"checkout_request_id": "ws_CO_OK"}, headers=auth_headers)

    summary = client.get("/api/restaurant/shifts/preview", headers=auth_headers).json()
    assert summary["payment_review_count"] == 0
    assert float(summary["payment_review_amount"]) == 0.0


def test_guest_ticket_cash_reaches_the_settling_servers_drawer(auth_headers):
    cashier = _auth("worker")
    product = _menu_product(auth_headers, price=50.0)

    table = client.post("/api/restaurant/tables", json={"number": f"Q{uuid.uuid4().hex[:4]}"}, headers=auth_headers)
    assert table.status_code == 201, table.text
    table_id = table.json()["id"]

    # The guest orders over QR: the ticket is opened by the system user.
    order = client.post("/api/restaurant/public/orders", json={
        "table_id": table_id, "guest_name": "Walk-in", "items": [{"product_id": product["id"], "quantity": 2}],
    })
    assert order.status_code == 201, order.text
    guest_ticket = order.json()

    settled = client.post(
        f"/api/restaurant/tickets/{guest_ticket['id']}/settle",
        json={"payment_method": "cash"}, headers=cashier,
    )
    assert settled.status_code == 200, settled.text

    # The cash the cashier took must show up in the cashier's own drawer.
    preview = client.get("/api/restaurant/shifts/preview", headers=cashier)
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["ticket_count"] == 1
    assert float(body["expected_cash"]) == 100.0


def test_shift_history_is_scoped_for_non_managers(auth_headers):
    manager = _auth("manager")
    cashier = _auth("worker")

    mine = client.post(
        "/api/restaurant/shifts/close",
        json={"counted_cash": 0, "opening_float": 0}, headers=cashier,
    )
    assert mine.status_code == 201, mine.text
    theirs = client.post(
        "/api/restaurant/shifts/close",
        json={"counted_cash": 10.0, "opening_float": 10.0}, headers=manager,
    )
    assert theirs.status_code == 201, theirs.text

    worker_view = client.get("/api/restaurant/shifts", headers=cashier).json()
    assert [row["id"] for row in worker_view] == [mine.json()["id"]]

    manager_view = client.get("/api/restaurant/shifts", headers=manager).json()
    ids = {row["id"] for row in manager_view}
    assert mine.json()["id"] in ids and theirs.json()["id"] in ids


def test_cash_variance_raises_a_manager_alert(auth_headers):
    product = _menu_product(auth_headers, price=100.0)
    ticket = _open_ticket(auth_headers)
    _add_item(auth_headers, ticket["id"], product["id"])
    client.post(
        f"/api/restaurant/tickets/{ticket['id']}/settle",
        json={"payment_method": "cash"}, headers=auth_headers,
    )

    resp = client.post(
        "/api/restaurant/shifts/close",
        json={"counted_cash": 0}, headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    assert any("Cash variance" in title for title in _notification_titles())
