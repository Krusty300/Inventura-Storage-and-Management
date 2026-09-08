from tests.conftest import client


def _make_serialized(auth_headers, sku, serials, lot_number):
    prod = client.post("/api/products", json={
        "location_id": 1, "sku": sku, "name": sku, "unit_price": 10.0,
        "quantity": 0, "is_serialized": True,
    }, headers=auth_headers).json()
    resp = client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": len(serials),
                   "serial_numbers": serials, "location_id": 1, "lot_number": lot_number}],
    }, headers=auth_headers)
    assert resp.status_code == 201
    lots = client.get("/api/lots", params={"product_id": prod["id"]}, headers=auth_headers).json()["items"]
    assert len(lots) == 1
    return prod, lots[0]


def test_releasing_last_quarantined_serial_attributes_lot_release(auth_headers):
    prod, lot = _make_serialized(auth_headers, "REL-ATTRIB", ["REL-A", "REL-B"], "REL-ATTRIB-LOT")
    lot_id = lot["id"]

    # Quarantining the lot cascades to its serials.
    assert client.put(f"/api/lots/{lot_id}", json={"status": "quarantined"}, headers=auth_headers).status_code == 200
    serials = client.get("/api/serial-numbers", params={
        "product_id": prod["id"], "status": "quarantined",
    }, headers=auth_headers).json()["items"]
    assert len(serials) == 2
    first, second = serials[0], serials[1]

    # Releasing the first serial leaves the lot quarantined.
    assert client.put(f"/api/serial-numbers/{first['id']}/status", json={"status": "in_stock"}, headers=auth_headers).status_code == 200
    assert client.get(f"/api/lots/{lot_id}", headers=auth_headers).json()["status"] == "quarantined"

    # Releasing the last quarantined serial also releases the lot...
    assert client.put(f"/api/serial-numbers/{second['id']}/status", json={"status": "in_stock"}, headers=auth_headers).status_code == 200
    assert client.get(f"/api/lots/{lot_id}", headers=auth_headers).json()["status"] == "in_stock"

    # ...and the lot release is attributed in the activity log.
    logs = client.get("/api/activity-logs", params={
        "entity_type": "lot", "entity_id": lot_id,
    }, headers=auth_headers).json()["items"]
    assert any(
        l["entity_type"] == "lot" and l["entity_id"] == lot_id and "released" in l["description"].lower()
        for l in logs
    )