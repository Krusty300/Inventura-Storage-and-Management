from tests.conftest import client


def _loc(auth_headers, code):
    return client.post("/api/locations", json={"name": f"Loc {code}", "code": code}, headers=auth_headers).json()


def _receive(auth_headers, product_id, qty, location_id=None, lot=None):
    return client.post("/api/receipts", json={
        "items": [{"product_id": product_id, "quantity": qty, "location_id": location_id, "lot_number": lot or ""}],
    }, headers=auth_headers)


def test_transfer_posts_matched_pair(auth_headers):
    src = _loc(auth_headers, "TRF-A")
    dst = _loc(auth_headers, "TRF-B")
    prod = client.post("/api/products", json={"location_id": 1, 
        "sku": "TRF-PROD", "name": "Transfer Prod", "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    _receive(auth_headers, prod["id"], 10, src["id"])

    resp = client.post("/api/stock-movements/transfer", json={
        "product_id": prod["id"], "quantity": 4, "from_location_id": src["id"], "to_location_id": dst["id"],
    }, headers=auth_headers)
    assert resp.status_code == 201
    body = resp.json()
    assert body["reference"].startswith("TRF-")
    movements = body["movements"]
    out = movements[0]
    inbound = movements[1]
    assert out["movement_type"] == "transfer_out"
    assert inbound["movement_type"] == "transfer_in"
    assert out["quantity_change"] == -4
    assert inbound["quantity_change"] == 4
    assert out["from_location_id"] == src["id"]
    assert inbound["to_location_id"] == dst["id"]
    assert inbound["transfer_id"] == out["id"]

    prod_after = client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()
    assert prod_after["quantity"] == 10


def test_transfer_insufficient_stock(auth_headers):
    src = _loc(auth_headers, "TRF-C")
    dst = _loc(auth_headers, "TRF-D")
    prod = client.post("/api/products", json={"location_id": 1, 
        "sku": "TRF-LOW", "name": "Low", "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    _receive(auth_headers, prod["id"], 2, src["id"])
    resp = client.post("/api/stock-movements/transfer", json={
        "product_id": prod["id"], "quantity": 5, "from_location_id": src["id"], "to_location_id": dst["id"],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()["quantity"] == 2


def test_transfer_same_location_rejected(auth_headers):
    src = _loc(auth_headers, "TRF-E")
    prod = client.post("/api/products", json={"location_id": 1, 
        "sku": "TRF-SAME", "name": "Same", "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    _receive(auth_headers, prod["id"], 3, src["id"])
    resp = client.post("/api/stock-movements/transfer", json={
        "product_id": prod["id"], "quantity": 1, "from_location_id": src["id"], "to_location_id": src["id"],
    }, headers=auth_headers)
    assert resp.status_code == 400


def test_transfer_serialized_blocked(auth_headers):
    src = _loc(auth_headers, "TRF-F")
    dst = _loc(auth_headers, "TRF-G")
    prod = client.post("/api/products", json={"location_id": 1, 
        "sku": "TRF-SER", "name": "Ser", "unit_price": 1.0, "quantity": 0, "is_serialized": True,
    }, headers=auth_headers).json()
    resp = client.post("/api/stock-movements/transfer", json={
        "product_id": prod["id"], "quantity": 1, "from_location_id": src["id"], "to_location_id": dst["id"],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "serial" in resp.json()["detail"].lower()


def _receive_serials(auth_headers, product_id, serials, location_id):
    return client.post("/api/receipts", json={
        "items": [{"product_id": product_id, "quantity": len(serials), "serial_numbers": serials, "location_id": location_id}],
    }, headers=auth_headers)


def test_transfer_serialized_by_serial_number(auth_headers):
    src = _loc(auth_headers, "TRF-SRCA")
    dst = _loc(auth_headers, "TRF-DSTA")
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "TRF-SERA", "name": "Ser A", "unit_price": 1.0, "cost_price": 2.0, "quantity": 0, "is_serialized": True,
    }, headers=auth_headers).json()
    assert _receive_serials(auth_headers, prod["id"], ["S-A1", "S-A2"], src["id"]).status_code == 201
    serials = client.get("/api/serial-numbers", params={"product_id": prod["id"]}, headers=auth_headers).json()["items"]
    assert len(serials) == 2

    resp = client.post("/api/stock-movements/transfer-serial", json={
        "product_id": prod["id"], "serial_ids": [s["id"] for s in serials],
        "from_location_id": src["id"], "to_location_id": dst["id"],
    }, headers=auth_headers)
    assert resp.status_code == 201
    body = resp.json()
    assert body["reference"].startswith("TRF-")
    assert body["count"] == 2
    types = [m["movement_type"] for m in body["movements"]]
    assert types.count("transfer_out") == 2
    assert types.count("transfer_in") == 2

    after = client.get("/api/serial-numbers", params={"product_id": prod["id"]}, headers=auth_headers).json()["items"]
    for s in after:
        assert s["location_id"] == dst["id"]
    prod_after = client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()
    assert prod_after["quantity"] == 2


def test_transfer_serial_wrong_source_rejected(auth_headers):
    src = _loc(auth_headers, "TRF-SRCB")
    dst = _loc(auth_headers, "TRF-DSTB")
    other = _loc(auth_headers, "TRF-OTHB")
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "TRF-SERB", "name": "Ser B", "unit_price": 1.0, "quantity": 0, "is_serialized": True,
    }, headers=auth_headers).json()
    assert _receive_serials(auth_headers, prod["id"], ["S-B1"], src["id"]).status_code == 201
    serials = client.get("/api/serial-numbers", params={"product_id": prod["id"]}, headers=auth_headers).json()["items"]

    resp = client.post("/api/stock-movements/transfer-serial", json={
        "product_id": prod["id"], "serial_ids": [serials[0]["id"]],
        "from_location_id": other["id"], "to_location_id": dst["id"],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "not at" in resp.json()["detail"].lower()


def test_transfer_serial_requires_serialized_product(auth_headers):
    src = _loc(auth_headers, "TRF-SRCC")
    dst = _loc(auth_headers, "TRF-DSTC")
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "TRF-NOTSER", "name": "Not Ser", "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    resp = client.post("/api/stock-movements/transfer-serial", json={
        "product_id": prod["id"], "serial_ids": [1], "from_location_id": src["id"], "to_location_id": dst["id"],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "not serialized" in resp.json()["detail"].lower()


def test_transfer_serial_same_location_rejected(auth_headers):
    src = _loc(auth_headers, "TRF-SRCD")
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "TRF-SERD", "name": "Ser D", "unit_price": 1.0, "quantity": 0, "is_serialized": True,
    }, headers=auth_headers).json()
    assert _receive_serials(auth_headers, prod["id"], ["S-D1"], src["id"]).status_code == 201
    serials = client.get("/api/serial-numbers", params={"product_id": prod["id"]}, headers=auth_headers).json()["items"]
    resp = client.post("/api/stock-movements/transfer-serial", json={
        "product_id": prod["id"], "serial_ids": [serials[0]["id"]],
        "from_location_id": src["id"], "to_location_id": src["id"],
    }, headers=auth_headers)
    assert resp.status_code == 400


def test_transfer_pair_linked_both_ways(auth_headers):
    src = _loc(auth_headers, "TRF-PRSRC")
    dst = _loc(auth_headers, "TRF-PRDST")
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "TRF-PAIR", "name": "Pair Link", "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    _receive(auth_headers, prod["id"], 8, src["id"])
    body = client.post("/api/stock-movements/transfer", json={
        "product_id": prod["id"], "quantity": 3, "from_location_id": src["id"], "to_location_id": dst["id"],
    }, headers=auth_headers).json()
    out, inbound = body["movements"]
    assert out["transfer_id"] == inbound["id"]
    assert inbound["transfer_id"] == out["id"]
    assert out["from_location_name"] == "Loc TRF-PRSRC"
    assert inbound["to_location_name"] == "Loc TRF-PRDST"


def test_delete_transfer_leg_reverts_whole_pair(auth_headers):
    src = _loc(auth_headers, "TRF-DLSRC")
    dst = _loc(auth_headers, "TRF-DLDST")
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "TRF-DLPR", "name": "Delete Pair", "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    _receive(auth_headers, prod["id"], 10, src["id"])
    body = client.post("/api/stock-movements/transfer", json={
        "product_id": prod["id"], "quantity": 4, "from_location_id": src["id"], "to_location_id": dst["id"],
    }, headers=auth_headers).json()
    out, inbound = body["movements"]

    resp = client.delete(f"/api/stock-movements/{out['id']}", headers=auth_headers)
    assert resp.status_code == 200

    remaining = {m["id"] for m in client.get("/api/stock-movements", headers=auth_headers).json()["items"]}
    assert out["id"] not in remaining
    assert inbound["id"] not in remaining

    prod_after = client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()
    assert prod_after["quantity"] == 10

    locs = client.get("/api/stock-movements/locations", params={"product_id": prod["id"]}, headers=auth_headers).json()["locations"]
    by_id = {l["location_id"]: l["quantity"] for l in locs}
    assert by_id.get(src["id"]) == 10
    assert dst["id"] not in by_id


def test_delete_transfer_serial_pair_restores_serial_location(auth_headers):
    src = _loc(auth_headers, "TRF-DLSRA")
    dst = _loc(auth_headers, "TRF-DLSRB")
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "TRF-DLSER", "name": "Delete Ser", "unit_price": 1.0, "quantity": 0, "is_serialized": True,
    }, headers=auth_headers).json()
    assert _receive_serials(auth_headers, prod["id"], ["S-DEL1"], src["id"]).status_code == 201
    serial_id = client.get("/api/serial-numbers", params={"product_id": prod["id"]}, headers=auth_headers).json()["items"][0]["id"]
    body = client.post("/api/stock-movements/transfer-serial", json={
        "product_id": prod["id"], "serial_ids": [serial_id],
        "from_location_id": src["id"], "to_location_id": dst["id"],
    }, headers=auth_headers).json()
    out, inbound = body["movements"]
    assert out["transfer_id"] == inbound["id"]

    resp = client.delete(f"/api/stock-movements/{inbound['id']}", headers=auth_headers)
    assert resp.status_code == 200

    serials = client.get("/api/serial-numbers", params={"product_id": prod["id"]}, headers=auth_headers).json()["items"]
    assert serials[0]["location_id"] == src["id"]
    assert serials[0]["status"] == "in_stock"


def test_edit_transfer_leg_blocked(auth_headers):
    src = _loc(auth_headers, "TRF-EDSRC")
    dst = _loc(auth_headers, "TRF-EDDST")
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "TRF-EDPR", "name": "Edit Pair", "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    _receive(auth_headers, prod["id"], 6, src["id"])
    out, inbound = client.post("/api/stock-movements/transfer", json={
        "product_id": prod["id"], "quantity": 2, "from_location_id": src["id"], "to_location_id": dst["id"],
    }, headers=auth_headers).json()["movements"]

    resp = client.put(f"/api/stock-movements/{out['id']}", json={"quantity_change": -3}, headers=auth_headers)
    assert resp.status_code == 400
    assert "pair" in resp.json()["detail"].lower()

    resp = client.put(f"/api/stock-movements/{inbound['id']}", json={"notes": "typo fix"}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["notes"] == "typo fix"


def test_transfer_over_lot_available_rejected_with_lot_detail(auth_headers):
    src = _loc(auth_headers, "TRF-LOTSRC")
    dst = _loc(auth_headers, "TRF-LOTDST")
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "TRF-LOTPR", "name": "Lot Detail", "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    _receive(auth_headers, prod["id"], 3, src["id"], lot="LOT-X")
    lot_id = client.get("/api/stock-movements/locations", params={"product_id": prod["id"]}, headers=auth_headers).json()["locations"][0]["lots"][0]["lot_id"]

    resp = client.post("/api/stock-movements/transfer", json={
        "product_id": prod["id"], "quantity": 5, "from_location_id": src["id"], "to_location_id": dst["id"], "lot_id": lot_id,
    }, headers=auth_headers)
    assert resp.status_code == 400
    detail = resp.json()["detail"]
    assert "LOT-X" in detail
    assert "3" in detail
