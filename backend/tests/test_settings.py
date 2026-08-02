from tests.conftest import client


def test_get_settings_defaults(auth_headers):
    resp = client.get("/api/settings", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["store_name"] == "My Store"
    assert data["currency_symbol"] == "$"
    assert data["tax_rate"] == 0.0
    assert data["default_reorder_level"] == 10


def test_update_settings(auth_headers):
    resp = client.put("/api/settings", json={"store_name": "Inventura Storage", "tax_rate": 10.0}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["store_name"] == "Inventura Storage"
    assert resp.json()["tax_rate"] == 10.0


def test_settings_tax_rate_applies_to_sales(auth_headers):
    client.put("/api/settings", json={"tax_rate": 10.0}, headers=auth_headers)
    prod = client.post("/api/products", json={"sku": "TAX-001", "name": "Tax Item", "unit_price": 100.0, "quantity": 5}, headers=auth_headers).json()
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
