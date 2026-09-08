from app.models import SerialNumber, StockLine, User
from app.services import inventory
from tests.conftest import TestingSessionLocal, client


def _create_location(auth_headers, name="Bin A-01", code="A-01", location_type="bin", parent_id=None):
    return client.post("/api/locations", json={
        "name": name, "code": code, "location_type": location_type, "parent_id": parent_id,
    }, headers=auth_headers)


def test_location_crud(auth_headers):
    resp = _create_location(auth_headers)
    assert resp.status_code == 201
    loc = resp.json()
    assert loc["path"] == "Bin A-01"
    assert loc["location_type"] == "bin"

    child = _create_location(auth_headers, name="Shelf 1", code="A-01-01", parent_id=loc["id"])
    assert child.status_code == 201
    assert child.json()["path"] == "Bin A-01 / Shelf 1"

    tree = client.get("/api/locations/tree", headers=auth_headers).json()
    assert len(tree) == 2
    bin_node = next(n for n in tree if n["name"] == "Bin A-01")
    assert bin_node["children"][0]["name"] == "Shelf 1"

    updated = client.put(f"/api/locations/{loc['id']}", json={"location_type": "aisle"}, headers=auth_headers)
    assert updated.status_code == 200
    assert updated.json()["location_type"] == "aisle"

    assert client.delete(f"/api/locations/{child.json()['id']}", headers=auth_headers).status_code == 200


def test_location_delete_blocked_with_stock(auth_headers):
    loc = _create_location(auth_headers).json()
    prod = client.post("/api/products", json={
        "sku": "LOC-STOCK", "name": "Loc Stock", "unit_price": 1.0, "quantity": 0, "location_id": loc["id"],
    }, headers=auth_headers).json()
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 3, "location_id": loc["id"]}],
    }, headers=auth_headers).status_code == 201

    # Soft delete succeeds; permanent delete is blocked while stock is present.
    assert client.delete(f"/api/locations/{loc['id']}", headers=auth_headers).status_code == 200
    assert client.delete(f"/api/trash/location/{loc['id']}", headers=auth_headers).status_code == 400


def test_location_delete_blocked_with_children(auth_headers):
    loc = _create_location(auth_headers, code="P-BLOCK").json()
    _create_location(auth_headers, name="Kid", code="P-BLOCK-1", parent_id=loc["id"])
    # Soft delete succeeds; permanent delete is blocked while child locations exist.
    assert client.delete(f"/api/locations/{loc['id']}", headers=auth_headers).status_code == 200
    assert client.delete(f"/api/trash/location/{loc['id']}", headers=auth_headers).status_code == 400


def test_duplicate_location_code_rejected(auth_headers):
    _create_location(auth_headers, code="DUP")
    resp = _create_location(auth_headers, name="Other", code="DUP")
    assert resp.status_code == 400


def test_product_location_id_wiring(auth_headers):
    loc = _create_location(auth_headers).json()
    prod = client.post("/api/products", json={
        "sku": "LOC-PROD", "name": "Loc Prod", "unit_price": 1.0, "quantity": 0, "location_id": loc["id"],
    }, headers=auth_headers).json()
    assert prod["location_id"] == loc["id"]

    fetched = client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()
    assert fetched["location_id"] == loc["id"]

    assert client.post("/api/products", json={
        "sku": "LOC-BAD", "name": "Bad", "quantity": 0, "location_id": 99999,
    }, headers=auth_headers).status_code == 400


def test_product_zero_qty_shows_configured_location(auth_headers):
    loc = _create_location(auth_headers).json()
    prod = client.post("/api/products", json={
        "sku": "LOC-ZERO", "name": "Zero Qty Loc", "unit_price": 1.0, "quantity": 0, "location_id": loc["id"],
    }, headers=auth_headers).json()

    fetched = client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()
    assert fetched["quantity"] == 0
    assert fetched["location"] == loc["path"]
    assert fetched["location_id"] == loc["id"]

    items = client.get("/api/products", headers=auth_headers).json()["items"]
    listed = next(i for i in items if i["id"] == prod["id"])
    assert listed["location"] == loc["path"]

    resp = client.get("/api/products", params={"include_variants": 1}, headers=auth_headers)
    assert resp.status_code == 200
    variants_listed = next(i for i in resp.json()["items"] if i["id"] == prod["id"])
    assert variants_listed["location"] == loc["path"]


