from datetime import datetime, timedelta, timezone

from tests.conftest import client

from app.services.forecasting import (
    forecast_daily_demand,
    reorder_point,
    safety_stock,
    seasonal_factors,
    suggested_order_qty,
    weighted_moving_average,
    z_score,
)


def _today():
    return datetime.now(timezone.utc).date()


def _series(quantities: dict[int, int], days: int = 90) -> dict[str, int]:
    today = _today()
    return {
        (today - timedelta(days=days - 1 - i)).isoformat(): quantities.get(i, 0)
        for i in range(days)
    }


# ---- pure math --------------------------------------------------------------


def test_z_score_interpolation():
    assert z_score(0.95) == 1.645
    assert z_score(0.99) == 2.326
    assert abs(z_score(0.925) - (1.282 + 1.645) / 2) < 0.001
    assert z_score(0.5) == 0.842
    assert z_score(0.9999) >= 3.09


def test_weighted_moving_average_uniform():
    series = _series({i: 4 for i in range(90)})
    assert weighted_moving_average(series) == 4.0


def test_weighted_moving_average_weights_recent():
    # Demand only in the last bucket (indices 66..89) → WMA = q * 4/10
    series = _series({i: 5 for i in range(66, 90)})
    assert round(weighted_moving_average(series), 3) == 2.0


def test_weighted_moving_average_empty():
    assert weighted_moving_average({}) == 0.0


def test_seasonal_factors_uniform():
    series = _series({i: 3 for i in range(90)})
    factors = seasonal_factors(series)
    assert all(factors[w] == 1.0 for w in range(7))


def test_seasonal_factors_empty():
    assert all(seasonal_factors({})[w] == 1.0 for w in range(7))


def test_forecast_daily_demand_uniform():
    series = _series({i: 6 for i in range(90)})
    out = forecast_daily_demand(series)
    assert out["baseline"] == 6.0
    assert out["forecast"] == 6.0
    assert out["stddev"] == 0.0


def test_forecast_daily_demand_no_seasonality():
    series = _series({i: 8 for i in range(90)})
    out = forecast_daily_demand(series, use_seasonality=False)
    assert out["forecast"] == out["baseline"] == 8.0


def test_safety_stock_formula():
    # z(0.95)=1.645, sqrt(9)=3 → 1.645 * 10 * 3 = 49.35 → 49
    assert safety_stock(0.95, 10, 9) == 49
    assert safety_stock(0.95, 0, 7) == 0


def test_reorder_point():
    assert reorder_point(5.0, 7, 10) == 45
    assert reorder_point(0.0, 7, 0) == 0


def test_suggested_order_qty():
    # target = 5 * 7 + 10 = 45 → 45 - 30 - 5 = 10
    assert suggested_order_qty(5.0, 7, 10, 30, 5) == 10
    # stock already covers the target → no order
    assert suggested_order_qty(5.0, 7, 10, 50, 5) == 0
    # open orders count toward coverage
    assert suggested_order_qty(5.0, 7, 10, 10, 40) == 0


# ---- API --------------------------------------------------------------------


