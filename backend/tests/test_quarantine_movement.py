from tests.conftest import client


def _loc(auth_headers, code):
    return client.post("/api/locations", json={"name": f"Loc {code}", "code": code}, headers=auth_headers).json()


def _q_loc(auth_headers, code):
    return client.post("/api/locations", json={"name": f"Quarantine {code}", "code": code, "location_type": "quarantine"}, headers=auth_headers).json()


def _receive(auth_headers, product_id, qty, location_id=None, lot=None, lpn_id=None, serial_numbers=None):
    item = {"product_id": product_id, "quantity": qty}
    if location_id is not None:
        item["location_id"] = location_id
    if lot:
        item["lot_number"] = lot
    if lpn_id is not None:
        item["lpn_id"] = lpn_id
    if serial_numbers:
        item["serial_numbers"] = serial_numbers
    resp = client.post("/api/receipts", json={"items": [item]}, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _lot(auth_headers, product_id, lot_number):
    lots = client.get("/api/lots", params={"product_id": product_id}, headers=auth_headers).json()
    return next(l for l in lots["items"] if l["lot_number"] == lot_number)


def _set_status(auth_headers, lot_id, status):
    resp = client.put(f"/api/lots/{lot_id}", json={"status": status}, headers=auth_headers)
    assert resp.status_code == 200, resp.text


def _set_expiry(auth_headers, lot_id, expiry_date):
    resp = client.put(f"/api/lots/{lot_id}", json={"expiry_date": expiry_date}, headers=auth_headers)
    assert resp.status_code == 200, resp.text


def _make_product(auth_headers, sku, serialized=False):
    return client.post("/api/products", json={
        "location_id": 1, "sku": sku, "name": sku, "unit_price": 1.0, "quantity": 0,
        "is_serialized": serialized,
    }, headers=auth_headers).json()


def test_transfer_rejects_specific_quarantined_lot(auth_headers):
    src = _loc(auth_headers, "QG-S1")
    dst = _loc(auth_headers, "QG-D1")
    prod = _make_product(auth_headers, "QG-P1")
    _receive(auth_headers, prod["id"], 5, src["id"], lot="LOT-Q1")
    lot = _lot(auth_headers, prod["id"], "LOT-Q1")
    _set_status(auth_headers, lot["id"], "quarantined")

    resp = client.post("/api/stock-movements/transfer", json={
        "product_id": prod["id"], "quantity": 2, "from_location_id": src["id"],
        "to_location_id": dst["id"], "lot_id": lot["id"],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "quarantined" in resp.json()["detail"]
    assert client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()["quantity"] == 5


def test_transfer_rejects_location_holding_only_quarantined_stock(auth_headers):
    src = _loc(auth_headers, "QG-S2")
    dst = _loc(auth_headers, "QG-D2")
    prod = _make_product(auth_headers, "QG-P2")
    _receive(auth_headers, prod["id"], 4, src["id"], lot="LOT-Q2")
    lot = _lot(auth_headers, prod["id"], "LOT-Q2")
    _set_status(auth_headers, lot["id"], "quarantined")

    resp = client.post("/api/stock-movements/transfer", json={
        "product_id": prod["id"], "quantity": 4, "from_location_id": src["id"], "to_location_id": dst["id"],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "LOT-Q2" in resp.json()["detail"]
    assert client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()["quantity"] == 4


def test_transfer_only_consumes_sellable_lot_when_mixed(auth_headers):
    src = _loc(auth_headers, "QG-S3")
    dst = _loc(auth_headers, "QG-D3")
    prod = _make_product(auth_headers, "QG-P3")
    _receive(auth_headers, prod["id"], 3, src["id"], lot="LOT-Q3")
    _receive(auth_headers, prod["id"], 5, src["id"], lot="LOT-S3")
    lot_q = _lot(auth_headers, prod["id"], "LOT-Q3")
    lot_s = _lot(auth_headers, prod["id"], "LOT-S3")
    _set_status(auth_headers, lot_q["id"], "quarantined")

    resp = client.post("/api/stock-movements/transfer", json={
        "product_id": prod["id"], "quantity": 5, "from_location_id": src["id"], "to_location_id": dst["id"],
    }, headers=auth_headers)
    assert resp.status_code == 201

    assert client.get(f"/api/lots/{lot_q['id']}", headers=auth_headers).json()["on_hand"] == 3
    locations = client.get("/api/stock-movements/locations", params={"product_id": prod["id"]}, headers=auth_headers).json()
    dst_entry = next(l for l in locations["locations"] if l["location_id"] == dst["id"])
    assert dst_entry["quantity"] == 5
    assert [l["lot_number"] for l in dst_entry["lots"]] == ["LOT-S3"]

    over = client.post("/api/stock-movements/transfer", json={
        "product_id": prod["id"], "quantity": 1, "from_location_id": src["id"], "to_location_id": dst["id"],
    }, headers=auth_headers)
    assert over.status_code == 400
    assert "LOT-Q3" in over.json()["detail"]


def test_transfer_rejects_expired_lot(auth_headers):
    src = _loc(auth_headers, "QG-S4")
    dst = _loc(auth_headers, "QG-D4")
    prod = _make_product(auth_headers, "QG-P4")
    _receive(auth_headers, prod["id"], 3, src["id"], lot="LOT-X1")
    lot = _lot(auth_headers, prod["id"], "LOT-X1")
    _set_status(auth_headers, lot["id"], "expired")

    resp = client.post("/api/stock-movements/transfer", json={
        "product_id": prod["id"], "quantity": 3, "from_location_id": src["id"], "to_location_id": dst["id"],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "expired" in resp.json()["detail"]


def test_stock_locations_excludes_quarantined_stock(auth_headers):
    src = _loc(auth_headers, "QG-S5")
    prod = _make_product(auth_headers, "QG-P5")
    _receive(auth_headers, prod["id"], 3, src["id"], lot="LOT-Q5")
    _receive(auth_headers, prod["id"], 7, src["id"], lot="LOT-S5")
    lot = _lot(auth_headers, prod["id"], "LOT-Q5")
    _set_status(auth_headers, lot["id"], "quarantined")

    body = client.get("/api/stock-movements/locations", params={"product_id": prod["id"]}, headers=auth_headers).json()
    entry = next(l for l in body["locations"] if l["location_id"] == src["id"])
    assert entry["quantity"] == 7
    assert [l["lot_number"] for l in entry["lots"]] == ["LOT-S5"]


def test_transfer_serial_rejects_quarantined_lot(auth_headers):
    src = _loc(auth_headers, "QG-S6")
    dst = _loc(auth_headers, "QG-D6")
    prod = _make_product(auth_headers, "QG-P6", serialized=True)
    _receive(auth_headers, prod["id"], 1, src["id"], lot="LOT-Q6", serial_numbers=["S-Q6-1"])
    lot = _lot(auth_headers, prod["id"], "LOT-Q6")
    _set_status(auth_headers, lot["id"], "quarantined")
    serial = client.get("/api/serial-numbers", params={"product_id": prod["id"]}, headers=auth_headers).json()["items"][0]

    resp = client.post("/api/stock-movements/transfer-serial", json={
        "product_id": prod["id"], "serial_ids": [serial["id"]],
        "from_location_id": src["id"], "to_location_id": dst["id"],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "LOT-Q6" in resp.json()["detail"]
    assert serial["lot_status"] == "quarantined"


def test_lpn_load_rejects_quarantined_lot(auth_headers):
    src = _loc(auth_headers, "QG-S7")
    lpn = client.post("/api/lpns", json={"lpn_number": "PAL-Q7", "location_id": src["id"]}, headers=auth_headers).json()
    prod = _make_product(auth_headers, "QG-P7")
    _receive(auth_headers, prod["id"], 4, src["id"], lot="LOT-Q7")
    lot = _lot(auth_headers, prod["id"], "LOT-Q7")
    _set_status(auth_headers, lot["id"], "quarantined")

    resp = client.post(f"/api/lpns/{lpn['id']}/items", json={
        "product_id": prod["id"], "quantity": 2, "lot_id": lot["id"], "from_location_id": src["id"],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "LOT-Q7" in resp.json()["detail"]


def test_lpn_unload_rejects_quarantined_lot(auth_headers):
    src = _loc(auth_headers, "QG-S8")
    dst = _loc(auth_headers, "QG-D8")
    lpn = client.post("/api/lpns", json={"lpn_number": "PAL-Q8", "location_id": src["id"]}, headers=auth_headers).json()
    prod = _make_product(auth_headers, "QG-P8")
    _receive(auth_headers, prod["id"], 4, src["id"], lot="LOT-Q8", lpn_id=lpn["id"])
    lot = _lot(auth_headers, prod["id"], "LOT-Q8")
    _set_status(auth_headers, lot["id"], "quarantined")

    resp = client.post(f"/api/lpns/{lpn['id']}/unload", json={
        "product_id": prod["id"], "quantity": 2, "to_location_id": dst["id"],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "LOT-Q8" in resp.json()["detail"]


def test_lpn_move_rejects_quarantined_lot(auth_headers):
    src = _loc(auth_headers, "QG-S9")
    dst = _loc(auth_headers, "QG-D9")
    lpn = client.post("/api/lpns", json={"lpn_number": "PAL-Q9", "location_id": src["id"]}, headers=auth_headers).json()
    prod = _make_product(auth_headers, "QG-P9")
    _receive(auth_headers, prod["id"], 3, src["id"], lot="LOT-Q9", lpn_id=lpn["id"])
    lot = _lot(auth_headers, prod["id"], "LOT-Q9")
    _set_status(auth_headers, lot["id"], "quarantined")

    resp = client.post(f"/api/lpns/{lpn['id']}/move", params={"to_location_id": dst["id"]}, headers=auth_headers)
    assert resp.status_code == 400
    assert "LOT-Q9" in resp.json()["detail"]


def test_unallocated_move_rejects_quarantined_lot(auth_headers):
    dst = _loc(auth_headers, "QG-D10")
    prod = _make_product(auth_headers, "QG-P10")
    _receive(auth_headers, prod["id"], 3, lot="LOT-Q10")
    lot = _lot(auth_headers, prod["id"], "LOT-Q10")
    _set_status(auth_headers, lot["id"], "quarantined")

    resp = client.post("/api/stock-movements/unallocated-move", json={
        "product_id": prod["id"], "quantity": 3, "to_location_id": dst["id"],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "LOT-Q10" in resp.json()["detail"]


def test_overdue_lot_auto_expires_on_products_list(auth_headers):
    prod = _make_product(auth_headers, "AE-P1")
    _receive(auth_headers, prod["id"], 5, lot="LOT-AE1")
    lot = _lot(auth_headers, prod["id"], "LOT-AE1")
    _set_expiry(auth_headers, lot["id"], "2020-01-01")
    assert client.get(f"/api/lots/{lot['id']}", headers=auth_headers).json()["status"] == "in_stock"

    resp = client.get("/api/products", headers=auth_headers)
    assert resp.status_code == 200
    assert client.get(f"/api/lots/{lot['id']}", headers=auth_headers).json()["status"] == "expired"


def test_overdue_lot_auto_expires_on_lots_and_dashboard(auth_headers):
    prod = _make_product(auth_headers, "AE-P2")
    _receive(auth_headers, prod["id"], 4, lot="LOT-AE2")
    lot = _lot(auth_headers, prod["id"], "LOT-AE2")
    _set_expiry(auth_headers, lot["id"], "2019-06-15")

    lots = client.get("/api/lots", headers=auth_headers).json()
    assert next(l for l in lots["items"] if l["lot_number"] == "LOT-AE2")["status"] == "expired"

    prod2 = _make_product(auth_headers, "AE-P3")
    _receive(auth_headers, prod2["id"], 2, lot="LOT-AE3")
    lot2 = _lot(auth_headers, prod2["id"], "LOT-AE3")
    _set_expiry(auth_headers, lot2["id"], "2019-06-15")

    client.get("/api/dashboard/stats", headers=auth_headers)
    assert client.get(f"/api/lots/{lot2['id']}", headers=auth_headers).json()["status"] == "expired"


def test_future_expiry_lot_stays_in_stock(auth_headers):
    prod = _make_product(auth_headers, "AE-P4")
    _receive(auth_headers, prod["id"], 3, lot="LOT-AE4")
    lot = _lot(auth_headers, prod["id"], "LOT-AE4")
    _set_expiry(auth_headers, lot["id"], "2999-12-31")

    client.get("/api/products", headers=auth_headers)
    assert client.get(f"/api/lots/{lot['id']}", headers=auth_headers).json()["status"] == "in_stock"


def test_quarantined_overdue_lot_not_auto_expired(auth_headers):
    prod = _make_product(auth_headers, "AE-P5")
    _receive(auth_headers, prod["id"], 3, lot="LOT-AE5")
    lot = _lot(auth_headers, prod["id"], "LOT-AE5")
    _set_status(auth_headers, lot["id"], "quarantined")
    _set_expiry(auth_headers, lot["id"], "2019-06-15")

    client.get("/api/products", headers=auth_headers)
    assert client.get(f"/api/lots/{lot['id']}", headers=auth_headers).json()["status"] == "quarantined"


def test_products_list_includes_quarantined_qty(auth_headers):
    prod = _make_product(auth_headers, "PQ-P1")
    _receive(auth_headers, prod["id"], 3, lot="LOT-PQ1")
    _receive(auth_headers, prod["id"], 7, lot="LOT-PQ2")
    lot = _lot(auth_headers, prod["id"], "LOT-PQ1")
    _set_status(auth_headers, lot["id"], "quarantined")

    body = client.get("/api/products", params={"search": "PQ-P1", "include_variants": "1"}, headers=auth_headers).json()
    item = next(p for p in body["items"] if p["id"] == prod["id"])
    assert item["quantity"] == 10
    assert item["quarantined_qty"] == 3


def test_lot_payload_includes_locations(auth_headers):
    loc = _loc(auth_headers, "LL-S1")
    prod = _make_product(auth_headers, "LL-P1")
    _receive(auth_headers, prod["id"], 5, loc["id"], lot="LOT-LL1")
    lot = _lot(auth_headers, prod["id"], "LOT-LL1")

    single = client.get(f"/api/lots/{lot['id']}", headers=auth_headers).json()
    assert single["locations"] == [loc["path"]]

    listing = client.get("/api/lots", params={"search": "LL-P1"}, headers=auth_headers).json()
    item = next(l for l in listing["items"] if l["id"] == lot["id"])
    assert loc["path"] in item["locations"]


def test_location_tree_and_summary_include_lot_counts(auth_headers):
    loc = _loc(auth_headers, "LC-S1")
    prod = _make_product(auth_headers, "LC-P1")
    _receive(auth_headers, prod["id"], 3, loc["id"], lot="LOT-LC1")
    _receive(auth_headers, prod["id"], 4, loc["id"], lot="LOT-LC2")

    tree = client.get("/api/locations/tree", headers=auth_headers).json()
    node = next(n for n in tree if n["id"] == loc["id"])
    assert node["lot_count"] == 2

    summary = client.get("/api/locations/summary", headers=auth_headers).json()
    assert summary["total_lots"] >= 2


def test_dashboard_stats_includes_total_lots(auth_headers):
    loc = _loc(auth_headers, "DS-S1")
    prod = _make_product(auth_headers, "DS-P1")
    _receive(auth_headers, prod["id"], 3, loc["id"], lot="LOT-DS1")

    stats = client.get("/api/dashboard/stats", headers=auth_headers).json()
    assert stats["total_lots"] >= 1


def test_quarantine_move_auto_quarantines_lot(auth_headers):
    src = _loc(auth_headers, "QM-S1")
    qa = _q_loc(auth_headers, "QM-Q1")
    prod = _make_product(auth_headers, "QM-P1")
    _receive(auth_headers, prod["id"], 6, src["id"], lot="LOT-QM1")
    lot = _lot(auth_headers, prod["id"], "LOT-QM1")
    assert lot["status"] == "in_stock"

    resp = client.post("/api/stock-movements/quarantine", json={
        "product_id": prod["id"], "quantity": 2, "from_location_id": src["id"], "to_location_id": qa["id"],
    }, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    assert resp.json()["reference"].startswith("QAR-")
    assert resp.json()["movements"][0]["reference_type"] == "quarantine"
    assert {m["movement_type"] for m in resp.json()["movements"]} == {"transfer_out", "transfer_in"}

    assert client.get(f"/api/lots/{lot['id']}", headers=auth_headers).json()["status"] == "quarantined"
    assert qa["path"] in client.get(f"/api/lots/{lot['id']}", headers=auth_headers).json()["locations"]
    assert client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()["quantity"] == 6
    assert client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()["quarantined_qty"] == 6


def test_quarantine_move_requires_quarantine_area(auth_headers):
    src = _loc(auth_headers, "QM-S2")
    dst = _loc(auth_headers, "QM-D2")
    prod = _make_product(auth_headers, "QM-P2")
    _receive(auth_headers, prod["id"], 3, src["id"], lot="LOT-QM2")

    resp = client.post("/api/stock-movements/quarantine", json={
        "product_id": prod["id"], "quantity": 3, "from_location_id": src["id"], "to_location_id": dst["id"],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "not a quarantine area" in resp.json()["detail"]


def test_quarantine_move_rejects_lpn_held_stock(auth_headers):
    src = _loc(auth_headers, "QM-S3")
    qa = _q_loc(auth_headers, "QM-Q3")
    lpn = client.post("/api/lpns", json={"lpn_number": "PAL-QM3", "location_id": src["id"]}, headers=auth_headers).json()
    prod = _make_product(auth_headers, "QM-P3")
    _receive(auth_headers, prod["id"], 4, src["id"], lot="LOT-QM3", lpn_id=lpn["id"])

    resp = client.post("/api/stock-movements/quarantine", json={
        "product_id": prod["id"], "quantity": 4, "from_location_id": src["id"], "to_location_id": qa["id"],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "Only 0 sellable" in resp.json()["detail"]


def test_quarantine_move_rejects_already_quarantined_lot(auth_headers):
    src = _loc(auth_headers, "QM-S4")
    qa = _q_loc(auth_headers, "QM-Q4")
    prod = _make_product(auth_headers, "QM-P4")
    _receive(auth_headers, prod["id"], 3, src["id"], lot="LOT-QM4")
    lot = _lot(auth_headers, prod["id"], "LOT-QM4")
    _set_status(auth_headers, lot["id"], "quarantined")

    resp = client.post("/api/stock-movements/quarantine", json={
        "product_id": prod["id"], "quantity": 3, "from_location_id": src["id"], "to_location_id": qa["id"], "lot_id": lot["id"],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "quarantined" in resp.json()["detail"]


def test_quarantine_move_serialized(auth_headers):
    src = _loc(auth_headers, "QM-S5")
    qa = _q_loc(auth_headers, "QM-Q5")
    prod = _make_product(auth_headers, "QM-P5", serialized=True)
    _receive(auth_headers, prod["id"], 1, src["id"], lot="LOT-QM5", serial_numbers=["S-QM5-1"])
    lot = _lot(auth_headers, prod["id"], "LOT-QM5")
    serial = client.get("/api/serial-numbers", params={"product_id": prod["id"]}, headers=auth_headers).json()["items"][0]

    resp = client.post("/api/stock-movements/quarantine", json={
        "product_id": prod["id"], "serial_ids": [serial["id"]],
        "from_location_id": src["id"], "to_location_id": qa["id"],
    }, headers=auth_headers)
    assert resp.status_code == 201, resp.text

    assert client.get(f"/api/lots/{lot['id']}", headers=auth_headers).json()["status"] == "quarantined"
    serial = client.get(f"/api/serial-numbers/{serial['id']}", headers=auth_headers).json()
    assert serial["status"] == "quarantined"
    assert serial["location_name"] == f"Quarantine QM-Q5"


def test_transfer_to_quarantine_area_auto_quarantines(auth_headers):
    src = _loc(auth_headers, "QM-S6")
    qa = _q_loc(auth_headers, "QM-Q6")
    prod = _make_product(auth_headers, "QM-P6")
    _receive(auth_headers, prod["id"], 5, src["id"], lot="LOT-QM6")
    lot = _lot(auth_headers, prod["id"], "LOT-QM6")

    resp = client.post("/api/stock-movements/transfer", json={
        "product_id": prod["id"], "quantity": 3, "from_location_id": src["id"], "to_location_id": qa["id"], "lot_id": lot["id"],
    }, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    assert client.get(f"/api/lots/{lot['id']}", headers=auth_headers).json()["status"] == "quarantined"
    assert client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()["quarantined_qty"] == 5


def test_transfer_serial_to_quarantine_area_auto_quarantines(auth_headers):
    src = _loc(auth_headers, "QM-S7")
    qa = _q_loc(auth_headers, "QM-Q7")
    prod = _make_product(auth_headers, "QM-P7", serialized=True)
    _receive(auth_headers, prod["id"], 1, src["id"], lot="LOT-QM7", serial_numbers=["S-QM7-1"])
    lot = _lot(auth_headers, prod["id"], "LOT-QM7")
    serial = client.get("/api/serial-numbers", params={"product_id": prod["id"]}, headers=auth_headers).json()["items"][0]

    resp = client.post("/api/stock-movements/transfer-serial", json={
        "product_id": prod["id"], "serial_ids": [serial["id"]],
        "from_location_id": src["id"], "to_location_id": qa["id"],
    }, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    assert client.get(f"/api/lots/{lot['id']}", headers=auth_headers).json()["status"] == "quarantined"
    assert client.get(f"/api/serial-numbers/{serial['id']}", headers=auth_headers).json()["status"] == "quarantined"
