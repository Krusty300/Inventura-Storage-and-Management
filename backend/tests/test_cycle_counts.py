from tests.conftest import client


def _make_location(auth_headers, code="CC-LOC"):
    return client.post("/api/locations", json={
        "code": code, "name": code, "location_type": "bin",
    }, headers=auth_headers).json()


def _make_product(auth_headers, sku, serialized=False):
    return client.post("/api/products", json={"location_id": 1, 
        "sku": sku, "name": sku, "unit_price": 10.0, "quantity": 0,
        "is_serialized": serialized,
    }, headers=auth_headers).json()


def _receive(auth_headers, product_id, quantity, location_id):
    return client.post("/api/receipts", json={
        "items": [{"product_id": product_id, "quantity": quantity, "location_id": location_id}],
    }, headers=auth_headers)


def _receive_serialized(auth_headers, product_id, serials, location_id):
    return client.post("/api/receipts", json={
        "items": [{"product_id": product_id, "quantity": len(serials), "serial_numbers": serials, "location_id": location_id}],
    }, headers=auth_headers)


def _create_cc(auth_headers, product_id, location_id=None, expected=0):
    return client.post("/api/cycle-counts", json={
        "location_id": location_id,
        "items": [{"product_id": product_id, "expected_qty": expected}],
    }, headers=auth_headers)


def test_cycle_count_requires_location(auth_headers):
    prod = _make_product(auth_headers, "CC-NOLOC")
    resp = _create_cc(auth_headers, prod["id"])
    assert resp.status_code == 400
    assert "location" in resp.json()["detail"].lower()


def test_cycle_count_serialized_expected_uses_serial_count(auth_headers):
    prod = _make_product(auth_headers, "CC-SERX", serialized=True)
    loc = _make_location(auth_headers, "CC-SERX-LOC")
    assert _receive_serialized(auth_headers, prod["id"], ["SNX-1", "SNX-2", "SNX-3"], loc["id"]).status_code == 201
    cc = _create_cc(auth_headers, prod["id"], location_id=loc["id"], expected=999)
    assert cc.status_code == 201
    assert cc.json()["items"][0]["expected_qty"] == 3


def test_cycle_count_serialized_short_scraps_missing(auth_headers):
    prod = _make_product(auth_headers, "CC-SER2", serialized=True)
    loc = _make_location(auth_headers, "CC-SER2-LOC")
    serials = [f"SN2-{i}" for i in range(1, 6)]
    assert _receive_serialized(auth_headers, prod["id"], serials, loc["id"]).status_code == 201

    cc = _create_cc(auth_headers, prod["id"], location_id=loc["id"]).json()
    assert cc["items"][0]["expected_qty"] == 5

    result = client.post(f"/api/cycle-counts/{cc['id']}/submit", json={
        "items": [{"product_id": prod["id"], "counted_qty": 3}],
    }, headers=auth_headers).json()
    assert result["status"] == "completed"
    assert result["total_variance"] == -2
    assert result["items"][0]["status"] == "mismatch"

    statuses = {s["serial_number"]: s["status"] for s in client.get(
        "/api/serial-numbers", params={"product_id": prod["id"]}, headers=auth_headers
    ).json()["items"]}
    assert sum(1 for v in statuses.values() if v == "scrapped") == 2
    assert sum(1 for v in statuses.values() if v == "in_stock") == 3
    assert client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()["quantity"] == 3


def test_cycle_count_serialized_short_updates_location_qty(auth_headers):
    """A short serialized count must reduce the location's on-hand and post the
    scrap movements against the location so the route is visible on the stock
    movements page."""
    prod = _make_product(auth_headers, "CC-SERLOC", serialized=True)
    loc = _make_location(auth_headers, "CC-SERLOC-LOC")
    serials = [f"SNLOC-{i}" for i in range(1, 6)]
    assert _receive_serialized(auth_headers, prod["id"], serials, loc["id"]).status_code == 201

    before = client.get(f"/api/locations/{loc['id']}/detail", headers=auth_headers).json()
    assert before["location"]["total_quantity"] == 5
    assert len(before["serials"]) == 5
    assert before["scrapped_serials"] == []

    cc = _create_cc(auth_headers, prod["id"], location_id=loc["id"]).json()
    assert client.post(f"/api/cycle-counts/{cc['id']}/submit", json={
        "items": [{"product_id": prod["id"], "counted_qty": 3}],
    }, headers=auth_headers).status_code == 200

    after = client.get(f"/api/locations/{loc['id']}/detail", headers=auth_headers).json()
    assert after["location"]["total_quantity"] == 3
    assert len(after["serials"]) == 3
    assert all(s["status"] == "in_stock" for s in after["serials"])
    assert len(after["scrapped_serials"]) == 2
    assert {s["serial_number"] for s in after["scrapped_serials"]} == {"SNLOC-1", "SNLOC-2"}
    assert all(s["status"] == "scrapped" for s in after["scrapped_serials"])
    assert all(s["product_name"] == prod["name"] for s in after["scrapped_serials"])

    scrap = [m for m in client.get("/api/stock-movements", params={"limit": 50}, headers=auth_headers).json()["items"]
             if m["movement_type"] == "scrap"]
    assert len(scrap) == 2
    for m in scrap:
        assert m["from_location_id"] == loc["id"]
        assert m["from_location_name"] == loc["name"]
        assert m["quantity_change"] == -1
        assert m["serial_id"] is not None


