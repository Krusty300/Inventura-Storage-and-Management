from tests.conftest import client


def test_record_stock_in(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, "sku": "STK001", "name": "Stock Item", "quantity": 50}, headers=auth_headers).json()
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
    prod = client.post("/api/products", json={"location_id": 1, "sku": "STK002", "name": "Stock Out", "quantity": 30}, headers=auth_headers).json()
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
    prod = client.post("/api/products", json={"location_id": 1, "sku": "STK003", "name": "Low Stock", "quantity": 2}, headers=auth_headers).json()
    resp = client.post("/api/stock-movements", json={
        "product_id": prod["id"],
        "quantity_change": -10,
        "movement_type": "out",
    }, headers=auth_headers)
    assert resp.status_code == 400


def test_list_movements(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, "sku": "STK004", "name": "Movements", "quantity": 100}, headers=auth_headers).json()
    client.post("/api/stock-movements", json={"product_id": prod["id"], "quantity_change": 5, "movement_type": "in"}, headers=auth_headers)
    client.post("/api/stock-movements", json={"product_id": prod["id"], "quantity_change": -3, "movement_type": "out"}, headers=auth_headers)
    resp = client.get("/api/stock-movements", headers=auth_headers)
    assert resp.status_code == 200
    assert len(resp.json()["items"]) >= 2


def test_initial_stock_logs_movement(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, "sku": "STK005", "name": "Opening Stock", "quantity": 40}, headers=auth_headers).json()
    items = client.get(f"/api/products/{prod['id']}/movements", headers=auth_headers).json()
    assert any(
        m["movement_type"] == "in" and m["quantity_change"] == 40 and m["reference"] == "Initial stock"
        for m in items
    )


