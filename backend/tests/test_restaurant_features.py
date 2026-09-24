import uuid
from datetime import datetime, timedelta, timezone

import pytest

from tests.conftest import client, create_test_user
from tests.test_restaurant import _add_item, _create_menu_product, _create_table, _open_ticket


def _auth(role: str = "admin") -> dict:
    suffix = uuid.uuid4().hex[:8]
    username = f"{role}_{suffix}"
    create_test_user(username, f"{suffix}@{role}.example.com", "testpass123", role=role)
    resp = client.post("/api/auth/login", json={"username": username, "password": "testpass123"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _create_component(headers: dict, sku: str, qty: int = 10, price: float = 30.0) -> dict:
    resp = client.post("/api/products", json={
        "location_id": 1, "sku": sku, "name": f"Comp {sku}", "unit_price": price,
        "cost_price": price, "is_menu_item": False, "quantity": qty,
    }, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _settle_ticket(headers: dict, ticket_id: int, method: str = "cash") -> dict:
    resp = client.post(f"/api/restaurant/tickets/{ticket_id}/settle", json={"payment_method": method}, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


# ---------------------------------------------------------------------------
# Restaurant reports
# ---------------------------------------------------------------------------

def test_restaurant_summary_report_requires_reports_permission(auth_headers):
    resp = client.get("/api/reports/restaurant-summary", headers=_auth("supplier"))
    assert resp.status_code == 403


def test_restaurant_summary_report_aggregates_settled_tickets(auth_headers):
    product = _create_menu_product(auth_headers, f"REP{uuid.uuid4().hex[:4]}", qty=10, price=100.0)
    ticket = _open_ticket(auth_headers)
    _add_item(auth_headers, ticket["id"], product["id"], quantity=2)
    _settle_ticket(auth_headers, ticket["id"])

    summary = client.get("/api/reports/restaurant-summary", headers=auth_headers).json()
    assert summary["ticket_count"] == 1
    assert summary["total_covers"] == 2
    assert summary["total_revenue"] > 0
    assert summary["total_tips"] == 0.0
    assert summary["average_ticket"] == summary["total_revenue"]
    assert any(pm["method"] == "cash" and pm["count"] == 1 for pm in summary["by_payment_method"])
    assert any(top["name"] == product["name"] and top["quantity_sold"] == 2 for top in summary["top_items"][:1])


def test_restaurant_summary_date_range_filters(auth_headers):
    product = _create_menu_product(auth_headers, f"REP2{uuid.uuid4().hex[:4]}", qty=10, price=50.0)
    ticket = _open_ticket(auth_headers)
    _add_item(auth_headers, ticket["id"], product["id"])
    _settle_ticket(auth_headers, ticket["id"])

    yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    empty = client.get("/api/reports/restaurant-summary", params={"start_date": "2000-01-01", "end_date": "2000-01-02"}, headers=auth_headers).json()
    assert empty["ticket_count"] == 0

    with_today = client.get("/api/reports/restaurant-summary", params={"start_date": yesterday, "end_date": today}, headers=auth_headers).json()
    assert with_today["ticket_count"] >= 1


def test_restaurant_daily_trends(auth_headers):
    product = _create_menu_product(auth_headers, f"TREND{uuid.uuid4().hex[:4]}", qty=10, price=60.0)
    ticket = _open_ticket(auth_headers)
    _add_item(auth_headers, ticket["id"], product["id"], quantity=3)
    _settle_ticket(auth_headers, ticket["id"])

    trends = client.get("/api/reports/restaurant-daily-trends", params={"days": 7}, headers=auth_headers).json()
    assert trends["totals"]["ticket_count"] == 1
    assert trends["totals"]["covers"] == 2
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    day = next(d for d in trends["daily"] if d["date"] == today)
    assert day["ticket_count"] == 1
    assert day["revenue"] == trends["totals"]["revenue"]


# ---------------------------------------------------------------------------
# QR ordering (public guest flow)
# ---------------------------------------------------------------------------

def test_public_menu_is_reachable_without_auth(auth_headers):
    product = _create_menu_product(auth_headers, f"PUB{uuid.uuid4().hex[:4]}", qty=5, price=40.0)
    resp = client.get("/api/restaurant/public/menu")
    assert resp.status_code == 200
    names = [i["name"] for section in resp.json() for i in section["items"]]
    assert any(n == product["name"] for n in names)


def test_guest_order_creates_and_sends_ticket(auth_headers):
    table = _create_table(auth_headers, f"QR{uuid.uuid4().hex[:4]}")
    product = _create_menu_product(auth_headers, f"GST{uuid.uuid4().hex[:4]}", qty=5, price=80.0)

    resp = client.post("/api/restaurant/public/orders", json={
        "table_id": table["id"], "guest_name": "Diner", "guest_count": 2,
        "items": [{"product_id": product["id"], "quantity": 2}],
    })
    assert resp.status_code == 201, resp.text
    order = resp.json()
    assert order["status"] in ("preparing", "queued", "ready")
    assert order["table_number"] == table["number"]
    assert order["guest_name"] == "Diner"
    assert order["items"][0]["status"] in ("queued", "preparing")

    # A second order must append to the same open ticket (no duplicate table error).
    resp2 = client.post("/api/restaurant/public/orders", json={
        "table_id": table["id"], "guest_name": "Diner", "guest_count": 2,
        "items": [{"product_id": product["id"], "quantity": 1}],
    })
    assert resp2.status_code == 201, resp2.text
    assert resp2.json()["id"] == order["id"]

    status = client.get(f"/api/restaurant/public/orders/{order['id']}").json()
    assert status["ticket_number"] == order["ticket_number"]

    # Guest order needs stock: kitchen send consumed it.
    kitchen = client.get("/api/restaurant/kitchen/board", headers=auth_headers).json()
    assert any(t["id"] == order["id"] for t in kitchen)


def test_guest_order_requires_stock(auth_headers):
    table = _create_table(auth_headers, f"QT{uuid.uuid4().hex[:4]}")
    product = _create_menu_product(auth_headers, f"GSTLOW{uuid.uuid4().hex[:4]}", qty=1, price=90.0)

    resp = client.post("/api/restaurant/public/orders", json={
        "table_id": table["id"], "guest_count": 1,
        "items": [{"product_id": product["id"], "quantity": 50}],
    })
    assert resp.status_code == 400
    assert "insufficient" in resp.json()["detail"].lower()


def test_guest_order_rejects_inactive_table(auth_headers):
    table = _create_table(auth_headers, f"QTA{uuid.uuid4().hex[:4]}")
    product = _create_menu_product(auth_headers, f"GST2{uuid.uuid4().hex[:4]}", qty=5, price=70.0)
    client.put(f"/api/restaurant/tables/{table['id']}", json={"is_active": False}, headers=auth_headers)

    resp = client.post("/api/restaurant/public/orders", json={
        "table_id": table["id"], "guest_count": 1,
        "items": [{"product_id": product["id"], "quantity": 1}],
    })
    assert resp.status_code == 400


def test_qr_sheet_pdf(auth_headers):
    _create_table(auth_headers, f"QRPDF{uuid.uuid4().hex[:4]}")
    sheet = client.get("/api/restaurant/qr-sheet", params={"base": "https://menu.example.com"}, headers=auth_headers)
    assert sheet.status_code == 200
    assert sheet.headers["content-type"] == "application/pdf"
    assert b"%PDF" in sheet.content


# ---------------------------------------------------------------------------
# Recipes (menu-item BOMs) + stock blowdown
# ---------------------------------------------------------------------------

def _attach_recipe(auth_headers, menu_product_id: int, component_ids: list[int]) -> dict:
    resp = client.post("/api/boms", json={
        "product_id": menu_product_id,
        "name": f"Recipe for {menu_product_id}",
        "items": [{"product_id": cid, "quantity": 1} for cid in component_ids],
    }, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_recipes_list_with_cost_and_margin(auth_headers):
    menu_item = _create_menu_product(auth_headers, f"RC{uuid.uuid4().hex[:4]}", qty=0, price=200.0)
    comp = _create_component(auth_headers, f"CM{uuid.uuid4().hex[:4]}", qty=50, price=40.0)
    _attach_recipe(auth_headers, menu_item["id"], [comp["id"]])

    recipes = client.get("/api/restaurant/recipes", headers=auth_headers).json()
    row = next(r for r in recipes if r["product_id"] == menu_item["id"])
    assert row["has_recipe"] is True
    assert row["recipe_cost"] == 40.0
    assert row["component_count"] == 1
    assert row["margin"] == 160.0
    assert row["margin_pct"] == pytest.approx(400.0)


def test_recipe_blowdown_consumes_components_not_dish(auth_headers):
    menu_item = _create_menu_product(auth_headers, f"BLOW{uuid.uuid4().hex[:4]}", qty=100, price=150.0)
    comp = _create_component(auth_headers, f"BLOWC{uuid.uuid4().hex[:4]}", qty=10, price=50.0)
    _attach_recipe(auth_headers, menu_item["id"], [comp["id"]])

    ticket = _open_ticket(auth_headers)
    _add_item(auth_headers, ticket["id"], menu_item["id"], quantity=2)

    sent = client.post(f"/api/restaurant/tickets/{ticket['id']}/send", headers=auth_headers)
    assert sent.status_code == 200, sent.text

    prod = client.get(f"/api/products/{menu_item['id']}", headers=auth_headers).json()
    comp_data = client.get(f"/api/products/{comp['id']}", headers=auth_headers).json()
    assert prod["quantity"] == 100  # dish itself untouched
    assert comp_data["quantity"] == 10 - 2  # 2 dishes x 1 component


def test_recipe_cancel_restores_component_stock(auth_headers):
    menu_item = _create_menu_product(auth_headers, f"RSTR{uuid.uuid4().hex[:4]}", qty=100, price=120.0)
    comp = _create_component(auth_headers, f"RSTRC{uuid.uuid4().hex[:4]}", qty=10, price=30.0)
    _attach_recipe(auth_headers, menu_item["id"], [comp["id"]])

    ticket = _open_ticket(auth_headers)
    _add_item(auth_headers, ticket["id"], menu_item["id"], quantity=3)
    client.post(f"/api/restaurant/tickets/{ticket['id']}/send", headers=auth_headers)

    cancelled = client.post(f"/api/restaurant/tickets/{ticket['id']}/cancel", headers=auth_headers)
    assert cancelled.status_code == 200, cancelled.text

    comp_data = client.get(f"/api/products/{comp['id']}", headers=auth_headers).json()
    assert comp_data["quantity"] == 10


def test_recipe_insufficient_component_stock_blocks_send(auth_headers):
    menu_item = _create_menu_product(auth_headers, f"RSHT{uuid.uuid4().hex[:4]}", qty=100, price=130.0)
    comp = _create_component(auth_headers, f"RSHTC{uuid.uuid4().hex[:4]}", qty=2, price=30.0)
    _attach_recipe(auth_headers, menu_item["id"], [comp["id"]])

    ticket = _open_ticket(auth_headers)
    _add_item(auth_headers, ticket["id"], menu_item["id"], quantity=5)

    resp = client.post(f"/api/restaurant/tickets/{ticket['id']}/send", headers=auth_headers)
    assert resp.status_code == 400
    assert "insufficient" in resp.json()["detail"].lower()

    # Ticket stays fully editable after the failed send.
    still = client.get(f"/api/restaurant/tickets/{ticket['id']}", headers=auth_headers).json()
    assert all(i["status"] == "pending" for i in still["items"])