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
    prod = client.post("/api/products", json={
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
    prod = client.post("/api/products", json={
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
    prod = client.post("/api/products", json={
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
    prod = client.post("/api/products", json={
        "sku": "TRF-SER", "name": "Ser", "unit_price": 1.0, "quantity": 0, "is_serialized": True,
    }, headers=auth_headers).json()
    resp = client.post("/api/stock-movements/transfer", json={
        "product_id": prod["id"], "quantity": 1, "from_location_id": src["id"], "to_location_id": dst["id"],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "serial" in resp.json()["detail"].lower()
