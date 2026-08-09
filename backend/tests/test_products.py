from tests.conftest import client


def test_create_product(auth_headers):
    resp = client.post("/api/products", json={"location_id": 1, 
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
    client.post("/api/products", json={"location_id": 1, "sku": "SKU002", "name": "Product 2"}, headers=auth_headers)
    resp = client.post("/api/products", json={"location_id": 1, "sku": "SKU002", "name": "Product 2 Dup"}, headers=auth_headers)
    assert resp.status_code == 400


def test_list_products(auth_headers):
    client.post("/api/products", json={"location_id": 1, "sku": "SKU003", "name": "Alpha"}, headers=auth_headers)
    client.post("/api/products", json={"location_id": 1, "sku": "SKU004", "name": "Beta"}, headers=auth_headers)
    resp = client.get("/api/products", headers=auth_headers)
    assert resp.status_code == 200
    assert len(resp.json()["items"]) >= 2


def test_search_products(auth_headers):
    client.post("/api/products", json={"location_id": 1, "sku": "SRCH01", "name": "Searchable Item"}, headers=auth_headers)
    resp = client.get("/api/products?search=Searchable", headers=auth_headers)
    assert resp.status_code == 200
    assert any(p["name"] == "Searchable Item" for p in resp.json()["items"])


def test_get_product(auth_headers):
    create = client.post("/api/products", json={"location_id": 1, "sku": "SKU005", "name": "Get Me"}, headers=auth_headers)
    pid = create.json()["id"]
    resp = client.get(f"/api/products/{pid}", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["name"] == "Get Me"


def test_get_product_not_found(auth_headers):
    resp = client.get("/api/products/99999", headers=auth_headers)
    assert resp.status_code == 404


def test_update_product(auth_headers):
    create = client.post("/api/products", json={"location_id": 1, "sku": "SKU006", "name": "Original"}, headers=auth_headers)
    pid = create.json()["id"]
    resp = client.put(f"/api/products/{pid}", json={"name": "Updated", "unit_price": 25.00}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["name"] == "Updated"
    assert resp.json()["unit_price"] == 25.0


def test_delete_product(auth_headers):
    create = client.post("/api/products", json={"location_id": 1, "sku": "SKU007", "name": "Delete Me"}, headers=auth_headers)
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


def test_create_product_free_text_location_rejected_when_no_match(auth_headers):
    resp = client.post("/api/products", json={
        "sku": "SKU-LOC4", "name": "Unassigned Product", "quantity": 3, "location": "Nowhere 99",
    }, headers=auth_headers)
    assert resp.status_code == 400


def test_low_stock_filter_uses_sellable_and_active(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "LS-Q", "name": "LS-Q", "quantity": 5, "reorder_level": 5,
    }, headers=auth_headers).json()
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 5, "lot_number": "LS-Q-LOT"}],
    }, headers=auth_headers).status_code == 201
    lots = client.get("/api/lots", params={"product_id": prod["id"]}, headers=auth_headers).json()["items"]
    assert client.put(f"/api/lots/{lots[0]['id']}", json={"status": "quarantined"}, headers=auth_headers).status_code == 200
    # raw on-hand is 10 (above reorder 5) but sellable is 5 -> still flagged low
    inactive = client.post("/api/products", json={"location_id": 1,
        "sku": "LS-INACT", "name": "LS-INACT", "quantity": 1, "reorder_level": 10,
    }, headers=auth_headers).json()
    assert client.put(f"/api/products/{inactive['id']}", json={"is_active": False}, headers=auth_headers).status_code == 200

    skus = {p["sku"] for p in client.get("/api/products", params={"low_stock": True, "limit": 100}, headers=auth_headers).json()["items"]}
    assert "LS-Q" in skus
    assert "LS-INACT" not in skus


def test_variant_reports_parent_as_variant_of_name(auth_headers):
    parent = client.post("/api/products", json={"location_id": 1, "sku": "VAR-P", "name": "Original Shirt"}, headers=auth_headers).json()
    variant = client.post("/api/products", json={
        "parent_id": parent["id"], "sku": "VAR-V1", "attributes": {"Color": "Red"},
    }, headers=auth_headers).json()
    assert variant["is_variant"] is True
    assert variant["variant_of_name"] == "Original Shirt"
    fetched = client.get(f"/api/products/{variant['id']}", headers=auth_headers).json()
    assert fetched["variant_of_name"] == "Original Shirt"


def test_editing_variant_name_is_maintained_without_touching_parent(auth_headers):
    parent = client.post("/api/products", json={"location_id": 1, "sku": "VAR-P2", "name": "Original Mug"}, headers=auth_headers).json()
    variant = client.post("/api/products", json={
        "parent_id": parent["id"], "sku": "VAR-V2", "attributes": {"Color": "Blue"},
    }, headers=auth_headers).json()
    assert variant["name"] == "Original Mug"
    resp = client.put(f"/api/products/{variant['id']}", json={"name": "Custom Mug Name"}, headers=auth_headers)
    assert resp.status_code == 200
    updated = resp.json()
    assert updated["name"] == "Custom Mug Name"
    assert updated["variant_of_name"] == "Original Mug"
    parent_after = client.get(f"/api/products/{parent['id']}", headers=auth_headers).json()
    assert parent_after["name"] == "Original Mug"