def test_product_location_change_moves_stock_between_locations(auth_headers):
    loc_a = _create_location(auth_headers, code="MOV-A").json()
    loc_b = _create_location(auth_headers, code="MOV-B").json()
    prod = client.post("/api/products", json={
        "sku": "LOC-MOVE", "name": "Move Loc Stock", "unit_price": 1.0, "quantity": 0,
        "location_id": loc_a["id"],
    }, headers=auth_headers).json()
    assert prod["location_id"] == loc_a["id"]

    received = client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 4, "unit_cost": 1.0}],
    }, headers=auth_headers)
    assert received.status_code == 201

    db = TestingSessionLocal()
    try:
        line = db.query(StockLine).filter(StockLine.product_id == prod["id"]).first()
        assert line is not None
        assert line.location_id == loc_a["id"]
        assert line.quantity == 4
    finally:
        db.close()

    resp = client.put(f"/api/products/{prod['id']}", json={
        "sku": "LOC-MOVE", "name": "Move Loc Stock", "unit_price": 1.0,
        "quantity": 4, "location_id": loc_b["id"], "location": loc_b["path"],
    }, headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["location_id"] == loc_b["id"]
    assert data["quantity"] == 4

    db = TestingSessionLocal()
    try:
        line = db.query(StockLine).filter(StockLine.product_id == prod["id"]).first()
        assert line.location_id == loc_b["id"]
        assert line.quantity == 4
    finally:
        db.close()


def test_worker_cannot_create_location(auth_headers):
    client.post("/api/users", json={
        "username": "loc_worker", "email": "loc_worker@example.com", "password": "workerpass123", "role": "worker",
    }, headers=auth_headers)
    token = client.post("/api/auth/login", json={"username": "loc_worker", "password": "workerpass123"}).json()["access_token"]
    worker = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/locations", headers=worker).status_code == 200
    assert _create_location(worker).status_code == 403


def test_location_type_validated(auth_headers):
    resp = _create_location(auth_headers, code="BADTYPE", location_type="binn")
    assert resp.status_code == 400

    loc = _create_location(auth_headers, code="TVALID").json()
    resp = client.put(f"/api/locations/{loc['id']}", json={"location_type": "cubby"}, headers=auth_headers)
    assert resp.status_code == 400


def test_location_parent_cycle_rejected(auth_headers):
    a = _create_location(auth_headers, code="CYC-A").json()
    b = _create_location(auth_headers, code="CYC-B", parent_id=a["id"]).json()
    c = _create_location(auth_headers, code="CYC-C", parent_id=b["id"]).json()

    resp = client.put(f"/api/locations/{a['id']}", json={"parent_id": c["id"]}, headers=auth_headers)
    assert resp.status_code == 400

    resp = client.put(f"/api/locations/{a['id']}", json={"parent_id": b["id"]}, headers=auth_headers)
    assert resp.status_code == 400

    assert client.put(f"/api/locations/{a['id']}", json={"parent_id": a["id"]}, headers=auth_headers).status_code == 400


def test_location_tree_and_list_include_quantity_and_value(auth_headers):
    loc = _create_location(auth_headers, code="QTY-1").json()
    prod = client.post("/api/products", json={
        "sku": "LOC-QTY", "name": "Qty Loc", "unit_price": 2.0, "cost_price": 5.0, "quantity": 0, "location_id": loc["id"],
    }, headers=auth_headers).json()
    client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 3, "location_id": loc["id"]}],
    }, headers=auth_headers)

    tree = client.get("/api/locations/tree", headers=auth_headers).json()
    node = next(n for n in tree if n["code"] == "QTY-1")
    assert node["stock_line_count"] == 1
    assert node["total_quantity"] == 3
    assert node["stock_value"] == 15.0

    items = client.get("/api/locations", headers=auth_headers).json()["items"]
    loc_item = next(i for i in items if i["id"] == loc["id"])
    assert loc_item["total_quantity"] == 3
    assert loc_item["stock_value"] == 15.0


