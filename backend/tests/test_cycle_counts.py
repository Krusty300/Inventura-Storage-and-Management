from tests.conftest import client


def _make_product(auth_headers, sku):
    return client.post("/api/products", json={
        "sku": sku, "name": sku, "unit_price": 10.0, "quantity": 0,
    }, headers=auth_headers).json()


def test_cycle_count_flow_with_variance_posts_adjustment(auth_headers):
    prod = _make_product(auth_headers, "CC-PROD")
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 10}],
    }, headers=auth_headers).status_code == 201

    cc = client.post("/api/cycle-counts", json={
        "notes": "October count",
        "items": [{"product_id": prod["id"], "expected_qty": 10}],
    }, headers=auth_headers)
    assert cc.status_code == 201
    body = cc.json()
    assert body["cc_number"].startswith("CC-")
    assert body["status"] == "pending"

    submitted = client.post(f"/api/cycle-counts/{body['id']}/submit", json={
        "items": [{"product_id": prod["id"], "counted_qty": 8}],
    }, headers=auth_headers)
    assert submitted.status_code == 200
    result = submitted.json()
    assert result["status"] == "completed"
    assert result["has_variance"] is True
    assert result["total_variance"] == -2
    assert result["items"][0]["status"] == "mismatch"

    prod_after = client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()
    assert prod_after["quantity"] == 8


def test_cycle_count_exact_match_no_variance(auth_headers):
    prod = _make_product(auth_headers, "CC-OK")
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 5}],
    }, headers=auth_headers).status_code == 201
    cc = client.post("/api/cycle-counts", json={
        "items": [{"product_id": prod["id"], "expected_qty": 5}],
    }, headers=auth_headers).json()
    result = client.post(f"/api/cycle-counts/{cc['id']}/submit", json={
        "items": [{"product_id": prod["id"], "counted_qty": 5}],
    }, headers=auth_headers).json()
    assert result["has_variance"] is False
    assert result["items"][0]["status"] == "ok"
    assert client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()["quantity"] == 5


def test_cycle_count_unknown_product_rejected(auth_headers):
    prod = _make_product(auth_headers, "CC-UNK")
    cc = client.post("/api/cycle-counts", json={
        "items": [{"product_id": prod["id"], "expected_qty": 3}],
    }, headers=auth_headers).json()
    other = _make_product(auth_headers, "CC-OTH")
    resp = client.post(f"/api/cycle-counts/{cc['id']}/submit", json={
        "items": [{"product_id": other["id"], "counted_qty": 1}],
    }, headers=auth_headers)
    assert resp.status_code == 400


def test_cycle_count_cancel_and_double_submit(auth_headers):
    prod = _make_product(auth_headers, "CC-CAN")
    cc = client.post("/api/cycle-counts", json={
        "items": [{"product_id": prod["id"], "expected_qty": 1}],
    }, headers=auth_headers).json()
    assert client.put(f"/api/cycle-counts/{cc['id']}", json={"status": "cancelled"}, headers=auth_headers).status_code == 200
    resp = client.post(f"/api/cycle-counts/{cc['id']}/submit", json={
        "items": [{"product_id": prod["id"], "counted_qty": 1}],
    }, headers=auth_headers)
    assert resp.status_code == 400


def test_cycle_count_list_filter(auth_headers):
    prod = _make_product(auth_headers, "CC-LST")
    client.post("/api/cycle-counts", json={"items": [{"product_id": prod["id"], "expected_qty": 1}]}, headers=auth_headers)
    by_var = client.get("/api/cycle-counts", params={"has_variance": "false"}, headers=auth_headers).json()
    assert by_var["total"] == 1
