from tests.conftest import client


def _prod(auth_headers, sku, serialized=False):
    return client.post("/api/products", json={
        "location_id": 1, "sku": sku, "name": sku, "quantity": 0,
        "cost_price": 5.0, "is_serialized": serialized,
    }, headers=auth_headers).json()


def _assert_csv(resp, needle):
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/csv")
    assert "Content-Disposition" in resp.headers
    body = resp.content.decode()
    assert body.startswith(("Lot #,", "Serial #,", "LPN #,", "Date,"))
    assert needle in body


def test_lots_export(auth_headers):
    prod = _prod(auth_headers, "EXP-LOT")
    client.post("/api/receipts", json={"items": [{"product_id": prod["id"], "quantity": 3, "lot_number": "LOT-EXP1"}]}, headers=auth_headers)
    _assert_csv(client.get("/api/lots/export", headers=auth_headers), "LOT-EXP1")


def test_serial_numbers_export(auth_headers):
    prod = _prod(auth_headers, "EXP-SER", serialized=True)
    client.post("/api/receipts", json={"items": [{"product_id": prod["id"], "quantity": 1, "serial_numbers": ["S-EXP-1"]}]}, headers=auth_headers)
    _assert_csv(client.get("/api/serial-numbers/export", headers=auth_headers), "S-EXP-1")


def test_lpns_export(auth_headers):
    prod = _prod(auth_headers, "EXP-LPN")
    lpn = client.post("/api/lpns", json={"lpn_number": "PAL-EXP1", "location_id": 1}, headers=auth_headers).json()
    client.post(f"/api/lpns/{lpn['id']}/items", json={"product_id": prod["id"], "quantity": 2, "from_location_id": 1}, headers=auth_headers)
    _assert_csv(client.get("/api/lpns/export", headers=auth_headers), "PAL-EXP1")


def test_activity_logs_export(auth_headers):
    client.post("/api/products", json={"location_id": 1, "sku": "EXP-LOG", "name": "Log"}, headers=auth_headers)
    _assert_csv(client.get("/api/activity-logs/export", headers=auth_headers), "product")


def test_products_export_respects_range_filters(auth_headers):
    client.post("/api/products", json={"location_id": 1, "sku": "EXP-CHEAP", "name": "Cheap", "quantity": 0,
                                       "unit_price": 5, "cost_price": 2}, headers=auth_headers).json()
    client.post("/api/products", json={"location_id": 1, "sku": "EXP-DEAR", "name": "Dear", "quantity": 0,
                                       "unit_price": 500, "cost_price": 2}, headers=auth_headers).json()

    resp = client.get("/api/reports/export/products", params={"price_max": "100"}, headers=auth_headers)
    assert resp.status_code == 200
    body = resp.content.decode()
    assert "EXP-CHEAP" in body
    assert "EXP-DEAR" not in body