def test_location_summary(auth_headers):
    _create_location(auth_headers, name="Sum One", code="SUM-1")
    _create_location(auth_headers, name="Sum Two", code="SUM-2")
    _create_location(auth_headers, name="Sum Three", code="SUM-3")
    summary = client.get("/api/locations/summary", headers=auth_headers).json()
    assert summary["total"] == 4
    assert summary["active"] == 4
    assert summary["inactive"] == 0
    assert summary["total_stock_lines"] == 0
    assert summary["total_value"] == 0.0

    items = client.get("/api/locations", headers=auth_headers).json()["items"]
    target = next(i for i in items if i["code"] == "SUM-1")
    client.put(f"/api/locations/{target['id']}", json={"is_active": False}, headers=auth_headers)
    summary2 = client.get("/api/locations/summary", headers=auth_headers).json()
    assert summary2["inactive"] == 1
    assert summary2["active"] == 3


def test_location_detail_endpoint(auth_headers):
    loc = _create_location(auth_headers, code="DET-1").json()
    prod = client.post("/api/products", json={
        "sku": "LOC-DET", "name": "Det Loc", "unit_price": 2.0, "cost_price": 5.0, "quantity": 0, "location_id": loc["id"],
    }, headers=auth_headers).json()
    client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 4, "location_id": loc["id"]}],
    }, headers=auth_headers)
    client.post("/api/lpns", json={"lpn_number": "LPN-DET", "lpn_type": "pallet", "location_id": loc["id"]}, headers=auth_headers)

    detail = client.get(f"/api/locations/{loc['id']}/detail", headers=auth_headers).json()
    assert detail["location"]["id"] == loc["id"]
    assert detail["location"]["total_quantity"] == 4
    assert len(detail["stock_lines"]) == 1
    assert detail["stock_lines"][0]["product_name"] == "Det Loc"
    assert detail["stock_lines"][0]["quantity"] == 4
    assert detail["stock_lines"][0]["value"] == 20.0
    assert len(detail["lpns"]) == 1
    assert detail["lpns"][0]["lpn_number"] == "LPN-DET"


def test_location_list_accepts_large_limit(auth_headers):
    resp = client.get("/api/locations", params={"limit": 5000}, headers=auth_headers)
    assert resp.status_code == 200


def _serialized_at(auth_headers, loc, sku, serials):
    prod = client.post("/api/products", json={
        "location_id": 1, "sku": sku, "name": f"Ser {sku}", "unit_price": 1.0,
        "cost_price": 5.0, "quantity": 0, "is_serialized": True,
    }, headers=auth_headers).json()
    resp = client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": len(serials), "serial_numbers": serials, "location_id": loc["id"]}],
    }, headers=auth_headers)
    assert resp.status_code == 201
    return prod


def test_location_stats_include_serialized_items(auth_headers):
    loc = _create_location(auth_headers, code="SERLOC-1").json()
    _serialized_at(auth_headers, loc, "SERLOC-P", ["S-1", "S-2"])

    tree = client.get("/api/locations/tree", headers=auth_headers).json()
    node = next(n for n in tree if n["code"] == "SERLOC-1")
    assert node["serial_count"] == 2
    assert node["total_quantity"] == 2
    assert node["stock_value"] == 10.0

    items = client.get("/api/locations", headers=auth_headers).json()["items"]
    loc_item = next(i for i in items if i["id"] == loc["id"])
    assert loc_item["serial_count"] == 2
    assert loc_item["total_quantity"] == 2
    assert loc_item["stock_value"] == 10.0


def test_location_summary_includes_serialized(auth_headers):
    loc = _create_location(auth_headers, code="SERSUM-1").json()
    _serialized_at(auth_headers, loc, "SERSUM-P", ["S-SUM"])
    summary = client.get("/api/locations/summary", headers=auth_headers).json()
    assert summary["total_serials"] == 1
    assert summary["total_quantity"] == 1
    assert summary["total_value"] == 5.0


def test_location_detail_includes_serialized(auth_headers):
    loc = _create_location(auth_headers, code="SERDET-1").json()
    prod = _serialized_at(auth_headers, loc, "SERDET-P", ["S-D1", "S-D2"])
    detail = client.get(f"/api/locations/{loc['id']}/detail", headers=auth_headers).json()
    assert len(detail["serials"]) == 2
    assert {s["serial_number"] for s in detail["serials"]} == {"S-D1", "S-D2"}
    assert detail["serials"][0]["product_name"] == prod["name"]
    assert detail["serials"][0]["value"] == 5.0


