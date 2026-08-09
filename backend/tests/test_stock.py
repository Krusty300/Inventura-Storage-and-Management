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


def test_record_movement_with_explicit_location_in(auth_headers):
    dst = _create_transfer_location(auth_headers, "Bin MoveIn", "TMIN")
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "STK-LOCIN", "name": "Loc In", "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    resp = client.post("/api/stock-movements", json={
        "product_id": prod["id"], "quantity_change": 5, "movement_type": "in",
        "location_id": dst["id"], "reference": "PO-LOC1",
    }, headers=auth_headers)
    assert resp.status_code == 201
    assert resp.json()["to_location_id"] == dst["id"]
    locs = client.get("/api/stock-movements/locations", params={"product_id": prod["id"]}, headers=auth_headers).json()["locations"]
    assert len(locs) == 1
    assert locs[0]["location_id"] == dst["id"]
    assert locs[0]["quantity"] == 5


def test_record_movement_with_explicit_location_out(auth_headers):
    src = _create_transfer_location(auth_headers, "Bin MoveOut", "TMOUT")
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "STK-LOCOUT", "name": "Loc Out", "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 8, "location_id": src["id"]}],
    }, headers=auth_headers).status_code == 201
    resp = client.post("/api/stock-movements", json={
        "product_id": prod["id"], "quantity_change": -3, "movement_type": "out",
        "location_id": src["id"], "reference": "SALE-X",
    }, headers=auth_headers)
    assert resp.status_code == 201
    assert resp.json()["from_location_id"] == src["id"]
    locs = client.get("/api/stock-movements/locations", params={"product_id": prod["id"]}, headers=auth_headers).json()["locations"]
    assert len(locs) == 1
    assert locs[0]["quantity"] == 5


def test_record_movement_out_insufficient_at_chosen_location(auth_headers):
    src_a = _create_transfer_location(auth_headers, "Bin OutHave", "TOHV")
    src_b = _create_transfer_location(auth_headers, "Bin OutEmpty", "TOEM")
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "STK-LOCEM", "name": "Loc Empty", "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 2, "location_id": src_a["id"]}],
    }, headers=auth_headers).status_code == 201
    resp = client.post("/api/stock-movements", json={
        "product_id": prod["id"], "quantity_change": -5, "movement_type": "out",
        "location_id": src_b["id"],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "insufficient" in resp.json()["detail"].lower()


def test_record_movement_inactive_location_rejected(auth_headers):
    inactive = client.post("/api/locations", json={"name": "Bin MoveInact", "code": "TMIA", "is_active": False}, headers=auth_headers).json()
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "STK-LOCINACT", "name": "Loc Inact", "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    resp = client.post("/api/stock-movements", json={
        "product_id": prod["id"], "quantity_change": 1, "movement_type": "in",
        "location_id": inactive["id"],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "inactive" in resp.json()["detail"].lower()


def test_record_movement_return_restores_stock_to_location(auth_headers):
    loc = _create_transfer_location(auth_headers, "Bin RetLoc", "TRET")
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "STK-LOCRET", "name": "Loc Ret", "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 4, "location_id": loc["id"]}],
    }, headers=auth_headers).status_code == 201
    assert client.post("/api/stock-movements", json={
        "product_id": prod["id"], "quantity_change": -4, "movement_type": "out", "location_id": loc["id"],
    }, headers=auth_headers).status_code == 201
    resp = client.post("/api/stock-movements", json={
        "product_id": prod["id"], "quantity_change": 4, "movement_type": "return",
        "location_id": loc["id"], "reference": "RTN-1",
    }, headers=auth_headers)
    assert resp.status_code == 201
    assert resp.json()["movement_type"] == "return"
    assert resp.json()["to_location_id"] == loc["id"]
    locs = client.get("/api/stock-movements/locations", params={"product_id": prod["id"]}, headers=auth_headers).json()
    assert locs["unallocated"] == 0
    assert len(locs["locations"]) == 1
    assert locs["locations"][0]["location_id"] == loc["id"]
    assert locs["locations"][0]["quantity"] == 4


def test_record_return_auto_generates_reference(auth_headers):
    loc = _create_transfer_location(auth_headers, "Bin AutoRet", "TAUR")
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "STK-AUTORET", "name": "Auto Ret", "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 5, "location_id": loc["id"]}],
    }, headers=auth_headers).status_code == 201
    assert client.post("/api/stock-movements", json={
        "product_id": prod["id"], "quantity_change": -5, "movement_type": "out", "location_id": loc["id"],
    }, headers=auth_headers).status_code == 201
    resp = client.post("/api/stock-movements", json={
        "product_id": prod["id"], "quantity_change": 5, "movement_type": "return", "location_id": loc["id"],
    }, headers=auth_headers)
    assert resp.status_code == 201
    assert resp.json()["reference"].startswith("RET-")
    assert resp.json()["to_location_id"] == loc["id"]


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


