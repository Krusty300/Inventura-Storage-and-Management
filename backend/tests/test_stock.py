from tests.conftest import client


def test_record_stock_in(auth_headers):
    prod = client.post("/api/products", json={"sku": "STK001", "name": "Stock Item", "quantity": 50}, headers=auth_headers).json()
    resp = client.post("/api/stock-movements", json={
        "product_id": prod["id"],
        "quantity_change": 10,
        "movement_type": "in",
        "reference": "PO-001",
    }, headers=auth_headers)
    assert resp.status_code == 201
    assert resp.json()["quantity_change"] == 10
    updated = client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()
    assert updated["quantity"] == 60


def test_record_stock_out(auth_headers):
    prod = client.post("/api/products", json={"sku": "STK002", "name": "Stock Out", "quantity": 30}, headers=auth_headers).json()
    resp = client.post("/api/stock-movements", json={
        "product_id": prod["id"],
        "quantity_change": -5,
        "movement_type": "out",
        "reference": "SALE-001",
    }, headers=auth_headers)
    assert resp.status_code == 201
    updated = client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()
    assert updated["quantity"] == 25


def test_insufficient_stock(auth_headers):
    prod = client.post("/api/products", json={"sku": "STK003", "name": "Low Stock", "quantity": 2}, headers=auth_headers).json()
    resp = client.post("/api/stock-movements", json={
        "product_id": prod["id"],
        "quantity_change": -10,
        "movement_type": "out",
    }, headers=auth_headers)
    assert resp.status_code == 400


def test_list_movements(auth_headers):
    prod = client.post("/api/products", json={"sku": "STK004", "name": "Movements", "quantity": 100}, headers=auth_headers).json()
    client.post("/api/stock-movements", json={"product_id": prod["id"], "quantity_change": 5, "movement_type": "in"}, headers=auth_headers)
    client.post("/api/stock-movements", json={"product_id": prod["id"], "quantity_change": -3, "movement_type": "out"}, headers=auth_headers)
    resp = client.get("/api/stock-movements", headers=auth_headers)
    assert resp.status_code == 200
    assert len(resp.json()["items"]) >= 2


def test_initial_stock_logs_movement(auth_headers):
    prod = client.post("/api/products", json={"sku": "STK005", "name": "Opening Stock", "quantity": 40}, headers=auth_headers).json()
    items = client.get(f"/api/products/{prod['id']}/movements", headers=auth_headers).json()
    assert any(
        m["movement_type"] == "in" and m["quantity_change"] == 40 and m["reference"] == "Initial stock"
        for m in items
    )


def test_edit_quantity_logs_movement(auth_headers):
    prod = client.post("/api/products", json={"sku": "STK006", "name": "Edited Qty", "quantity": 10}, headers=auth_headers).json()
    client.put(f"/api/products/{prod['id']}", json={"quantity": 15}, headers=auth_headers)
    items = client.get(f"/api/products/{prod['id']}/movements", headers=auth_headers).json()
    assert any(m["movement_type"] == "adjustment" and m["quantity_change"] == 5 for m in items)


def _record_movement(auth_headers, product_id, qty):
    resp = client.post("/api/stock-movements", json={
        "product_id": product_id, "quantity_change": qty, "movement_type": "in",
    }, headers=auth_headers)
    assert resp.status_code == 201
    return resp.json()


def test_update_movement_quantity_adjusts_correct_product(auth_headers):
    prod = client.post("/api/products", json={"sku": "STK007", "name": "Qty Fix", "quantity": 10}, headers=auth_headers).json()
    sm = _record_movement(auth_headers, prod["id"], 5)
    resp = client.put(f"/api/stock-movements/{sm['id']}", json={"quantity_change": 8}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["quantity_change"] == 8
    updated = client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()
    assert updated["quantity"] == 18


def test_update_movement_product_id_restores_old_and_updates_new(auth_headers):
    old_prod = client.post("/api/products", json={"sku": "STK008", "name": "Old Prod", "quantity": 10}, headers=auth_headers).json()
    new_prod = client.post("/api/products", json={"sku": "STK009", "name": "New Prod", "quantity": 20}, headers=auth_headers).json()
    sm = _record_movement(auth_headers, old_prod["id"], 5)
    resp = client.put(f"/api/stock-movements/{sm['id']}", json={"product_id": new_prod["id"]}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["product_id"] == new_prod["id"]
    old_updated = client.get(f"/api/products/{old_prod['id']}", headers=auth_headers).json()
    new_updated = client.get(f"/api/products/{new_prod['id']}", headers=auth_headers).json()
    assert old_updated["quantity"] == 10
    assert new_updated["quantity"] == 25


def test_update_movement_product_id_and_quantity(auth_headers):
    old_prod = client.post("/api/products", json={"sku": "STK010", "name": "Old Prod 2", "quantity": 10}, headers=auth_headers).json()
    new_prod = client.post("/api/products", json={"sku": "STK011", "name": "New Prod 2", "quantity": 20}, headers=auth_headers).json()
    sm = _record_movement(auth_headers, old_prod["id"], 5)
    resp = client.put(f"/api/stock-movements/{sm['id']}", json={
        "product_id": new_prod["id"], "quantity_change": 3,
    }, headers=auth_headers)
    assert resp.status_code == 200
    old_updated = client.get(f"/api/products/{old_prod['id']}", headers=auth_headers).json()
    new_updated = client.get(f"/api/products/{new_prod['id']}", headers=auth_headers).json()
    assert old_updated["quantity"] == 10
    assert new_updated["quantity"] == 23


def test_adjust_stock_sets_new_quantity(auth_headers):
    prod = client.post("/api/products", json={"sku": "STK012", "name": "Adjust Me", "quantity": 15}, headers=auth_headers).json()
    resp = client.post("/api/stock-movements/adjust", json={
        "product_id": prod["id"], "new_quantity": 30, "reason_code": "cycle_count",
    }, headers=auth_headers)
    assert resp.status_code == 201
    assert resp.json()["quantity_change"] == 15
    updated = client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()
    assert updated["quantity"] == 30


def test_adjust_stock_same_quantity_rejected(auth_headers):
    prod = client.post("/api/products", json={"sku": "STK013", "name": "No Change", "quantity": 10}, headers=auth_headers).json()
    resp = client.post("/api/stock-movements/adjust", json={
        "product_id": prod["id"], "new_quantity": 10, "reason_code": "cycle_count",
    }, headers=auth_headers)
    assert resp.status_code == 400


def test_worker_can_record_but_cannot_adjust_stock(auth_headers):
    client.post("/api/users", json={"username": "stockworker", "email": "stockworker@example.com", "password": "testpass123", "role": "worker"}, headers=auth_headers)
    token = client.post("/api/auth/login", json={"username": "stockworker", "password": "testpass123"}).json()["access_token"]
    prod = client.post("/api/products", json={"sku": "STK014", "name": "Worker Access", "quantity": 10}, headers=auth_headers).json()
    resp = client.post("/api/stock-movements", json={
        "product_id": prod["id"], "quantity_change": 1, "movement_type": "in",
    }, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 201
    adjust = client.post("/api/stock-movements/adjust", json={
        "product_id": prod["id"], "new_quantity": 20,
    }, headers={"Authorization": f"Bearer {token}"})
    assert adjust.status_code == 403