def test_location_detail_includes_reserved_serials(auth_headers):
    loc = _create_location(auth_headers, code="SERRES-1").json()
    prod = _serialized_at(auth_headers, loc, "SERRES-P", ["S-RES-1"])
    db = TestingSessionLocal()
    try:
        serial = db.query(SerialNumber).filter(SerialNumber.product_id == prod["id"]).first()
        serial.status = inventory.SERIAL_STATUS_RESERVED
        db.commit()
    finally:
        db.close()

    detail = client.get(f"/api/locations/{loc['id']}/detail", headers=auth_headers).json()
    reserved = [s for s in detail["serials"] if s["status"] == "reserved"]
    assert len(reserved) == 1
    assert reserved[0]["serial_number"] == "S-RES-1"
    assert reserved[0]["product_name"] == prod["name"]


def test_location_detail_serialized_lpn_total_quantity(auth_headers):
    """The location detail must count serialized units held inside an LPN."""
    loc = _create_location(auth_headers, code="SERLPN-1").json()
    prod = _serialized_at(auth_headers, loc, "SERLPN-P", ["S-LPN-1", "S-LPN-2"])
    lpn = client.post("/api/lpns", json={"lpn_number": "PAL-SERLPN", "location_id": loc["id"]}, headers=auth_headers).json()
    serials = client.get("/api/serial-numbers", params={"product_id": prod["id"]}, headers=auth_headers).json()["items"]
    assert client.post(f"/api/lpns/{lpn['id']}/items", json={
        "product_id": prod["id"], "serial_ids": [s["id"] for s in serials], "from_location_id": loc["id"],
    }, headers=auth_headers).status_code == 201

    detail = client.get(f"/api/locations/{loc['id']}/detail", headers=auth_headers).json()
    match = next(l for l in detail["lpns"] if l["id"] == lpn["id"])
    assert match["total_quantity"] == 2


def test_location_products_lists_stocked_items(auth_headers):
    loc = _create_location(auth_headers, code="PRODLOC-1").json()
    other = _create_location(auth_headers, code="PRODLOC-2").json()
    here = client.post("/api/products", json={
        "location_id": 1, "sku": "PRODLOC-H", "name": "Here", "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    away = client.post("/api/products", json={
        "location_id": 1, "sku": "PRODLOC-A", "name": "Away", "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    assert client.post("/api/receipts", json={
        "items": [{"product_id": here["id"], "quantity": 4, "location_id": loc["id"]}],
    }, headers=auth_headers).status_code == 201
    assert client.post("/api/receipts", json={
        "items": [{"product_id": away["id"], "quantity": 7, "location_id": other["id"]}],
    }, headers=auth_headers).status_code == 201

    body = client.get(f"/api/locations/{loc['id']}/products", headers=auth_headers).json()
    assert [i["product_id"] for i in body["items"]] == [here["id"]]
    assert body["items"][0]["name"] == here["name"]
    assert body["items"][0]["sku"] == here["sku"]
    assert body["items"][0]["quantity"] == 4
    assert body["items"][0]["is_serialized"] is False

    other_body = client.get(f"/api/locations/{other['id']}/products", headers=auth_headers).json()
    assert [i["product_id"] for i in other_body["items"]] == [away["id"]]


def test_location_products_includes_serialized(auth_headers):
    loc = _create_location(auth_headers, code="PRODSER-1").json()
    prod = _serialized_at(auth_headers, loc, "PRODSER-P", ["PS-1", "PS-2", "PS-3"])
    body = client.get(f"/api/locations/{loc['id']}/products", headers=auth_headers).json()
    assert [i["product_id"] for i in body["items"]] == [prod["id"]]
    assert body["items"][0]["is_serialized"] is True
    assert body["items"][0]["serial_count"] == 3
    assert body["items"][0]["quantity"] == 0