def test_adjust_stock_with_explicit_location_sets_target_at_location(auth_headers):
    src = _create_transfer_location(auth_headers, "Bin Adj", "TADJ")
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "STK-ADJLOC", "name": "Adj Loc", "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 12, "location_id": src["id"]}],
    }, headers=auth_headers).status_code == 201
    resp = client.post("/api/stock-movements/adjust", json={
        "product_id": prod["id"], "new_quantity": 5, "reason_code": "recount",
        "location_id": src["id"],
    }, headers=auth_headers)
    assert resp.status_code == 201
    assert resp.json()["quantity_change"] == -7
    assert resp.json()["location_id"] == src["id"]
    updated = client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()
    assert updated["quantity"] == 5
    locs = client.get("/api/stock-movements/locations", params={"product_id": prod["id"]}, headers=auth_headers).json()
    assert locs["locations"][0]["quantity"] == 5


def test_adjust_stock_at_one_location_leaves_other_locations_untouched(auth_headers):
    loc_a = _create_transfer_location(auth_headers, "Bin A Adj", "TA-A")
    loc_b = _create_transfer_location(auth_headers, "Bin B Adj", "TA-B")
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "STK-ADJ2", "name": "Adj Two", "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    for loc, qty in ((loc_a, 8), (loc_b, 8)):
        assert client.post("/api/receipts", json={
            "items": [{"product_id": prod["id"], "quantity": qty, "location_id": loc["id"]}],
        }, headers=auth_headers).status_code == 201
    resp = client.post("/api/stock-movements/adjust", json={
        "product_id": prod["id"], "new_quantity": 5, "reason_code": "recount",
        "location_id": loc_a["id"],
    }, headers=auth_headers)
    assert resp.status_code == 201
    assert resp.json()["quantity_change"] == -3
    locs = client.get("/api/stock-movements/locations", params={"product_id": prod["id"]}, headers=auth_headers).json()
    by_loc = {l["location_id"]: l["quantity"] for l in locs["locations"]}
    assert by_loc[loc_a["id"]] == 5
    assert by_loc[loc_b["id"]] == 8
    updated = client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()
    assert updated["quantity"] == 13


def test_adjust_stock_same_quantity_at_location_rejected(auth_headers):
    loc = _create_transfer_location(auth_headers, "Bin NoChg", "TADJNC")
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "STK-ADJNC", "name": "Adj NoChg", "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 7, "location_id": loc["id"]}],
    }, headers=auth_headers).status_code == 201
    resp = client.post("/api/stock-movements/adjust", json={
        "product_id": prod["id"], "new_quantity": 7, "reason_code": "recount",
        "location_id": loc["id"],
    }, headers=auth_headers)
    assert resp.status_code == 400


