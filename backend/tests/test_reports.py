from tests.conftest import client


def test_inventory_valuation(auth_headers):
    cat = client.post("/api/categories", json={"name": "Val Cat"}, headers=auth_headers).json()
    sup = client.post("/api/suppliers", json={"name": "Val Supplier"}, headers=auth_headers).json()
    client.post("/api/products", json={"location_id": 1, 
        "sku": "VAL-001", "name": "Val Item", "category_id": cat["id"], "supplier_id": sup["id"],
        "quantity": 10, "cost_price": 5.0, "unit_price": 12.0,
    }, headers=auth_headers)
    resp = client.get("/api/reports/inventory-valuation", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_inventory_value"] == 50.0
    assert data["total_retail_value"] == 120.0
    assert data["potential_profit"] == 70.0
    cats = [c for c in data["by_category"] if c["category"] == "Val Cat"]
    assert cats and cats[0]["product_count"] == 1 and cats[0]["total_stock"] == 10
    sups = [s for s in data["by_supplier"] if s["supplier"] == "Val Supplier"]
    assert sups and sups[0]["product_count"] == 1 and sups[0]["total_stock"] == 10


def test_profit_analysis_excludes_parents_with_variants(auth_headers):
    parent = client.post("/api/products", json={"location_id": 1, "sku": "PROF-PARENT", "name": "Parent", "unit_price": 20.0, "cost_price": 10.0}, headers=auth_headers).json()
    var = client.post("/api/products", json={"location_id": 1, 
        "sku": "PROF-VAR", "parent_id": parent["id"], "quantity": 4,
        "attributes": {"Color": "Red"}, "unit_price": 25.0, "cost_price": 10.0,
    }, headers=auth_headers).json()
    data = client.get("/api/reports/profit-analysis", headers=auth_headers).json()
    ids = [p["id"] for p in data["products"]]
    assert parent["id"] not in ids
    assert var["id"] in ids
    row = next(p for p in data["products"] if p["id"] == var["id"])
    assert row["total_revenue"] == 100.0
    assert row["total_profit"] == 60.0


def test_category_breakdown(auth_headers):
    cat = client.post("/api/categories", json={"name": "Brk Cat"}, headers=auth_headers).json()
    client.post("/api/products", json={"location_id": 1, 
        "sku": "BRK-001", "name": "Brk Item", "category_id": cat["id"],
        "quantity": 3, "cost_price": 2.0, "unit_price": 8.0,
    }, headers=auth_headers)
    data = client.get("/api/reports/category-breakdown", headers=auth_headers)
    rows = [r for r in data.json() if r["name"] == "Brk Cat"]
    assert rows and rows[0]["product_count"] == 1 and rows[0]["total_stock"] == 3
    assert rows[0]["total_cost_value"] == 6.0 and rows[0]["total_retail_value"] == 24.0


def test_top_customers_report(auth_headers):
    c = client.post("/api/customers", json={"name": "Top Spender"}, headers=auth_headers).json()
    prod = client.post("/api/products", json={"location_id": 1, "sku": "TOP-1", "name": "Top Item", "quantity": 50, "unit_price": 5.0}, headers=auth_headers).json()
    for _ in range(3):
        client.post("/api/sales", json={"customer_id": c["id"], "items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 50.0}]}, headers=auth_headers)
    data = client.get("/api/reports/top-customers", headers=auth_headers).json()
    row = next(i for i in data["items"] if i["customer_id"] == c["id"])
    assert row["total_sales"] == 3
    assert row["total_spent"] > 0
    assert row["last_purchase_at"] is not None


def test_top_suppliers_report(auth_headers):
    sup = client.post("/api/suppliers", json={"name": "Top Supplier"}, headers=auth_headers).json()
    prod = client.post("/api/products", json={"location_id": 1, "sku": "TSUP-1", "name": "TSup", "cost_price": 10.0}, headers=auth_headers).json()
    order = client.post("/api/orders", json={
        "supplier_id": sup["id"],
        "items": [{"product_id": prod["id"], "quantity": 4, "unit_price": 10.0}],
    }, headers=auth_headers).json()
    client.put(f"/api/orders/{order['id']}", json={"status": "received"}, headers=auth_headers)
    data = client.get("/api/reports/top-suppliers", headers=auth_headers).json()
    row = next(i for i in data["items"] if i["supplier_id"] == sup["id"])
    assert row["total_orders"] == 1
    assert row["total_spent"] == 40.0
    assert row["last_order_at"] is not None


def test_order_summary(auth_headers):
    sup = client.post("/api/suppliers", json={"name": "Ord Sup"}, headers=auth_headers).json()
    prod = client.post("/api/products", json={"location_id": 1, "sku": "OSUM-001", "name": "OSum", "cost_price": 5.0}, headers=auth_headers).json()
    client.post("/api/orders", json={"supplier_id": sup["id"], "items": [{"product_id": prod["id"], "quantity": 4, "unit_price": 5.0}]}, headers=auth_headers)
    data = client.get("/api/reports/order-summary", headers=auth_headers).json()
    assert data["total_orders"] >= 1
    assert data["total_order_value"] >= 20.0
    assert any(s["status"] == "pending" for s in data["by_status"])
    assert any(s["supplier"] == "Ord Sup" for s in data["top_suppliers"])


def test_sales_summary_with_refund(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, "sku": "SSUM-001", "name": "SSum", "unit_price": 50.0, "quantity": 10}, headers=auth_headers).json()
    sale = client.post("/api/sales", json={"items": [{"product_id": prod["id"], "quantity": 2, "unit_price": 50.0}], "payment_method": "card"}, headers=auth_headers).json()
    data = client.get("/api/reports/sales-summary", headers=auth_headers).json()
    assert data["total_sales"] == 1
    assert data["total_revenue"] == 100.0
    assert data["by_payment_method"] == [{"method": "card", "count": 1}]
    client.put(f"/api/sales/{sale['id']}/refund", headers=auth_headers)
    data = client.get("/api/reports/sales-summary", headers=auth_headers).json()
    assert data["total_sales"] == 0
    assert data["total_refunds"] == 1
    assert data["total_revenue"] == 0.0


def test_sales_summary_top_products_respects_date_range(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, "sku": "TPTOP-001", "name": "TP Top Item", "unit_price": 30.0, "quantity": 5}, headers=auth_headers).json()
    client.post("/api/sales", json={"items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 30.0}]}, headers=auth_headers)
    future = client.get("/api/reports/sales-summary", params={"start_date": "2099-01-01"}, headers=auth_headers).json()
    assert all(t["name"] != "TP Top Item" for t in future["top_products"])
    past = client.get("/api/reports/sales-summary", params={"start_date": "2020-01-01"}, headers=auth_headers).json()
    assert any(t["name"] == "TP Top Item" for t in past["top_products"])


def test_stock_movement_trends(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, "sku": "TREND-001", "name": "Trend", "quantity": 5, "cost_price": 1.0}, headers=auth_headers).json()
    client.post("/api/stock-movements", json={"product_id": prod["id"], "quantity_change": -2, "movement_type": "out"}, headers=auth_headers)
    client.post("/api/stock-movements", json={"product_id": prod["id"], "quantity_change": 3, "movement_type": "in"}, headers=auth_headers)
    data = client.get("/api/reports/stock-movement-trends", headers=auth_headers).json()
    assert data["total_in"] == 8
    assert data["total_out"] == 2
    assert data["net_movement"] == 6


def test_stock_movement_trends_counts_transfer_pair_once(auth_headers):
    src = client.post("/api/locations", json={"name": "Trend Src", "code": "TRS"}, headers=auth_headers).json()
    dst = client.post("/api/locations", json={"name": "Trend Dst", "code": "TRD"}, headers=auth_headers).json()
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "TREND-TRF", "name": "Trend Transfer", "quantity": 0, "unit_price": 1.0, "cost_price": 1.0,
    }, headers=auth_headers).json()
    client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 10, "location_id": src["id"]}],
    }, headers=auth_headers)
    client.post("/api/stock-movements/transfer", json={
        "product_id": prod["id"], "quantity": 4, "from_location_id": src["id"], "to_location_id": dst["id"],
    }, headers=auth_headers)
    data = client.get("/api/reports/stock-movement-trends", headers=auth_headers).json()
    assert data["total_in"] == 14
    assert data["total_out"] == 0
    assert data["net_movement"] == 14