def test_location_products_excludes_quarantined_stock(auth_headers):
    loc = _create_location(auth_headers, code="PRODQ-1").json()
    prod = client.post("/api/products", json={
        "location_id": 1, "sku": "PRODQ-P", "name": "Quarantined", "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 5, "location_id": loc["id"], "lot_number": "PRODQ-LOT"}],
    }, headers=auth_headers).status_code == 201
    lots = client.get("/api/lots", params={"product_id": prod["id"]}, headers=auth_headers).json()["items"]
    lot_id = next(l["id"] for l in lots if l["lot_number"] == "PRODQ-LOT")
    assert client.put(f"/api/lots/{lot_id}", json={"status": "quarantined"}, headers=auth_headers).status_code == 200

    default = client.get(f"/api/locations/{loc['id']}/products", headers=auth_headers).json()
    assert default["items"] == []

    included = client.get(f"/api/locations/{loc['id']}/products", params={"include_quarantined": True}, headers=auth_headers).json()
    assert [i["product_id"] for i in included["items"]] == [prod["id"]]
    assert included["items"][0]["quantity"] == 5


def test_location_products_unknown_location_404(auth_headers):
    resp = client.get("/api/locations/99999/products", headers=auth_headers)
    assert resp.status_code == 404


def test_location_delete_blocked_with_serials(auth_headers):
    loc = _create_location(auth_headers, code="SERDEL-1").json()
    _serialized_at(auth_headers, loc, "SERDEL-P", ["S-DEL"])
    # Soft delete succeeds; permanent delete is blocked with serial number history.
    assert client.delete(f"/api/locations/{loc['id']}", headers=auth_headers).status_code == 200
    resp = client.delete(f"/api/trash/location/{loc['id']}", headers=auth_headers)
    assert resp.status_code == 400
    assert "serial" in resp.json()["detail"].lower()


def test_location_delete_blocked_with_product_assigned(auth_headers):
    loc = _create_location(auth_headers, code="P-ASSIGN").json()
    client.post("/api/products", json={
        "sku": "LOC-ASSIGN", "name": "Assigned Loc", "unit_price": 1.0, "quantity": 0, "location_id": loc["id"],
    }, headers=auth_headers)
    # Soft delete succeeds; permanent delete is blocked with assigned products.
    assert client.delete(f"/api/locations/{loc['id']}", headers=auth_headers).status_code == 200
    resp = client.delete(f"/api/trash/location/{loc['id']}", headers=auth_headers)
    assert resp.status_code == 400
    assert "product" in resp.json()["detail"].lower()


def test_location_delete_blocked_with_movement_history(auth_headers):
    src = _create_location(auth_headers, code="MOVHIST-A").json()
    dst = _create_location(auth_headers, code="MOVHIST-B").json()
    prod = client.post("/api/products", json={
        "sku": "LOC-MOVEH", "name": "Move Hist", "unit_price": 1.0, "quantity": 0, "location_id": 1,
    }, headers=auth_headers).json()
    client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 2, "location_id": src["id"]}],
    }, headers=auth_headers)
    assert client.post("/api/stock-movements/transfer", json={
        "product_id": prod["id"], "quantity": 2, "from_location_id": src["id"], "to_location_id": dst["id"],
    }, headers=auth_headers).status_code == 201
    # Soft delete succeeds; permanent delete is blocked with movement history.
    assert client.delete(f"/api/locations/{src['id']}", headers=auth_headers).status_code == 200
    resp = client.delete(f"/api/trash/location/{src['id']}", headers=auth_headers)
    assert resp.status_code == 400
    assert "movement" in resp.json()["detail"].lower()


def test_location_delete_blocked_with_scrapped_serials(auth_headers):
    loc = _create_location(auth_headers, code="SERDEL-2").json()
    prod = _serialized_at(auth_headers, loc, "SERDEL-2P", ["S-DEL2"])
    db = TestingSessionLocal()
    try:
        user_id = db.query(User).filter(User.username == "testuser").first().id
        inventory.scrap_serials(
            db, product_id=prod["id"], user_id=user_id, location_id=loc["id"], quantity=1, reference="test scrap",
        )
        db.commit()
    finally:
        db.close()
    # Soft delete succeeds; permanent delete is blocked with serial number history.
    assert client.delete(f"/api/locations/{loc['id']}", headers=auth_headers).status_code == 200
    resp = client.delete(f"/api/trash/location/{loc['id']}", headers=auth_headers)
    assert resp.status_code == 400
    assert "serial" in resp.json()["detail"].lower()