def test_adjust_stock_inactive_location_rejected(auth_headers):
    loc = _create_transfer_location(auth_headers, "Bin Off", "TOFF")
    assert client.put(f"/api/locations/{loc['id']}", json={"is_active": False}, headers=auth_headers).status_code == 200
    prod = client.post("/api/products", json={"location_id": 1, "sku": "STK-ADJOFF", "name": "Adj Off", "quantity": 5}, headers=auth_headers).json()
    resp = client.post("/api/stock-movements/adjust", json={
        "product_id": prod["id"], "new_quantity": 3, "reason_code": "recount",
        "location_id": loc["id"],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "inactive" in resp.json()["detail"].lower()


def test_adjust_stock_missing_location_rejected(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, "sku": "STK-ADJMISS", "name": "Adj Miss", "quantity": 5}, headers=auth_headers).json()
    resp = client.post("/api/stock-movements/adjust", json={
        "product_id": prod["id"], "new_quantity": 3, "reason_code": "recount",
        "location_id": 999999,
    }, headers=auth_headers)
    assert resp.status_code == 400


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


def _unallocated_serialized_product(auth_headers, sku, serials):
    from tests.conftest import TestingSessionLocal
    from app.models.serial_number import SerialNumber
    prod = client.post("/api/products", json={
        "location_id": 1, "sku": sku, "name": sku, "unit_price": 1.0, "quantity": 0, "is_serialized": True,
    }, headers=auth_headers).json()
    db = TestingSessionLocal()
    for sn in serials:
        db.add(SerialNumber(product_id=prod["id"], serial_number=sn, status="in_stock"))
    db.commit()
    db.close()
    return prod


def test_move_unallocated_serialized_stock_to_location(auth_headers):
    dst = _create_transfer_location(auth_headers, "Bin UnalSer", "TUNS")
    prod = _unallocated_serialized_product(auth_headers, "STK-UNALSR", ["SN-U1", "SN-U2", "SN-U3"])

    items = client.get("/api/serial-numbers", params={"product_id": prod["id"], "no_location": True}, headers=auth_headers).json()["items"]
    ids = [i["id"] for i in items]
    assert len(ids) == 3

    resp = client.post("/api/stock-movements/unallocated-move", json={
        "product_id": prod["id"], "quantity": 3, "to_location_id": dst["id"], "serial_ids": ids,
    }, headers=auth_headers)
    assert resp.status_code == 201
    body = resp.json()
    assert body["reference"].startswith("UNL-")
    assert len(body["movements"]) == 6
    assert body["movements"][0]["movement_type"] == "transfer_out"
    assert body["movements"][1]["movement_type"] == "transfer_in"

    items = client.get("/api/serial-numbers", params={"product_id": prod["id"]}, headers=auth_headers).json()["items"]
    assert len(items) == 3
    assert all(i["location_id"] == dst["id"] for i in items)
    assert all(i["status"] == "in_stock" for i in items)
    unalloc = client.get("/api/serial-numbers", params={"product_id": prod["id"], "no_location": True}, headers=auth_headers).json()
    assert unalloc["items"] == []


def test_move_unallocated_serialized_requires_serial_ids(auth_headers):
    dst = _create_transfer_location(auth_headers, "Bin UnalSerReq", "TUNR")
    prod = _unallocated_serialized_product(auth_headers, "STK-UNALRQ", ["SN-R1"])

    resp = client.post("/api/stock-movements/unallocated-move", json={
        "product_id": prod["id"], "quantity": 1, "to_location_id": dst["id"],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "serial" in resp.json()["detail"].lower()


def test_move_unallocated_serialized_rejects_serial_with_location(auth_headers):
    from tests.conftest import TestingSessionLocal
    from app.models.serial_number import SerialNumber
    dst = _create_transfer_location(auth_headers, "Bin UnalSerLoc", "TUNL2")
    located = _create_transfer_location(auth_headers, "Bin UnalSerHome", "TUNH")
    prod = _unallocated_serialized_product(auth_headers, "STK-UNALLOC", ["SN-L1", "SN-L2"])
    db = TestingSessionLocal()
    db.add(SerialNumber(product_id=prod["id"], serial_number="SN-L0", status="in_stock", location_id=located["id"]))
    db.commit()
    db.close()

    items = client.get("/api/serial-numbers", params={"product_id": prod["id"], "no_location": True}, headers=auth_headers).json()["items"]
    ids = [i["id"] for i in items]
    assert len(ids) == 2
    # moving a serial that already has a location fails even if mixed with valid ones
    with_loc = client.get("/api/serial-numbers", params={"product_id": prod["id"]}, headers=auth_headers).json()["items"]
    all_ids = ids + [i["id"] for i in with_loc if i["serial_number"] == "SN-L0"]

    resp = client.post("/api/stock-movements/unallocated-move", json={
        "product_id": prod["id"], "quantity": len(all_ids), "to_location_id": dst["id"], "serial_ids": all_ids,
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "SN-L0" in resp.json()["detail"]


def test_move_unallocated_serial_ids_rejected_for_non_serialized(auth_headers):
    dst = _create_transfer_location(auth_headers, "Bin UnalNonSer", "TUNN")
    prod = client.post("/api/products", json={
        "location_id": 1, "sku": "STK-UNALNS", "name": "Not Serial", "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    resp = client.post("/api/stock-movements/unallocated-move", json={
        "product_id": prod["id"], "quantity": 1, "to_location_id": dst["id"], "serial_ids": [1],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "serialized" in resp.json()["detail"].lower()


def _shipment_product(auth_headers, sku):
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": sku, "name": sku, "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    loc = client.post("/api/locations", json={"name": f"{sku}-loc", "code": sku, "location_type": "bin"}, headers=auth_headers).json()
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 8, "location_id": loc["id"]}],
    }, headers=auth_headers).status_code == 201
    shipment = client.post("/api/shipments", json={
        "items": [{"product_id": prod["id"], "quantity": 3}],
    }, headers=auth_headers).json()
    client.post(f"/api/shipments/{shipment['id']}/pick", headers=auth_headers)
    client.post(f"/api/shipments/{shipment['id']}/pack", headers=auth_headers)
    assert client.post(f"/api/shipments/{shipment['id']}/ship", headers=auth_headers).status_code == 200
    return prod


def _shipped_movement(auth_headers, product_id):
    items = client.get("/api/stock-movements", headers=auth_headers).json()["items"]
    return next(m for m in items if m["movement_type"] == "ship" and m["product_id"] == product_id)


def test_shipped_movement_cannot_be_edited(auth_headers):
    prod = _shipment_product(auth_headers, "STK-SHIPED")
    sm = _shipped_movement(auth_headers, prod["id"])
    resp = client.put(f"/api/stock-movements/{sm['id']}", json={"notes": "tampered"}, headers=auth_headers)
    assert resp.status_code == 400
    assert "shipped" in resp.json()["detail"].lower()


def test_shipped_movement_cannot_be_deleted(auth_headers):
    prod = _shipment_product(auth_headers, "STK-SHIPDEL")
    sm = _shipped_movement(auth_headers, prod["id"])
    resp = client.delete(f"/api/stock-movements/{sm['id']}", headers=auth_headers)
    assert resp.status_code == 400
    assert "shipped" in resp.json()["detail"].lower()
    # the movement is still there and stock is untouched
    assert client.get("/api/stock-movements", headers=auth_headers).status_code == 200
    assert client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()["quantity"] == 5
