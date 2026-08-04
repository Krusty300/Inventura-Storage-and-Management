from app.models import StockLine
from tests.conftest import TestingSessionLocal, client


def _make_parent(auth_headers, sku="VAR-PARENT", name="T-Shirt", category_id=None):
    return client.post("/api/products", json={
        "sku": sku, "name": name, "category_id": category_id,
        "unit_price": 20.00, "cost_price": 10.00,
    }, headers=auth_headers).json()


def _make_variant(auth_headers, parent_id, sku, quantity=0, attributes=None, price=None):
    body = {
        "sku": sku, "parent_id": parent_id, "quantity": quantity,
        "attributes": attributes or {"Color": "Red", "Size": "M"},
    }
    if price is not None:
        body["unit_price"] = price
    return client.post("/api/products", json=body, headers=auth_headers)


def test_create_variant_inherits_and_logs_initial_stock(auth_headers):
    parent = _make_parent(auth_headers)
    resp = _make_variant(auth_headers, parent["id"], "TS-RED-M", quantity=25, attributes={"Color": "Red", "Size": "M"})
    assert resp.status_code == 201
    var = resp.json()
    assert var["parent_id"] == parent["id"]
    assert var["is_variant"] is True
    assert var["name"] == parent["name"]
    assert var["variant_label"] == "Red / M"
    assert var["display_name"] == "T-Shirt - Red / M"
    assert var["attributes"] == {"Color": "Red", "Size": "M"}
    movements = client.get(f"/api/products/{var['id']}/movements", headers=auth_headers).json()
    assert any(m["movement_type"] == "in" and m["quantity_change"] == 25 for m in movements)
    updated_parent = client.get(f"/api/products/{parent['id']}", headers=auth_headers).json()
    assert updated_parent["quantity"] == 0
    assert updated_parent["total_quantity"] == 25


def test_variant_of_variant_rejected(auth_headers):
    parent = _make_parent(auth_headers)
    v1 = _make_variant(auth_headers, parent["id"], "TS-1").json()
    resp = client.post("/api/products", json={"sku": "TS-2", "parent_id": v1["id"]}, headers=auth_headers)
    assert resp.status_code == 400


def test_list_products_excludes_variants_unless_requested(auth_headers):
    parent = _make_parent(auth_headers)
    _make_variant(auth_headers, parent["id"], "TS-LIST-A", attributes={"Color": "Red"})
    _make_variant(auth_headers, parent["id"], "TS-LIST-B", attributes={"Color": "Blue"})
    plain = client.get("/api/products", headers=auth_headers).json()
    assert all(p["sku"] != "TS-LIST-A" for p in plain["items"])
    with_variants = client.get("/api/products?include_variants=1", headers=auth_headers).json()
    row = next(p for p in with_variants["items"] if p["sku"] == "VAR-PARENT")
    assert len(row["variants"]) == 2
    assert row["total_quantity"] == 0


def test_update_parent_syncs_variant_identity(auth_headers):
    parent = _make_parent(auth_headers)
    _make_variant(auth_headers, parent["id"], "TS-SYNC")
    resp = client.put(f"/api/products/{parent['id']}", json={"name": "Polo Shirt"}, headers=auth_headers)
    assert resp.status_code == 200
    variant = client.get("/api/products?include_variants=1", headers=auth_headers).json()
    row = next(p for p in variant["items"] if p["id"] == parent["id"])
    assert row["variants"][0]["name"] == "Polo Shirt"
    assert row["variants"][0]["display_name"] == "Polo Shirt - Red / M"


