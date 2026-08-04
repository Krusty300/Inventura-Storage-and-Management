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


def _make_location(auth_headers, name, code):
    resp = client.post("/api/locations", json={"name": name, "code": code}, headers=auth_headers)
    assert resp.status_code == 201
    return resp.json()


def _detail_stock(auth_headers, location_id):
    return client.get(f"/api/locations/{location_id}/detail", headers=auth_headers).json()["stock_lines"]


def test_create_product_attaches_opening_stock_to_location(auth_headers):
    loc = _make_location(auth_headers, "Bin Alpha", "ALPHA")
    prod = client.post("/api/products", json={
        "sku": "SKU-LOC1", "name": "Located Product", "quantity": 7, "location_id": loc["id"],
    }, headers=auth_headers).json()
    assert prod["location_id"] == loc["id"]
    stock = _detail_stock(auth_headers, loc["id"])
    assert any(s["product_name"] == "Located Product" and s["quantity"] == 7 for s in stock)


def test_update_product_moves_stock_to_new_location(auth_headers):
    loc_a = _make_location(auth_headers, "Bin A", "A")
    loc_b = _make_location(auth_headers, "Bin B", "B")
    prod = client.post("/api/products", json={
        "sku": "SKU-LOC2", "name": "Moving Product", "quantity": 5, "location_id": loc_a["id"],
    }, headers=auth_headers).json()
    updated = client.put(f"/api/products/{prod['id']}", json={
        "location_id": loc_b["id"], "location": "Bin B",
    }, headers=auth_headers).json()
    assert updated["location_id"] == loc_b["id"]
    assert any(s["product_name"] == "Moving Product" and s["quantity"] == 5 for s in _detail_stock(auth_headers, loc_b["id"]))
    assert not any(s["product_name"] == "Moving Product" for s in _detail_stock(auth_headers, loc_a["id"]))


def test_create_product_free_text_location_matches_path(auth_headers):
    loc = _make_location(auth_headers, "Bin Alpha", "ALPHA")
    prod = client.post("/api/products", json={
        "sku": "SKU-LOC3", "name": "Text Located", "quantity": 3, "location": "Bin Alpha",
    }, headers=auth_headers).json()
    assert prod["location_id"] == loc["id"]
    stock = _detail_stock(auth_headers, loc["id"])
    assert any(s["product_name"] == "Text Located" and s["quantity"] == 3 for s in stock)


def test_create_product_free_text_location_unassigned_when_no_match(auth_headers):
    prod = client.post("/api/products", json={
        "sku": "SKU-LOC4", "name": "Unassigned Product", "quantity": 3, "location": "Nowhere 99",
    }, headers=auth_headers).json()
    assert prod["location_id"] is None
    assert prod["quantity"] == 3
