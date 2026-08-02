from tests.conftest import client


def test_create_product(auth_headers):
    resp = client.post("/api/products", json={
        "sku": "SKU001",
        "name": "Test Product",
        "unit_price": 19.99,
        "cost_price": 10.00,
        "quantity": 100,
        "reorder_level": 10,
    }, headers=auth_headers)
    assert resp.status_code == 201
    data = resp.json()
    assert data["sku"] == "SKU001"
    assert data["name"] == "Test Product"


def test_create_duplicate_sku(auth_headers):
    client.post("/api/products", json={"sku": "SKU002", "name": "Product 2"}, headers=auth_headers)
    resp = client.post("/api/products", json={"sku": "SKU002", "name": "Product 2 Dup"}, headers=auth_headers)
    assert resp.status_code == 400


def test_list_products(auth_headers):
    client.post("/api/products", json={"sku": "SKU003", "name": "Alpha"}, headers=auth_headers)
    client.post("/api/products", json={"sku": "SKU004", "name": "Beta"}, headers=auth_headers)
    resp = client.get("/api/products", headers=auth_headers)
    assert resp.status_code == 200
    assert len(resp.json()["items"]) >= 2


def test_search_products(auth_headers):
    client.post("/api/products", json={"sku": "SRCH01", "name": "Searchable Item"}, headers=auth_headers)
    resp = client.get("/api/products?search=Searchable", headers=auth_headers)
    assert resp.status_code == 200
    assert any(p["name"] == "Searchable Item" for p in resp.json()["items"])


def test_get_product(auth_headers):
    create = client.post("/api/products", json={"sku": "SKU005", "name": "Get Me"}, headers=auth_headers)
    pid = create.json()["id"]
    resp = client.get(f"/api/products/{pid}", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["name"] == "Get Me"


def test_get_product_not_found(auth_headers):
    resp = client.get("/api/products/99999", headers=auth_headers)
    assert resp.status_code == 404


def test_update_product(auth_headers):
    create = client.post("/api/products", json={"sku": "SKU006", "name": "Original"}, headers=auth_headers)
    pid = create.json()["id"]
    resp = client.put(f"/api/products/{pid}", json={"name": "Updated", "unit_price": 25.00}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["name"] == "Updated"
    assert resp.json()["unit_price"] == 25.0


def test_delete_product(auth_headers):
    create = client.post("/api/products", json={"sku": "SKU007", "name": "Delete Me"}, headers=auth_headers)
    pid = create.json()["id"]
    resp = client.delete(f"/api/products/{pid}", headers=auth_headers)
    assert resp.status_code == 200
    get_resp = client.get(f"/api/products/{pid}", headers=auth_headers)
    assert get_resp.json()["is_active"] is False
