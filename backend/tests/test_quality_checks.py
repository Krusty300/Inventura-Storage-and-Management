from tests.conftest import client


def _make_product(auth_headers, sku, serialized=False):
    return client.post("/api/products", json={
        "location_id": 1, "sku": sku, "name": sku, "unit_price": 10.0,
        "quantity": 0, "is_serialized": serialized,
    }, headers=auth_headers).json()


def _receive_serialized(auth_headers, product_id, serials, location_id, lot_number=""):
    return client.post("/api/receipts", json={
        "items": [{
            "product_id": product_id, "quantity": len(serials),
            "serial_numbers": serials, "location_id": location_id,
            "lot_number": lot_number,
        }],
    }, headers=auth_headers)


def test_quality_check_serialized_product_quarantines_lot(auth_headers):
    prod = _make_product(auth_headers, "QC-SER", serialized=True)
    resp = _receive_serialized(auth_headers, prod["id"], ["QCS-1", "QCS-2"], 1, lot_number="QC-SER-LOT")
    assert resp.status_code == 201

    lots = client.get("/api/lots", params={"product_id": prod["id"]}, headers=auth_headers).json()["items"]
    assert len(lots) == 1
    lot_id = lots[0]["id"]
    assert lots[0]["serial_count"] == 2

    qc = client.post("/api/quality-checks", json={
        "product_id": prod["id"], "lot_id": lot_id, "batch_number": "B-SER",
        "result": "fail", "notes": "",
    }, headers=auth_headers)
    assert qc.status_code == 201
    assert qc.json()["lot_number"] == "QC-SER-LOT"

    lot = client.get(f"/api/lots/{lot_id}", headers=auth_headers).json()
    assert lot["status"] == "quarantined"


def test_quality_check_serialized_exact_pass_keeps_lot_sellable(auth_headers):
    prod = _make_product(auth_headers, "QC-SEROK", serialized=True)
    assert _receive_serialized(auth_headers, prod["id"], ["QCOK-1"], 1, lot_number="QC-SEROK-LOT").status_code == 201

    lot_id = client.get("/api/lots", params={"product_id": prod["id"]}, headers=auth_headers).json()["items"][0]["id"]
    qc = client.post("/api/quality-checks", json={
        "product_id": prod["id"], "lot_id": lot_id, "result": "pass",
    }, headers=auth_headers)
    assert qc.status_code == 201

    lot = client.get(f"/api/lots/{lot_id}", headers=auth_headers).json()
    assert lot["status"] == "in_stock"