def test_edit_quantity_logs_movement(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, "sku": "STK006", "name": "Edited Qty", "quantity": 10}, headers=auth_headers).json()
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
    prod = client.post("/api/products", json={"location_id": 1, "sku": "STK007", "name": "Qty Fix", "quantity": 10}, headers=auth_headers).json()
    sm = _record_movement(auth_headers, prod["id"], 5)
    resp = client.put(f"/api/stock-movements/{sm['id']}", json={"quantity_change": 8}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["quantity_change"] == 8
    updated = client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()
    assert updated["quantity"] == 18


def test_update_movement_product_id_restores_old_and_updates_new(auth_headers):
    old_prod = client.post("/api/products", json={"location_id": 1, "sku": "STK008", "name": "Old Prod", "quantity": 10}, headers=auth_headers).json()
    new_prod = client.post("/api/products", json={"location_id": 1, "sku": "STK009", "name": "New Prod", "quantity": 20}, headers=auth_headers).json()
    sm = _record_movement(auth_headers, old_prod["id"], 5)
    resp = client.put(f"/api/stock-movements/{sm['id']}", json={"product_id": new_prod["id"]}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["product_id"] == new_prod["id"]
    old_updated = client.get(f"/api/products/{old_prod['id']}", headers=auth_headers).json()
    new_updated = client.get(f"/api/products/{new_prod['id']}", headers=auth_headers).json()
    assert old_updated["quantity"] == 10
    assert new_updated["quantity"] == 25


def test_update_movement_product_id_and_quantity(auth_headers):
    old_prod = client.post("/api/products", json={"location_id": 1, "sku": "STK010", "name": "Old Prod 2", "quantity": 10}, headers=auth_headers).json()
    new_prod = client.post("/api/products", json={"location_id": 1, "sku": "STK011", "name": "New Prod 2", "quantity": 20}, headers=auth_headers).json()
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
    prod = client.post("/api/products", json={"location_id": 1, "sku": "STK012", "name": "Adjust Me", "quantity": 15}, headers=auth_headers).json()
    resp = client.post("/api/stock-movements/adjust", json={
        "product_id": prod["id"], "new_quantity": 30, "reason_code": "cycle_count",
    }, headers=auth_headers)
    assert resp.status_code == 201
    assert resp.json()["quantity_change"] == 15
    updated = client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()
    assert updated["quantity"] == 30


def test_adjust_stock_same_quantity_rejected(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, "sku": "STK013", "name": "No Change", "quantity": 10}, headers=auth_headers).json()
    resp = client.post("/api/stock-movements/adjust", json={
        "product_id": prod["id"], "new_quantity": 10, "reason_code": "cycle_count",
    }, headers=auth_headers)
    assert resp.status_code == 400


def test_adjust_serialized_rejected(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "STK-SER", "name": "Ser Adj", "quantity": 0, "is_serialized": True,
    }, headers=auth_headers).json()
    resp = client.post("/api/stock-movements/adjust", json={
        "product_id": prod["id"], "new_quantity": 5, "reason_code": "cycle_count",
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "serial" in resp.json()["detail"].lower()


def test_worker_can_record_but_cannot_adjust_stock(auth_headers):
    client.post("/api/users", json={"username": "stockworker", "email": "stockworker@example.com", "password": "testpass123", "role": "worker"}, headers=auth_headers)
    token = client.post("/api/auth/login", json={"username": "stockworker", "password": "testpass123"}).json()["access_token"]
    prod = client.post("/api/products", json={"location_id": 1, "sku": "STK014", "name": "Worker Access", "quantity": 10}, headers=auth_headers).json()
    resp = client.post("/api/stock-movements", json={
        "product_id": prod["id"], "quantity_change": 1, "movement_type": "in",
    }, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 201
    adjust = client.post("/api/stock-movements/adjust", json={
        "product_id": prod["id"], "new_quantity": 20,
    }, headers={"Authorization": f"Bearer {token}"})
    assert adjust.status_code == 403


def _create_transfer_location(auth_headers, name, code):
    return client.post("/api/locations", json={
        "name": name, "code": code, "location_type": "bin",
    }, headers=auth_headers).json()


def test_product_stock_locations_lists_only_stocked_locations(auth_headers):
    src = _create_transfer_location(auth_headers, "Bin Src", "TSRC")
    dst = _create_transfer_location(auth_headers, "Bin Dst", "TDST")
    prod = client.post("/api/products", json={"location_id": 1, 
        "sku": "STK-LOC", "name": "Loc Stock", "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 12, "location_id": src["id"]}],
    }, headers=auth_headers).status_code == 201

    resp = client.get("/api/stock-movements/locations", params={"product_id": prod["id"]}, headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()["locations"]
    assert len(body) == 1
    assert body[0]["location_id"] == src["id"]
    assert body[0]["quantity"] == 12
    assert body[0]["path"] == "Bin Src"
    assert dst["id"] not in [b["location_id"] for b in body]
    assert resp.json()["unallocated"] == 0


def test_product_stock_locations_with_lot_breakdown(auth_headers):
    src = _create_transfer_location(auth_headers, "Bin Lot", "TLOT")
    prod = client.post("/api/products", json={"location_id": 1, 
        "sku": "STK-LOTLOC", "name": "Lot Loc", "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 5, "location_id": src["id"], "lot_number": "LOT-A"}],
    }, headers=auth_headers).status_code == 201

    body = client.get("/api/stock-movements/locations", params={"product_id": prod["id"]}, headers=auth_headers).json()["locations"]
    assert len(body) == 1
    assert body[0]["quantity"] == 5
    assert len(body[0]["lots"]) == 1
    assert body[0]["lots"][0]["lot_number"] == "LOT-A"
    assert body[0]["lots"][0]["quantity"] == 5


def test_product_stock_locations_reports_unallocated_stock(auth_headers):
    from tests.conftest import TestingSessionLocal
    from app.models.stock_line import StockLine
    src = _create_transfer_location(auth_headers, "Bin Unal", "TUNL")
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "STK-UNAL", "name": "Unallocated Loc", "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 4, "location_id": src["id"]}],
    }, headers=auth_headers).status_code == 201
    db = TestingSessionLocal()
    db.add(StockLine(product_id=prod["id"], location_id=None, lot_id=None, lpn_id=None, quantity=9))
    db.commit()
    db.close()

    body = client.get("/api/stock-movements/locations", params={"product_id": prod["id"]}, headers=auth_headers).json()
    assert body["unallocated"] == 9
    assert len(body["locations"]) == 1
    assert body["locations"][0]["location_id"] == src["id"]
    assert body["locations"][0]["quantity"] == 4


def test_product_stock_locations_empty_when_no_stock(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, 
        "sku": "STK-NOSTK", "name": "No Loc", "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    resp = client.get("/api/stock-movements/locations", params={"product_id": prod["id"]}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["locations"] == []
    assert resp.json()["unallocated"] == 0


def test_product_stock_locations_unknown_product(auth_headers):
    resp = client.get("/api/stock-movements/locations", params={"product_id": 999999}, headers=auth_headers)
    assert resp.status_code == 404


def test_move_unallocated_stock_to_location(auth_headers):
    from tests.conftest import TestingSessionLocal
    from app.models.stock_line import StockLine
    dst = _create_transfer_location(auth_headers, "Bin UnalMove", "TUNM")
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "STK-UNALMV", "name": "Unallocated Move", "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    db = TestingSessionLocal()
    db.add(StockLine(product_id=prod["id"], location_id=None, lot_id=None, lpn_id=None, quantity=9))
    db.commit()
    db.close()

    resp = client.post("/api/stock-movements/unallocated-move", json={
        "product_id": prod["id"], "quantity": 4, "to_location_id": dst["id"],
    }, headers=auth_headers)
    assert resp.status_code == 201
    body = resp.json()
    assert body["reference"].startswith("UNL-")
    assert len(body["movements"]) == 2
    assert body["movements"][0]["movement_type"] == "transfer_out"
    assert body["movements"][1]["movement_type"] == "transfer_in"

    locs = client.get("/api/stock-movements/locations", params={"product_id": prod["id"]}, headers=auth_headers).json()
    assert locs["unallocated"] == 5
    assert len(locs["locations"]) == 1
    assert locs["locations"][0]["location_id"] == dst["id"]
    assert locs["locations"][0]["quantity"] == 4


def test_move_unallocated_stock_exceeds_available_rejected(auth_headers):
    from tests.conftest import TestingSessionLocal
    from app.models.stock_line import StockLine
    dst = _create_transfer_location(auth_headers, "Bin UnalOver", "TUNO")
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "STK-UNALOV", "name": "Unallocated Over", "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    db = TestingSessionLocal()
    db.add(StockLine(product_id=prod["id"], location_id=None, lot_id=None, lpn_id=None, quantity=3))
    db.commit()
    db.close()

    resp = client.post("/api/stock-movements/unallocated-move", json={
        "product_id": prod["id"], "quantity": 5, "to_location_id": dst["id"],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "unallocated" in resp.json()["detail"].lower()


def test_move_unallocated_stock_inactive_location_rejected(auth_headers):
    from tests.conftest import TestingSessionLocal
    from app.models.stock_line import StockLine
    inactive = client.post("/api/locations", json={"name": "Bin UnalInact", "code": "TUNI", "is_active": False}, headers=auth_headers).json()
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "STK-UNALIN", "name": "Unallocated Inact", "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    db = TestingSessionLocal()
    db.add(StockLine(product_id=prod["id"], location_id=None, lot_id=None, lpn_id=None, quantity=3))
    db.commit()
    db.close()

    resp = client.post("/api/stock-movements/unallocated-move", json={
        "product_id": prod["id"], "quantity": 2, "to_location_id": inactive["id"],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "inactive" in resp.json()["detail"].lower()