def _make_product(auth_headers, sku, name, **overrides):
    body = {"location_id": 1, "sku": sku, "name": name, "quantity": 50, **overrides}
    resp = client.post("/api/products", json=body, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_replenishment_empty(auth_headers):
    resp = client.get("/api/forecasting/replenishment", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["items"] == []
    assert data["summary"]["products"] == 0


def test_replenishment_computes_metrics(auth_headers):
    prod = _make_product(auth_headers, "FC-001", "Forecast Item")
    # Sell 5 units to create demand and leave 45 on hand.
    client.post("/api/sales", json={
        "items": [{"product_id": prod["id"], "quantity": 5, "unit_price": 10.0}],
    }, headers=auth_headers)

    resp = client.get("/api/forecasting/replenishment", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    row = next(i for i in data["items"] if i["product_id"] == prod["id"])
    assert row["on_hand"] == 45
    assert row["forecast"] > 0
    assert row["stddev"] >= 0
    assert row["safety_stock"] >= 0
    assert row["reorder_point"] >= row["safety_stock"]
    assert row["lead_time_days"] >= 1
    assert row["lead_time_source"] in ("supplier", "history", "default")
    assert row["suggested_order_qty"] >= 0
    assert row["status"] in ("reorder", "ok")
    assert data["summary"]["products"] >= 1


def test_replenishment_supplier_lead_time(auth_headers):
    sup = client.post("/api/suppliers", json={
        "name": "Lead Supplier", "lead_time_days": 12,
    }, headers=auth_headers).json()
    assert sup["lead_time_days"] == 12
    prod = _make_product(auth_headers, "FC-LT", "LT Item", supplier_id=sup["id"])

    resp = client.get("/api/forecasting/replenishment", headers=auth_headers)
    row = next(i for i in resp.json()["items"] if i["product_id"] == prod["id"])
    assert row["lead_time_days"] == 12
    assert row["lead_time_source"] == "supplier"


def test_replenishment_lead_time_override(auth_headers):
    prod = _make_product(auth_headers, "FC-OV", "Override Item")
    resp = client.get(
        "/api/forecasting/replenishment",
        params={"lead_time_days": 20},
        headers=auth_headers,
    )
    row = next(i for i in resp.json()["items"] if i["product_id"] == prod["id"])
    assert row["lead_time_days"] == 20
    assert row["lead_time_source"] == "override"


def test_replenishment_excludes_variant_parents(auth_headers):
    parent = client.post("/api/products", json={
        "location_id": 1, "sku": "FC-PARENT", "name": "FC Parent",
    }, headers=auth_headers).json()
    client.post("/api/products", json={
        "location_id": 1, "sku": "FC-VAR", "parent_id": parent["id"],
        "name": "FC Variant", "attributes": {"Color": "Red"}, "quantity": 10,
    }, headers=auth_headers)
    data = client.get("/api/forecasting/replenishment", headers=auth_headers).json()
    ids = [i["product_id"] for i in data["items"]]
    assert parent["id"] not in ids


def test_product_detail_series(auth_headers):
    prod = _make_product(auth_headers, "FC-DET", "Detail Item")
    client.post("/api/sales", json={
        "items": [{"product_id": prod["id"], "quantity": 3, "unit_price": 5.0}],
    }, headers=auth_headers)

    resp = client.get(f"/api/forecasting/products/{prod['id']}", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["product_id"] == prod["id"]
    assert len(data["daily"]) == 90
    assert len(data["forecast_series"]) >= 7
    assert len(data["factors"]) == 7
    assert data["suggested_order_qty"] >= 0
    assert any(d["quantity"] > 0 for d in data["daily"])


def test_product_detail_not_found(auth_headers):
    resp = client.get("/api/forecasting/products/999999", headers=auth_headers)
    assert resp.status_code == 404


def test_auto_reorder_uses_forecast(auth_headers):
    # Sell everything so on hand = 0 and forecast demand exists.
    prod = _make_product(auth_headers, "FC-AR", "Auto Reorder Item", quantity=5)
    client.post("/api/sales", json={
        "items": [{"product_id": prod["id"], "quantity": 5, "unit_price": 10.0}],
    }, headers=auth_headers)

    resp = client.post("/api/orders/auto-reorder", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    orders = resp.json()
    assert isinstance(orders, list)
    assert len(orders) == 1
    order = orders[0]
    assert order["status"] == "pending"
    assert any(i["product_id"] == prod["id"] for i in order["items"])
    item = next(i for i in order["items"] if i["product_id"] == prod["id"])
    assert item["quantity"] >= 1


def test_auto_reorder_places_supplier_on_po(auth_headers):
    # Create a supplier, a serialized-free product linked to it, sell everything,
    # and confirm the generated PO carries the product's default supplier.
    supplier = client.post("/api/suppliers", json={"name": "FC Suppliers Inc."}, headers=auth_headers).json()
    prod = _make_product(auth_headers, "FC-SUP", "Supplier Item", quantity=5, supplier_id=supplier["id"])
    client.post("/api/sales", json={
        "items": [{"product_id": prod["id"], "quantity": 5, "unit_price": 10.0}],
    }, headers=auth_headers)

    resp = client.post("/api/orders/auto-reorder", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    order = resp.json()[0]
    assert order["supplier_id"] == supplier["id"]
    assert order["supplier_name"] == "FC Suppliers Inc."


def test_auto_reorder_groups_by_supplier(auth_headers):
    sup_a = client.post("/api/suppliers", json={"name": "Supplier A" }, headers=auth_headers).json()
    sup_b = client.post("/api/suppliers", json={"name": "Supplier B" }, headers=auth_headers).json()
    prod_a = _make_product(auth_headers, "FC-GA", "Group A Item", quantity=5, supplier_id=sup_a["id"])
    prod_b = _make_product(auth_headers, "FC-GB", "Group B Item", quantity=5, supplier_id=sup_b["id"])
    client.post("/api/sales", json={
        "items": [
            {"product_id": prod_a["id"], "quantity": 5, "unit_price": 10.0},
            {"product_id": prod_b["id"], "quantity": 5, "unit_price": 10.0},
        ],
    }, headers=auth_headers)

    resp = client.post("/api/orders/auto-reorder", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    orders = resp.json()
    assert len(orders) == 2
    by_supplier = {o["supplier_id"]: o for o in orders}
    assert by_supplier[sup_a["id"]]["supplier_name"] == "Supplier A"
    assert by_supplier[sup_b["id"]]["supplier_name"] == "Supplier B"
    assert any(i["product_id"] == prod_a["id"] for i in by_supplier[sup_a["id"]]["items"])
    assert any(i["product_id"] == prod_b["id"] for i in by_supplier[sup_b["id"]]["items"])


def test_auto_reorder_none_needed(auth_headers):
    # Abundant stock with no demand → nothing to reorder.
    _make_product(auth_headers, "FC-NONE", "No Reorder Item", quantity=500)
    resp = client.post("/api/orders/auto-reorder", headers=auth_headers)
    assert resp.status_code == 400
    assert "reorder" in resp.json()["detail"]