def test_report_exports(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, "sku": "EXP-001", "name": "Export Item", "quantity": 1, "cost_price": 1.0}, headers=auth_headers).json()
    client.post("/api/sales", json={"items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 10.0}]}, headers=auth_headers)
    client.post("/api/orders", json={"items": [{"product_id": prod["id"], "quantity": 2, "unit_price": 1.0}]}, headers=auth_headers)
    for path in ("/api/reports/export/sales", "/api/reports/export/movements", "/api/reports/export/products", "/api/reports/export/orders", "/api/reports/export/locations"):
        resp = client.get(path, headers=auth_headers)
        assert resp.status_code == 200
        assert "text/csv" in resp.headers["content-type"]


def test_export_orders_respects_search(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, "sku": "EXP-ORD", "name": "Export Order Item", "cost_price": 1.0}, headers=auth_headers).json()
    first = client.post("/api/orders", json={"items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 1.0}]}, headers=auth_headers).json()
    second = client.post("/api/orders", json={"items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 1.0}]}, headers=auth_headers).json()
    resp = client.get("/api/reports/export/orders", params={"search": first["order_number"]}, headers=auth_headers)
    assert resp.status_code == 200
    body = resp.content.decode("utf-8")
    assert first["order_number"] in body
    assert second["order_number"] not in body


def test_export_locations_respects_search(auth_headers):
    client.post("/api/locations", json={"name": "Export Bin One", "code": "EXP-LOC-1"}, headers=auth_headers)
    client.post("/api/locations", json={"name": "Export Bin Two", "code": "EXP-LOC-2"}, headers=auth_headers)
    resp = client.get("/api/reports/export/locations", params={"search": "EXP-LOC-1"}, headers=auth_headers)
    assert resp.status_code == 200
    body = resp.content.decode("utf-8")
    assert "EXP-LOC-1" in body
    assert "EXP-LOC-2" not in body
    assert "Stock Lines" in body