def test_variant_can_rename_and_keeps_name_on_parent_rename(auth_headers):
    parent = _make_parent(auth_headers)
    var = _make_variant(auth_headers, parent["id"], "TS-CUSTOM", attributes={"Color": "Blue"}).json()
    resp = client.put(f"/api/products/{var['id']}", json={"name": "Pro Fit"}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["display_name"] == "Pro Fit - Blue"
    resp = client.put(f"/api/products/{parent['id']}", json={"name": "Renamed Parent"}, headers=auth_headers)
    assert resp.status_code == 200
    variant = client.get(f"/api/products/{var['id']}", headers=auth_headers).json()
    assert variant["name"] == "Pro Fit"
    assert variant["display_name"] == "Pro Fit - Blue"


def test_variant_created_with_custom_name(auth_headers):
    parent = _make_parent(auth_headers)
    resp = client.post("/api/products", json={
        "sku": "TS-NAMED", "parent_id": parent["id"], "name": "Custom Child",
        "attributes": {"Color": "Green"},
    }, headers=auth_headers)
    assert resp.status_code == 201
    assert resp.json()["name"] == "Custom Child"
    assert resp.json()["display_name"] == "Custom Child - Green"


def test_parent_with_variants_rejects_quantity_edit(auth_headers):
    parent = _make_parent(auth_headers)
    _make_variant(auth_headers, parent["id"], "TS-QTY")
    resp = client.put(f"/api/products/{parent['id']}", json={"quantity": 50}, headers=auth_headers)
    assert resp.status_code == 400


def test_sale_requires_variant(auth_headers):
    parent = _make_parent(auth_headers)
    var = _make_variant(auth_headers, parent["id"], "TS-SALE", quantity=10).json()
    resp = client.post("/api/sales", json={"items": [{"product_id": parent["id"], "quantity": 1, "unit_price": 20.00}]}, headers=auth_headers)
    assert resp.status_code == 400
    resp = client.post("/api/sales", json={"items": [{"product_id": var["id"], "quantity": 1, "unit_price": 20.00}]}, headers=auth_headers)
    assert resp.status_code == 201


def test_stock_movement_requires_variant(auth_headers):
    parent = _make_parent(auth_headers)
    var = _make_variant(auth_headers, parent["id"], "TS-MOVE", quantity=10).json()
    resp = client.post("/api/stock-movements", json={
        "product_id": parent["id"], "quantity_change": -1, "movement_type": "out",
    }, headers=auth_headers)
    assert resp.status_code == 400
    resp = client.post("/api/stock-movements", json={
        "product_id": var["id"], "quantity_change": -2, "movement_type": "out",
    }, headers=auth_headers)
    assert resp.status_code == 201
    updated = client.get(f"/api/products/{var['id']}", headers=auth_headers).json()
    assert updated["quantity"] == 8


def test_first_variant_transfers_parent_stock(auth_headers):
    parent = client.post("/api/products", json={
        "sku": "TS-PARENT-QTY", "name": "Stocked Parent",
        "quantity": 15, "unit_price": 20.00, "cost_price": 10.00,
    }, headers=auth_headers).json()
    var = _make_variant(auth_headers, parent["id"], "TS-TRANSFER", quantity=5).json()
    assert var["quantity"] == 20
    updated_parent = client.get(f"/api/products/{parent['id']}", headers=auth_headers).json()
    assert updated_parent["quantity"] == 0
    assert updated_parent["total_quantity"] == 20
    movements = client.get(f"/api/products/{var['id']}/movements", headers=auth_headers).json()
    assert any(m["movement_type"] == "in" and m["quantity_change"] == 20 for m in movements)


def test_first_variant_transfers_parent_stock_from_located_line(auth_headers):
    loc = client.post("/api/locations", json={
        "name": "Bin A-01", "code": "A-01", "location_type": "bin",
    }, headers=auth_headers).json()
    parent = client.post("/api/products", json={
        "sku": "TS-PARENT-LOC", "name": "Stocked Parent",
        "unit_price": 20.00, "cost_price": 10.00, "quantity": 0,
    }, headers=auth_headers).json()
    resp = client.post("/api/receipts", json={
        "items": [{"product_id": parent["id"], "quantity": 10, "unit_cost": 5.0, "location_id": loc["id"]}],
    }, headers=auth_headers)
    assert resp.status_code == 201

    var = _make_variant(auth_headers, parent["id"], "TS-TRANSFER-LOC").json()
    assert var["quantity"] == 10
    updated_parent = client.get(f"/api/products/{parent['id']}", headers=auth_headers).json()
    assert updated_parent["quantity"] == 0
    assert updated_parent["total_quantity"] == 10

    db = TestingSessionLocal()
    try:
        lines = db.query(StockLine).filter(StockLine.product_id == parent["id"]).all()
        assert sum(l.quantity for l in lines) == 0
    finally:
        db.close()
    movements = client.get(f"/api/products/{parent['id']}/movements", headers=auth_headers).json()
    assert any(m["movement_type"] == "out" and m["quantity_change"] == -10 for m in movements)


def test_inactive_variants_release_parent_and_exclude_totals(auth_headers):
    parent = _make_parent(auth_headers)
    var = _make_variant(auth_headers, parent["id"], "TS-IA", quantity=5).json()
    resp = client.put(f"/api/products/{var['id']}", json={"is_active": False}, headers=auth_headers)
    assert resp.status_code == 200
    resp = client.put(f"/api/products/{parent['id']}", json={"quantity": 7}, headers=auth_headers)
    assert resp.status_code == 200
    with_variants = client.get("/api/products?include_variants=1", headers=auth_headers).json()
    row = next(p for p in with_variants["items"] if p["id"] == parent["id"])
    assert row["total_quantity"] == 0
    resp = client.post("/api/sales", json={"items": [{"product_id": parent["id"], "quantity": 1, "unit_price": 20.00}]}, headers=auth_headers)
    assert resp.status_code == 201


def test_duplicate_variant_attributes_rejected(auth_headers):
    parent = _make_parent(auth_headers)
    resp = _make_variant(auth_headers, parent["id"], "TS-DUP1", attributes={"Color": "Red"})
    assert resp.status_code == 201
    resp = _make_variant(auth_headers, parent["id"], "TS-DUP2", attributes={"Color": "Red"})
    assert resp.status_code == 400
    resp = _make_variant(auth_headers, parent["id"], "TS-DUP3", attributes={"Color": "Blue"})
    assert resp.status_code == 201


def test_duplicate_variant_attributes_rejected_on_update(auth_headers):
    parent = _make_parent(auth_headers)
    _make_variant(auth_headers, parent["id"], "TS-DUPU1", attributes={"Color": "Red"})
    var2 = _make_variant(auth_headers, parent["id"], "TS-DUPU2", attributes={"Color": "Blue"}).json()
    resp = client.put(f"/api/products/{var2['id']}", json={"attributes": {"Color": "Red"}}, headers=auth_headers)
    assert resp.status_code == 400
    resp = client.put(f"/api/products/{var2['id']}", json={"attributes": {"Color": "Green"}}, headers=auth_headers)
    assert resp.status_code == 200


def test_search_matches_variant_attributes(auth_headers):
    parent = _make_parent(auth_headers)
    _make_variant(auth_headers, parent["id"], "TS-ATTR", attributes={"Color": "Mauve"})
    res = client.get("/api/products", params={"search": "Mauve", "include_variants": 1}, headers=auth_headers).json()
    assert any(p["sku"] == "VAR-PARENT" for p in res["items"])
    res = client.get("/api/products", params={"search": "Mauve"}, headers=auth_headers).json()
    assert all(p["sku"] != "VAR-PARENT" for p in res["items"])