def _receive_serials(auth_headers, product_id, location_id, serials):
    return client.post("/api/receipts", json={
        "items": [{"product_id": product_id, "quantity": len(serials),
                   "serial_numbers": serials, "location_id": location_id}],
    }, headers=auth_headers)


def test_deactivating_serialized_product_flags_serials_inactive(auth_headers):
    loc = _make_location(auth_headers, "Bin Deact", "DEACT")
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "SER-DEACT", "name": "Ser Deact", "unit_price": 1.0, "quantity": 0, "is_serialized": True,
    }, headers=auth_headers).json()
    assert _receive_serials(auth_headers, prod["id"], loc["id"], ["D-01", "D-02"]).status_code == 201

    resp = client.put(f"/api/products/{prod['id']}", json={"is_active": False}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["is_active"] is False
    assert resp.json()["quantity"] == 0

    serials = client.get(f"/api/serial-numbers?product_id={prod['id']}&limit=10", headers=auth_headers).json()["items"]
    assert len(serials) == 2
    assert all(s["status"] == "inactive" for s in serials)

    movements = client.get(f"/api/products/{prod['id']}/movements", headers=auth_headers).json()
    assert any(m["movement_type"] == "deactivate" for m in movements)


def test_reactivating_serialized_product_restores_serials(auth_headers):
    loc = _make_location(auth_headers, "Bin React", "REACT")
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "SER-REACT", "name": "Ser React", "unit_price": 1.0, "quantity": 0, "is_serialized": True,
    }, headers=auth_headers).json()
    assert _receive_serials(auth_headers, prod["id"], loc["id"], ["R-01", "R-02"]).status_code == 201
    assert client.put(f"/api/products/{prod['id']}", json={"is_active": False}, headers=auth_headers).status_code == 200

    resp = client.put(f"/api/products/{prod['id']}", json={"is_active": True}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["is_active"] is True
    assert resp.json()["quantity"] == 2

    serials = client.get(f"/api/serial-numbers?product_id={prod['id']}&limit=10", headers=auth_headers).json()["items"]
    assert all(s["status"] == "in_stock" for s in serials)

    movements = client.get(f"/api/products/{prod['id']}/movements", headers=auth_headers).json()
    assert any(m["movement_type"] == "activate" for m in movements)


def test_deleting_serialized_product_flags_serials_inactive(auth_headers):
    loc = _make_location(auth_headers, "Bin Del", "DELACT")
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "SER-DEL", "name": "Ser Del", "unit_price": 1.0, "quantity": 0, "is_serialized": True,
    }, headers=auth_headers).json()
    assert _receive_serials(auth_headers, prod["id"], loc["id"], ["DL-01"]).status_code == 201

    assert client.delete(f"/api/products/{prod['id']}", headers=auth_headers).status_code == 200
    assert client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()["is_active"] is False

    serials = client.get(f"/api/serial-numbers?product_id={prod['id']}&limit=10", headers=auth_headers).json()["items"]
    assert len(serials) == 1
    assert serials[0]["status"] == "inactive"


def test_deactivating_parent_flags_serialized_variant_serials(auth_headers):
    parent = client.post("/api/products", json={"location_id": 1, "sku": "P-DEACT", "name": "Parent Deact"}, headers=auth_headers).json()
    variant = client.post("/api/products", json={
        "parent_id": parent["id"], "sku": "V-DEACT", "attributes": {"Color": "Red"},
        "unit_price": 1.0, "quantity": 0, "is_serialized": True,
    }, headers=auth_headers).json()
    assert variant["is_variant"] is True
    loc = _make_location(auth_headers, "Bin VDeact", "VDEACT")
    assert _receive_serials(auth_headers, variant["id"], loc["id"], ["V-01", "V-02"]).status_code == 201

    resp = client.put(f"/api/products/{parent['id']}", json={"is_active": False}, headers=auth_headers)
    assert resp.status_code == 200
    assert client.get(f"/api/products/{variant['id']}", headers=auth_headers).json()["is_active"] is False

    serials = client.get(f"/api/serial-numbers?product_id={variant['id']}&limit=10", headers=auth_headers).json()["items"]
    assert all(s["status"] == "inactive" for s in serials)


def test_product_lists_expired_lot_quantity(auth_headers):
    loc = _make_location(auth_headers, "Bin Expired", "EXPLOT")
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "EXP-LOT", "name": "Expired Lot Item", "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 5, "location_id": loc["id"],
                   "lot_number": "EXP-OLD", "expiry_date": "2020-01-01"}],
    }, headers=auth_headers).status_code == 201

    # the list endpoint flips overdue in_stock lots to expired
    listing = client.get("/api/products", params={"include_variants": 1, "limit": 100}, headers=auth_headers).json()
    row = next(p for p in listing["items"] if p["id"] == prod["id"])
    assert row["expired_lot_qty"] == 5

    detail = client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()
    assert detail["expired_lot_qty"] == 5
