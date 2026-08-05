from tests.conftest import client


def test_get_settings_defaults(auth_headers):
    resp = client.get("/api/settings", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["store_name"] == "My Store"
    assert data["currency_symbol"] == "$"
    assert data["tax_rate"] == 0.0
    assert data["default_reorder_level"] == 10


def test_default_reorder_level_applies_to_new_products(auth_headers):
    client.put("/api/settings", json={"default_reorder_level": 25}, headers=auth_headers)
    prod = client.post("/api/products", json={"location_id": 1, "sku": "REORDER-1", "name": "Reorder Item"}, headers=auth_headers).json()
    assert prod["reorder_level"] == 25


def test_explicit_reorder_level_overrides_default(auth_headers):
    client.put("/api/settings", json={"default_reorder_level": 25}, headers=auth_headers)
    prod = client.post("/api/products", json={"location_id": 1, "sku": "REORDER-2", "name": "Reorder Item", "reorder_level": 5}, headers=auth_headers).json()
    assert prod["reorder_level"] == 5


def test_default_reorder_level_applies_to_csv_import(auth_headers):
    client.put("/api/settings", json={"default_reorder_level": 30}, headers=auth_headers)
    csv_data = "sku,name,quantity,location\nCSV-REORDER-1,CSV Reorder Item,0,Default Location\n"
    resp = client.post("/api/products/import-csv", files={"file": ("products.csv", csv_data, "text/csv")}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["created"] == 1
    prod = client.get("/api/products?search=CSV-REORDER-1", headers=auth_headers).json()
    items = prod["items"]
    assert len(items) == 1
    assert items[0]["reorder_level"] == 30


def test_csv_reorder_level_column_overrides_default(auth_headers):
    client.put("/api/settings", json={"default_reorder_level": 30}, headers=auth_headers)
    csv_data = "sku,name,quantity,reorder_level,location\nCSV-REORDER-2,CSV Reorder Item 2,0,12,Default Location\n"
    resp = client.post("/api/products/import-csv", files={"file": ("products.csv", csv_data, "text/csv")}, headers=auth_headers)
    assert resp.status_code == 200
    prod = client.get("/api/products?search=CSV-REORDER-2", headers=auth_headers).json()
    items = prod["items"]
    assert len(items) == 1
    assert items[0]["reorder_level"] == 12


def test_update_settings(auth_headers):
    resp = client.put("/api/settings", json={"store_name": "Inventura Storage", "tax_rate": 10.0}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["store_name"] == "Inventura Storage"
    assert resp.json()["tax_rate"] == 10.0


def test_settings_tax_rate_applies_to_sales(auth_headers):
    client.put("/api/settings", json={"tax_rate": 10.0}, headers=auth_headers)
    prod = client.post("/api/products", json={"location_id": 1, "sku": "TAX-001", "name": "Tax Item", "unit_price": 100.0, "quantity": 5}, headers=auth_headers).json()
    sale = client.post("/api/sales", json={"items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 100.0}]}, headers=auth_headers).json()
    assert sale["subtotal"] == 100.0
    assert sale["tax_amount"] == 10.0
    assert sale["total_amount"] == 110.0


def test_worker_cannot_update_settings(auth_headers):
    client.post("/api/users", json={"username": "worker3", "email": "worker3@example.com", "password": "testpass123", "role": "worker"}, headers=auth_headers)
    token = client.post("/api/auth/login", json={"username": "worker3", "password": "testpass123"}).json()["access_token"]
    resp = client.put("/api/settings", json={"store_name": "Hacked"}, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


def test_worker_can_get_settings(auth_headers):
    client.post("/api/users", json={"username": "worker5", "email": "worker5@example.com", "password": "testpass123", "role": "worker"}, headers=auth_headers)
    token = client.post("/api/auth/login", json={"username": "worker5", "password": "testpass123"}).json()["access_token"]
    resp = client.get("/api/settings", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert "currency_symbol" in resp.json()