def test_location_delete_blocked_with_asn_history(auth_headers):
    loc = _create_location(auth_headers, code="ASNDEL-1").json()
    prod = client.post("/api/products", json={
        "sku": "LOC-ASND", "name": "ASN Loc", "unit_price": 1.0, "quantity": 0, "location_id": 1,
    }, headers=auth_headers).json()
    client.post("/api/asns", json={
        "items": [{"product_id": prod["id"], "expected_qty": 5, "location_id": loc["id"]}],
    }, headers=auth_headers)
    # Soft delete succeeds; permanent delete is blocked with ASN history.
    assert client.delete(f"/api/locations/{loc['id']}", headers=auth_headers).status_code == 200
    resp = client.delete(f"/api/trash/location/{loc['id']}", headers=auth_headers)
    assert resp.status_code == 400
    assert "asn" in resp.json()["detail"].lower()


def test_location_delete_blocked_with_shipment_staging(auth_headers):
    loc = _create_location(auth_headers, code="STAGDEL-1").json()
    db = TestingSessionLocal()
    try:
        from app.models import Shipment
        user_id = db.query(User).filter(User.username == "testuser").first().id
        shipment = Shipment(shipment_number="STAGE-TEST-1", staging_location_id=loc["id"], created_by=user_id)
        db.add(shipment)
        db.commit()
    finally:
        db.close()
    # Soft delete succeeds; permanent delete is blocked for a shipment staging area.
    assert client.delete(f"/api/locations/{loc['id']}", headers=auth_headers).status_code == 200
    resp = client.delete(f"/api/trash/location/{loc['id']}", headers=auth_headers)
    assert resp.status_code == 400
    assert "staging" in resp.json()["detail"].lower()


def test_update_location_blank_name_rejected(auth_headers):
    loc = _create_location(auth_headers, code="BLANK-NAME").json()
    assert client.put(f"/api/locations/{loc['id']}", json={"name": "   "}, headers=auth_headers).status_code == 400
    assert client.put(f"/api/locations/{loc['id']}", json={"name": None}, headers=auth_headers).status_code == 400
    assert client.get(f"/api/locations/{loc['id']}", headers=auth_headers).json()["name"] == "Bin A-01"


def test_update_location_clears_code_and_parent(auth_headers):
    parent = _create_location(auth_headers, code="CLEAR-P").json()
    child = _create_location(auth_headers, code="CLEAR-C", parent_id=parent["id"]).json()
    updated = client.put(f"/api/locations/{child['id']}", json={"code": None, "parent_id": None}, headers=auth_headers)
    assert updated.status_code == 200
    body = updated.json()
    assert body["code"] is None
    assert body["parent_id"] is None
    assert body["path"] == child["name"]


def test_location_counts_include_quarantined_serials(auth_headers):
    src = _create_location(auth_headers, name="QC Src", code="QC-SRC").json()
    qa = _create_location(auth_headers, name="QC QA", code="QC-QA", location_type="quarantine").json()
    prod = client.post("/api/products", json={
        "sku": "QC-SER", "name": "QC Ser", "unit_price": 1.0, "cost_price": 1.0,
        "quantity": 0, "location_id": src["id"], "is_serialized": True,
    }, headers=auth_headers).json()
    assert client.post("/api/receipts", json={"items": [{
        "product_id": prod["id"], "quantity": 2, "location_id": src["id"],
        "serial_numbers": ["QC-SER-1", "QC-SER-2"], "lot_number": "LOT-QC-SER",
    }]}, headers=auth_headers).status_code == 201
    serials = client.get("/api/serial-numbers", params={"product_id": prod["id"]}, headers=auth_headers).json()["items"]

    resp = client.post("/api/stock-movements/quarantine", json={
        "product_id": prod["id"], "serial_ids": [s["id"] for s in serials],
        "from_location_id": src["id"], "to_location_id": qa["id"],
    }, headers=auth_headers)
    assert resp.status_code == 201, resp.text

    locations = client.get("/api/locations", headers=auth_headers).json()["items"]
    qa_row = next(l for l in locations if l["id"] == qa["id"])
    assert qa_row["serial_count"] == 2
    assert qa_row["total_quantity"] == 2
    assert qa_row["stock_value"] == 2.0
    src_row = next(l for l in locations if l["id"] == src["id"])
    assert src_row["serial_count"] == 0