def test_cycle_count_serialized_overage_rejected(auth_headers):
    prod = _make_product(auth_headers, "CC-SEROV", serialized=True)
    loc = _make_location(auth_headers, "CC-SEROV-LOC")
    assert _receive_serialized(auth_headers, prod["id"], ["SNOV-1", "SNOV-2"], loc["id"]).status_code == 201

    cc = _create_cc(auth_headers, prod["id"], location_id=loc["id"]).json()
    resp = client.post(f"/api/cycle-counts/{cc['id']}/submit", json={
        "items": [{"product_id": prod["id"], "counted_qty": 4}],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "overage" in resp.json()["detail"].lower()


def test_cycle_count_serialized_exact_match_no_variance(auth_headers):
    prod = _make_product(auth_headers, "CC-SEROK", serialized=True)
    loc = _make_location(auth_headers, "CC-SEROK-LOC")
    assert _receive_serialized(auth_headers, prod["id"], ["SNOK-1", "SNOK-2"], loc["id"]).status_code == 201
    cc = _create_cc(auth_headers, prod["id"], location_id=loc["id"]).json()
    result = client.post(f"/api/cycle-counts/{cc['id']}/submit", json={
        "items": [{"product_id": prod["id"], "counted_qty": 2}],
    }, headers=auth_headers).json()
    assert result["status"] == "completed"
    assert result["has_variance"] is False
    assert result["items"][0]["status"] == "ok"


def test_cycle_count_expected_autofilled_from_system(auth_headers):
    prod = _make_product(auth_headers, "CC-AUTO")
    loc = _make_location(auth_headers, "CC-AUTO-LOC")
    assert _receive(auth_headers, prod["id"], 10, loc["id"]).status_code == 201
    # client sends a bogus expected_qty; server must use system on-hand at the location
    cc = _create_cc(auth_headers, prod["id"], location_id=loc["id"], expected=999)
    assert cc.status_code == 201
    assert cc.json()["items"][0]["expected_qty"] == 10


def test_cycle_count_flow_with_variance_posts_adjustment(auth_headers):
    prod = _make_product(auth_headers, "CC-PROD")
    loc = _make_location(auth_headers, "CC-PROD-LOC")
    assert _receive(auth_headers, prod["id"], 10, loc["id"]).status_code == 201

    cc = _create_cc(auth_headers, prod["id"], location_id=loc["id"])
    assert cc.status_code == 201
    body = cc.json()
    assert body["cc_number"].startswith("CC-")
    assert body["status"] == "pending"
    assert body["location_id"] == loc["id"]
    assert body["items"][0]["expected_qty"] == 10

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
    loc = _make_location(auth_headers, "CC-OK-LOC")
    assert _receive(auth_headers, prod["id"], 5, loc["id"]).status_code == 201
    cc = _create_cc(auth_headers, prod["id"], location_id=loc["id"]).json()
    result = client.post(f"/api/cycle-counts/{cc['id']}/submit", json={
        "items": [{"product_id": prod["id"], "counted_qty": 5}],
    }, headers=auth_headers).json()
    assert result["has_variance"] is False
    assert result["items"][0]["status"] == "ok"
    assert client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()["quantity"] == 5


def test_cycle_count_unknown_product_rejected(auth_headers):
    prod = _make_product(auth_headers, "CC-UNK")
    loc = _make_location(auth_headers, "CC-UNK-LOC")
    cc = _create_cc(auth_headers, prod["id"], location_id=loc["id"]).json()
    other = _make_product(auth_headers, "CC-OTH")
    resp = client.post(f"/api/cycle-counts/{cc['id']}/submit", json={
        "items": [{"product_id": other["id"], "counted_qty": 1}],
    }, headers=auth_headers)
    assert resp.status_code == 400


def test_cycle_count_submit_reports_current_on_hand(auth_headers):
    """Submitting must re-validate against live on-hand and report it per item so
    a mid-count change is visible, while variance still reconciles against the
    snapshot taken when the count was created."""
    prod = _make_product(auth_headers, "CC-ONHAND")
    loc = _make_location(auth_headers, "CC-ONHAND-LOC")
    assert _receive(auth_headers, prod["id"], 10, loc["id"]).status_code == 201
    cc = _create_cc(auth_headers, prod["id"], location_id=loc["id"]).json()
    assert cc["items"][0]["expected_qty"] == 10

    # stock changes after the count was created (e.g. a receipt arrives)
    assert _receive(auth_headers, prod["id"], 3, loc["id"]).status_code == 201

    result = client.post(f"/api/cycle-counts/{cc['id']}/submit", json={
        "items": [{"product_id": prod["id"], "counted_qty": 12}],
    }, headers=auth_headers).json()
    assert result["items"][0]["current_on_hand"] == 13
    assert result["items"][0]["expected_qty"] == 10
    assert result["items"][0]["variance"] == 2
    assert client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()["quantity"] == 15


def test_cycle_count_cancel_and_double_submit(auth_headers):
    prod = _make_product(auth_headers, "CC-CAN")
    loc = _make_location(auth_headers, "CC-CAN-LOC")
    cc = _create_cc(auth_headers, prod["id"], location_id=loc["id"]).json()
    assert client.put(f"/api/cycle-counts/{cc['id']}", json={"status": "cancelled"}, headers=auth_headers).status_code == 200
    resp = client.post(f"/api/cycle-counts/{cc['id']}/submit", json={
        "items": [{"product_id": prod["id"], "counted_qty": 1}],
    }, headers=auth_headers)
    assert resp.status_code == 400


def test_cycle_count_list_filter(auth_headers):
    prod = _make_product(auth_headers, "CC-LST")
    loc = _make_location(auth_headers, "CC-LST-LOC")
    _create_cc(auth_headers, prod["id"], location_id=loc["id"])
    by_var = client.get("/api/cycle-counts", params={"has_variance": "false"}, headers=auth_headers).json()
    assert by_var["total"] == 1


def test_cycle_count_negative_variance_respects_lpn(auth_headers):
    """A short count must reduce the LPN stock line, not fail or create a loose line."""
    prod = _make_product(auth_headers, "CC-LPN")
    loc = _make_location(auth_headers, "CC-LPN-LOC")
    lpn = client.post("/api/lpns", json={"lpn_type": "pallet", "location_id": loc["id"]}, headers=auth_headers).json()
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 10, "location_id": loc["id"], "lpn_id": lpn["id"]}],
    }, headers=auth_headers).status_code == 201

    cc = _create_cc(auth_headers, prod["id"], location_id=loc["id"]).json()
    assert cc["items"][0]["expected_qty"] == 10
    result = client.post(f"/api/cycle-counts/{cc['id']}/submit", json={
        "items": [{"product_id": prod["id"], "counted_qty": 8}],
    }, headers=auth_headers).json()
    assert result["status"] == "completed" and result["total_variance"] == -2

    assert client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()["quantity"] == 8
    contents = client.get(f"/api/lpns/{lpn['id']}/contents", headers=auth_headers).json()
    assert contents["total_quantity"] == 8
    assert contents["contents"][0]["product_id"] == prod["id"]
    assert contents["contents"][0]["quantity"] == 8


