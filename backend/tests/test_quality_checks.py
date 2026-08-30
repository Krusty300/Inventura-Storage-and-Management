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


def _make_location(auth_headers, code):
    return client.post("/api/locations", json={
        "code": code, "name": code, "location_type": "bin",
    }, headers=auth_headers).json()


def _receive(auth_headers, product_id, quantity, location_id, lot_number=""):
    return client.post("/api/receipts", json={
        "items": [{"product_id": product_id, "quantity": quantity,
                   "location_id": location_id, "lot_number": lot_number}],
    }, headers=auth_headers)


def _create_sale_with_location(auth_headers, items):
    return client.post("/api/sales", json={
        "items": [
            {"product_id": pid, "quantity": qty, "unit_price": 10.0, "location_id": loc_id}
            for pid, qty, loc_id in items
        ],
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


def test_quality_check_records_location(auth_headers):
    prod = _make_product(auth_headers, "QC-LOC")
    qc = client.post("/api/quality-checks", json={
        "product_id": prod["id"], "location_id": 1, "result": "pass",
    }, headers=auth_headers)
    assert qc.status_code == 201
    body = qc.json()
    assert body["location_id"] == 1
    assert body["location_name"] == "Default Location"

    # list endpoint filters by location
    listed = client.get("/api/quality-checks?location_id=1", headers=auth_headers).json()["items"]
    assert any(q["id"] == body["id"] for q in listed)
    other = client.get("/api/quality-checks?location_id=999999", headers=auth_headers).json()["items"]
    assert all(q["id"] != body["id"] for q in other)


def test_quality_check_rejects_inactive_or_missing_location(auth_headers):
    prod = _make_product(auth_headers, "QC-LOCBAD")
    # missing location
    assert client.post("/api/quality-checks", json={
        "product_id": prod["id"], "location_id": 999999, "result": "pass",
    }, headers=auth_headers).status_code == 404

    # inactive location
    loc2 = client.post("/api/locations", json={
        "name": "Inactive QC Loc", "code": "QCX", "location_type": "bin",
    }, headers=auth_headers)
    assert loc2.status_code == 201
    loc2_id = loc2.json()["id"]
    assert client.put(f"/api/locations/{loc2_id}", json={"is_active": False}, headers=auth_headers).status_code == 200
    resp = client.post("/api/quality-checks", json={
        "product_id": prod["id"], "location_id": loc2_id, "result": "pass",
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "inactive" in resp.json()["detail"]


def test_location_scoped_fail_blocks_sale_at_that_location_only(auth_headers):
    p = _make_product(auth_headers, "QC-LOCFAIL")
    loc_a = _make_location(auth_headers, "QC-LOCFAIL-A")
    loc_b = _make_location(auth_headers, "QC-LOCFAIL-B")
    assert _receive(auth_headers, p["id"], 5, loc_a["id"], lot_number="QC-LOCFAIL-LA").status_code == 201
    assert _receive(auth_headers, p["id"], 5, loc_b["id"], lot_number="QC-LOCFAIL-LB").status_code == 201

    qc = client.post("/api/quality-checks", json={
        "product_id": p["id"], "location_id": loc_a["id"], "result": "fail",
    }, headers=auth_headers)
    assert qc.status_code == 201

    # a sale drawn from the failed location is blocked
    blocked = _create_sale_with_location(auth_headers, [(p["id"], 1, loc_a["id"])])
    assert blocked.status_code == 400
    assert "quality check" in blocked.json()["detail"].lower()

    # a sale drawn from the unaffected location still succeeds
    ok = _create_sale_with_location(auth_headers, [(p["id"], 1, loc_b["id"])])
    assert ok.status_code == 201

    # passing the QC releases the block for the failed location
    assert client.put(f"/api/quality-checks/{qc.json()['id']}", json={"result": "pass"}, headers=auth_headers).status_code == 200
    ok2 = _create_sale_with_location(auth_headers, [(p["id"], 1, loc_a["id"])])
    assert ok2.status_code == 201


def test_location_scoped_pending_blocks_sale_at_that_location_only(auth_headers):
    p = _make_product(auth_headers, "QC-LOCPEND")
    loc_a = _make_location(auth_headers, "QC-LOCPEND-A")
    loc_b = _make_location(auth_headers, "QC-LOCPEND-B")
    assert _receive(auth_headers, p["id"], 5, loc_a["id"], lot_number="QC-LOCPEND-LA").status_code == 201
    assert _receive(auth_headers, p["id"], 5, loc_b["id"], lot_number="QC-LOCPEND-LB").status_code == 201

    qc = client.post("/api/quality-checks", json={
        "product_id": p["id"], "location_id": loc_a["id"], "result": "pending",
    }, headers=auth_headers)
    assert qc.status_code == 201

    blocked = _create_sale_with_location(auth_headers, [(p["id"], 1, loc_a["id"])])
    assert blocked.status_code == 400
    assert "quality check" in blocked.json()["detail"].lower()

    ok = _create_sale_with_location(auth_headers, [(p["id"], 1, loc_b["id"])])
    assert ok.status_code == 201
