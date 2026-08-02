from datetime import date, timedelta

from tests.conftest import client


def test_dashboard_stats_counts_and_values(auth_headers):
    cat = client.post("/api/categories", json={"name": "Dash Cat"}, headers=auth_headers).json()
    client.post("/api/products", json={
        "sku": "DASH-001", "name": "Dash Item", "category_id": cat["id"],
        "quantity": 5, "cost_price": 10.0, "unit_price": 25.0,
    }, headers=auth_headers)
    resp = client.get("/api/dashboard/stats", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_products"] >= 1
    assert data["total_categories"] >= 1
    assert data["total_inventory_value"] == 50.0


def test_dashboard_low_stock_and_expiring(auth_headers):
    client.post("/api/products", json={"sku": "DASH-LOW", "name": "Low", "quantity": 2, "reorder_level": 10, "cost_price": 1.0}, headers=auth_headers)
    client.post("/api/products", json={
        "sku": "DASH-EXP", "name": "Expiring", "quantity": 10, "cost_price": 1.0,
        "expiry_date": (date.today() + timedelta(days=7)).isoformat(), "batch_number": "B1",
    }, headers=auth_headers)
    data = client.get("/api/dashboard/stats", headers=auth_headers).json()
    assert data["low_stock_count"] >= 1
    assert any(p["sku"] == "DASH-LOW" for p in data["low_stock_products"])
    assert data["expiring_soon_count"] >= 1
    assert any(p["sku"] == "DASH-EXP" for p in data["expiring_products"])
    assert data["expiring_products"][0]["batch_number"] == "B1"


def test_dashboard_movement_today(auth_headers):
    prod = client.post("/api/products", json={"sku": "DASH-MOV", "name": "Move", "quantity": 5, "cost_price": 1.0}, headers=auth_headers).json()
    client.post("/api/stock-movements", json={
        "product_id": prod["id"], "quantity_change": -1, "movement_type": "out",
    }, headers=auth_headers)
    data = client.get("/api/dashboard/stats", headers=auth_headers).json()
    assert data["total_stock_movements_today"] >= 1
    assert any(m["product_name"] == "Move" for m in data["recent_movements"])