def test_cycle_count_resubmit_posts_delta(auth_headers):
    """Re-counting a line must post the delta, so the final stock equals the final count."""
    p1 = _make_product(auth_headers, "CC-DELTA")
    p2 = _make_product(auth_headers, "CC-DELTA2")
    loc = _make_location(auth_headers, "CC-DELTA-LOC")
    for p in (p1, p2):
        assert client.post("/api/receipts", json={
            "items": [{"product_id": p["id"], "quantity": 10, "location_id": loc["id"]}],
        }, headers=auth_headers).status_code == 201

    cc = client.post("/api/cycle-counts", json={
        "location_id": loc["id"],
        "items": [{"product_id": p1["id"]}, {"product_id": p2["id"]}],
    }, headers=auth_headers).json()

    # partial: p1 counted short by 1 -> in_progress
    r = client.post(f"/api/cycle-counts/{cc['id']}/submit", json={
        "items": [{"product_id": p1["id"], "counted_qty": 9}],
    }, headers=auth_headers).json()
    assert r["status"] == "in_progress" and r["total_variance"] == -1

    # finish: recount p1 to 11, count p2 exact -> final stock p1 == 11
    r = client.post(f"/api/cycle-counts/{cc['id']}/submit", json={
        "items": [{"product_id": p1["id"], "counted_qty": 11}, {"product_id": p2["id"], "counted_qty": 10}],
    }, headers=auth_headers).json()
    assert r["status"] == "completed" and r["total_variance"] == 1, r
    assert client.get(f"/api/products/{p1['id']}", headers=auth_headers).json()["quantity"] == 11
    assert client.get(f"/api/products/{p2['id']}", headers=auth_headers).json()["quantity"] == 10
