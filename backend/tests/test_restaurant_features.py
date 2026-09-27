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


def _ticket(headers: dict, ticket_id: int) -> dict:
    resp = client.get(f"/api/restaurant/tickets/{ticket_id}", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _item_ids(headers: dict, ticket_id: int) -> dict:
    """Map product_id -> added item id for a ticket (last line per product)."""
    out: dict[int, int] = {}
    for i in _ticket(headers, ticket_id)["items"]:
        out[i["product_id"]] = i["id"]
    return out


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


def test_summary_top_items_excludes_voided(auth_headers):
    sold = _create_menu_product(auth_headers, f"TOPV{uuid.uuid4().hex[:4]}", qty=10, price=100.0)
    voided = _create_menu_product(auth_headers, f"TOPD{uuid.uuid4().hex[:4]}", qty=10, price=60.0)
    ticket = _open_ticket(auth_headers)
    _add_item(auth_headers, ticket["id"], sold["id"], quantity=2)
    _add_item(auth_headers, ticket["id"], voided["id"], quantity=2)
    assert client.post(f"/api/restaurant/tickets/{ticket['id']}/send", headers=auth_headers).status_code == 200
    voided_item = _item_ids(auth_headers, ticket["id"])[voided["id"]]
    resp = client.post(
        f"/api/restaurant/tickets/{ticket['id']}/items/{voided_item}/void",
        json={"reason": "Comp"}, headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    _settle_ticket(auth_headers, ticket["id"])

    summary = client.get("/api/reports/restaurant-summary", headers=auth_headers).json()
    top = {t["product_id"]: t for t in summary["top_items"]}
    assert top[sold["id"]]["quantity_sold"] == 2
    assert voided["id"] not in top


def test_tickets_list_date_range_filter(auth_headers):
    ticket = _open_ticket(auth_headers)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    future = (datetime.now(timezone.utc) + timedelta(days=365)).strftime("%Y-%m-%d")

    matched = client.get("/api/restaurant/tickets", params={"start_date": today, "end_date": today}, headers=auth_headers).json()
    assert any(t["id"] == ticket["id"] for t in matched["items"])

    none = client.get("/api/restaurant/tickets", params={"start_date": future, "end_date": future}, headers=auth_headers).json()
    assert none["total"] == 0 or all(t["id"] != ticket["id"] for t in none["items"])

    bad = client.get("/api/restaurant/tickets", params={"start_date": "not-a-date"}, headers=auth_headers)
    assert bad.status_code == 400


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

    status = client.get(f"/api/restaurant/public/orders/{order['token']}").json()
    assert status["ticket_number"] == order["ticket_number"]

    # The unauthenticated order lookup must be token-gated, not id-gated.
    assert client.get(f"/api/restaurant/public/orders/{order['id']}").status_code == 404
    assert client.get("/api/restaurant/public/orders/wrong-token").status_code == 404

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
    assert row["margin_pct"] == pytest.approx(80.0)  # margin vs sale price, not cost


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


# ---------------------------------------------------------------------------
# Voids
# ---------------------------------------------------------------------------

def test_void_needs_restaurant_update_permission(auth_headers):
    table = _create_table(auth_headers, f"VT{uuid.uuid4().hex[:4]}")
    product = _create_menu_product(auth_headers, f"VTR{uuid.uuid4().hex[:4]}", qty=5)
    ticket = _open_ticket(auth_headers, table["id"])
    _add_item(auth_headers, ticket["id"], product["id"], quantity=2)
    item_id = _item_ids(auth_headers, ticket["id"])[product["id"]]

    resp = client.post(
        f"/api/restaurant/tickets/{ticket['id']}/items/{item_id}/void",
        json={"reason": "no"}, headers=_auth("supplier"),
    )
    assert resp.status_code == 403


def test_void_pending_item_removes_from_totals_without_stock_change(auth_headers):
    table = _create_table(auth_headers, f"VTD{uuid.uuid4().hex[:4]}")
    product = _create_menu_product(auth_headers, f"VTDP{uuid.uuid4().hex[:4]}", qty=5, price=100.0)
    ticket = _open_ticket(auth_headers, table["id"])
    _add_item(auth_headers, ticket["id"], product["id"], quantity=2)
    item_id = _item_ids(auth_headers, ticket["id"])[product["id"]]

    resp = client.post(
        f"/api/restaurant/tickets/{ticket['id']}/items/{item_id}/void",
        json={"reason": "Wrong item"}, headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text

    data = _ticket(auth_headers, ticket["id"])
    assert data["total_amount"] == 0.0
    voided = next(i for i in data["items"] if i["id"] == item_id)
    assert voided["status"] == "voided"
    assert voided["void_reason"] == "Wrong item"
    assert voided["voided_at"] is not None

    prod = client.get(f"/api/products/{product['id']}", headers=auth_headers).json()
    assert prod["quantity"] == 5


def test_void_sent_item_restores_stock_and_no_double_restore_on_cancel(auth_headers):
    table = _create_table(auth_headers, f"VTS{uuid.uuid4().hex[:4]}")
    product = _create_menu_product(auth_headers, f"VTSP{uuid.uuid4().hex[:4]}", qty=10, price=150.0)
    ticket = _open_ticket(auth_headers, table["id"])
    _add_item(auth_headers, ticket["id"], product["id"], quantity=3)
    assert client.post(f"/api/restaurant/tickets/{ticket['id']}/send", headers=auth_headers).status_code == 200
    item_id = _item_ids(auth_headers, ticket["id"])[product["id"]]

    resp = client.post(
        f"/api/restaurant/tickets/{ticket['id']}/items/{item_id}/void",
        json={"reason": "Kitchen returned it"}, headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    prod = client.get(f"/api/products/{product['id']}", headers=auth_headers).json()
    assert prod["quantity"] == 10

    # Cancelling the ticket later must not restore the voided item again.
    cancelled = client.post(f"/api/restaurant/tickets/{ticket['id']}/cancel", headers=auth_headers)
    assert cancelled.status_code == 200, cancelled.text
    prod = client.get(f"/api/products/{product['id']}", headers=auth_headers).json()
    assert prod["quantity"] == 10


def test_void_sent_recipe_item_restores_component_stock(auth_headers):
    menu_item = _create_menu_product(auth_headers, f"VTRC{uuid.uuid4().hex[:4]}", qty=100, price=200.0)
    comp = _create_component(auth_headers, f"VTRCP{uuid.uuid4().hex[:4]}", qty=10, price=30.0)
    _attach_recipe(auth_headers, menu_item["id"], [comp["id"]])

    ticket = _open_ticket(auth_headers)
    _add_item(auth_headers, ticket["id"], menu_item["id"], quantity=3)
    assert client.post(f"/api/restaurant/tickets/{ticket['id']}/send", headers=auth_headers).status_code == 200
    item_id = _item_ids(auth_headers, ticket["id"])[menu_item["id"]]

    resp = client.post(
        f"/api/restaurant/tickets/{ticket['id']}/items/{item_id}/void",
        json={"reason": "Overcooked"}, headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    comp_data = client.get(f"/api/products/{comp['id']}", headers=auth_headers).json()
    assert comp_data["quantity"] == 10


def test_void_shape_validation(auth_headers):
    table = _create_table(auth_headers, f"VTV{uuid.uuid4().hex[:4]}")
    product = _create_menu_product(auth_headers, f"VTVP{uuid.uuid4().hex[:4]}", qty=5)
    ticket = _open_ticket(auth_headers, table["id"])
    _add_item(auth_headers, ticket["id"], product["id"])
    item_id = _item_ids(auth_headers, ticket["id"])[product["id"]]

    # Reason longer than 200 chars is rejected.
    resp = client.post(
        f"/api/restaurant/tickets/{ticket['id']}/items/{item_id}/void",
        json={"reason": "x" * 300}, headers=auth_headers,
    )
    assert resp.status_code == 422

    # Void is rejected once the ticket is settled.
    _settle_ticket(auth_headers, ticket["id"])
    resp = client.post(
        f"/api/restaurant/tickets/{ticket['id']}/items/{item_id}/void",
        json={"reason": "late"}, headers=auth_headers,
    )
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Bill splitting
# ---------------------------------------------------------------------------

def test_split_moves_items_to_child_ticket(auth_headers):
    table = _create_table(auth_headers, f"SP1{uuid.uuid4().hex[:4]}")
    p1 = _create_menu_product(auth_headers, f"SP1A{uuid.uuid4().hex[:4]}", qty=10, price=80.0)
    p2 = _create_menu_product(auth_headers, f"SP1B{uuid.uuid4().hex[:4]}", qty=10, price=120.0)
    ticket = _open_ticket(auth_headers, table["id"])
    _add_item(auth_headers, ticket["id"], p1["id"], quantity=2)
    _add_item(auth_headers, ticket["id"], p2["id"], quantity=1)
    ids = _item_ids(auth_headers, ticket["id"])
    p1_item, p2_item = ids[p1["id"]], ids[p2["id"]]

    resp = client.post(
        f"/api/restaurant/tickets/{ticket['id']}/split",
        json={"item_ids": [p2_item], "customer_name": "Alice"}, headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    child = resp.json()
    assert child["table_id"] == table["id"]
    assert child["customer_name"] == "Alice"
    assert child["split_parent_id"] == ticket["id"]
    assert child["split_group"] is not None
    assert child["total_amount"] == 120.0
    assert child["item_count"] == 1

    parent = client.get(f"/api/restaurant/tickets/{ticket['id']}", headers=auth_headers).json()
    assert parent["total_amount"] == 160.0
    assert parent["item_count"] == 2
    child_data = client.get(f"/api/restaurant/tickets/{child['id']}", headers=auth_headers).json()
    moved = [i for i in child_data["items"] if i["id"] == p2_item]
    remained = [i for i in parent["items"] if i["id"] == p1_item]
    assert len(moved) == 1 and moved[0]["quantity"] == 1
    assert len(remained) == 1 and remained[0]["quantity"] == 2


def test_split_rejects_invalid_selections(auth_headers):
    table = _create_table(auth_headers, f"SP2{uuid.uuid4().hex[:4]}")
    product = _create_menu_product(auth_headers, f"SP2A{uuid.uuid4().hex[:4]}", qty=10, price=50.0)
    ticket = _open_ticket(auth_headers, table["id"])
    _add_item(auth_headers, ticket["id"], product["id"], quantity=1)
    item_id = _item_ids(auth_headers, ticket["id"])[product["id"]]

    # Moving every item is rejected - an empty original bill makes no sense.
    resp = client.post(
        f"/api/restaurant/tickets/{ticket['id']}/split",
        json={"item_ids": [item_id]}, headers=auth_headers,
    )
    assert resp.status_code == 400

    # Foreign item ids are rejected.
    resp = client.post(
        f"/api/restaurant/tickets/{ticket['id']}/split",
        json={"item_ids": [999999]}, headers=auth_headers,
    )
    assert resp.status_code == 400

    # Splitting a settled ticket is rejected.
    _settle_ticket(auth_headers, ticket["id"])
    resp = client.post(
        f"/api/restaurant/tickets/{ticket['id']}/split",
        json={"item_ids": [item_id]}, headers=auth_headers,
    )
    assert resp.status_code == 400


def test_split_permission(auth_headers):
    table = _create_table(auth_headers, f"SP3{uuid.uuid4().hex[:4]}")
    product_a = _create_menu_product(auth_headers, f"SP3A{uuid.uuid4().hex[:4]}", qty=10, price=50.0)
    product_b = _create_menu_product(auth_headers, f"SP3B{uuid.uuid4().hex[:4]}", qty=10, price=60.0)
    ticket = _open_ticket(auth_headers, table["id"])
    _add_item(auth_headers, ticket["id"], product_a["id"], quantity=2)
    _add_item(auth_headers, ticket["id"], product_b["id"], quantity=1)
    ids = _item_ids(auth_headers, ticket["id"])

    resp = client.post(
        f"/api/restaurant/tickets/{ticket['id']}/split",
        json={"item_ids": [ids[product_b["id"]]]}, headers=_auth("supplier"),
    )
    assert resp.status_code == 403
    # untouched
    parent = client.get(f"/api/restaurant/tickets/{ticket['id']}", headers=auth_headers).json()
    assert parent["item_count"] == 3
    assert set(ids.values()) == {i["id"] for i in parent["items"]}


def test_split_second_child_reuses_group(auth_headers):
    table = _create_table(auth_headers, f"SP4{uuid.uuid4().hex[:4]}")
    p1 = _create_menu_product(auth_headers, f"SP4A{uuid.uuid4().hex[:4]}", qty=10, price=40.0)
    p2 = _create_menu_product(auth_headers, f"SP4B{uuid.uuid4().hex[:4]}", qty=10, price=60.0)
    p3 = _create_menu_product(auth_headers, f"SP4C{uuid.uuid4().hex[:4]}", qty=10, price=90.0)
    ticket = _open_ticket(auth_headers, table["id"])
    _add_item(auth_headers, ticket["id"], p1["id"], quantity=1)
    _add_item(auth_headers, ticket["id"], p2["id"], quantity=1)
    _add_item(auth_headers, ticket["id"], p3["id"], quantity=1)
    ids = _item_ids(auth_headers, ticket["id"])

    resp1 = client.post(
        f"/api/restaurant/tickets/{ticket['id']}/split",
        json={"item_ids": [ids[p2["id"]]], "customer_name": "Bob"}, headers=auth_headers,
    )
    assert resp1.status_code == 201, resp1.text
    child1 = resp1.json()
    assert child1["split_parent_id"] == ticket["id"]

    resp2 = client.post(
        f"/api/restaurant/tickets/{ticket['id']}/split",
        json={"item_ids": [ids[p3["id"]]], "customer_name": "Carol"}, headers=auth_headers,
    )
    assert resp2.status_code == 201, resp2.text
    child2 = resp2.json()
    # Both children share the same group reference so the guest view can link them.
    assert child2["split_group"] == child1["split_group"]
    assert child1["split_group"] is not None

    parent = client.get(f"/api/restaurant/tickets/{ticket['id']}", headers=auth_headers).json()
    assert parent["split_group"] == child1["split_group"]
    assert parent["total_amount"] == 40.0


def test_stale_paying_ticket_is_auto_cancelled(auth_headers):
    from tests.conftest import TestingSessionLocal
    from app.models.restaurant import RestaurantTicket

    product = _create_menu_product(auth_headers, f"STALE{uuid.uuid4().hex[:4]}", qty=5, price=80.0)
    ticket = _open_ticket(auth_headers)
    _add_item(auth_headers, ticket["id"], product["id"], quantity=1)

    resp = client.post(
        f"/api/restaurant/tickets/{ticket['id']}/settle",
        json={"payment_method": "mobile_money", "payment_provider": "m-pesa"},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "paying"
    sale_id = resp.json()["sale_id"]
    assert sale_id is not None

    db = TestingSessionLocal()
    try:
        db_ticket = db.query(RestaurantTicket).filter(RestaurantTicket.id == ticket["id"]).first()
        db_ticket.updated_at = datetime.now(timezone.utc) - timedelta(minutes=30)
        db.commit()
    finally:
        db.close()

    listed = client.get("/api/restaurant/tickets", headers=auth_headers).json()
    reaped = next((t for t in listed["items"] if t["id"] == ticket["id"]), None)
    assert reaped is not None
    assert reaped["status"] == "cancelled"

    sale = client.get(f"/api/sales/{sale_id}", headers=auth_headers).json()
    assert sale["status"] == "cancelled"

    prod = client.get(f"/api/products/{product['id']}", headers=auth_headers).json()
    assert prod["quantity"] == 5