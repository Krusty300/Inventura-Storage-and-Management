from app.models import StockLine
from tests.conftest import TestingSessionLocal, client


def _loc(auth_headers, code):
    return client.post("/api/locations", json={"name": f"Loc {code}", "code": code}, headers=auth_headers).json()


def test_create_and_list_lpn(auth_headers):
    loc = _loc(auth_headers, "LPN-A")
    created = client.post("/api/lpns", json={"lpn_number": "PAL-0001", "lpn_type": "pallet", "location_id": loc["id"]}, headers=auth_headers)
    assert created.status_code == 201
    lpn = created.json()
    assert lpn["lpn_number"] == "PAL-0001"
    assert lpn["location_name"] == loc["name"]

    auto = client.post("/api/lpns", json={"lpn_type": "carton"}, headers=auth_headers).json()
    assert auto["lpn_number"].startswith("LPN-")

    lst = client.get("/api/lpns", headers=auth_headers).json()
    assert lst["total"] == 2


def test_duplicate_lpn_rejected(auth_headers):
    client.post("/api/lpns", json={"lpn_number": "PAL-DUP"}, headers=auth_headers)
    resp = client.post("/api/lpns", json={"lpn_number": "PAL-DUP"}, headers=auth_headers)
    assert resp.status_code == 400


def test_receive_into_lpn_and_contents(auth_headers):
    loc = _loc(auth_headers, "LPN-B")
    lpn = client.post("/api/lpns", json={"lpn_number": "PAL-CONT", "location_id": loc["id"]}, headers=auth_headers).json()
    prod = client.post("/api/products", json={"location_id": 1, 
        "sku": "LPN-PROD", "name": "LPN Prod", "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 5, "location_id": loc["id"], "lpn_id": lpn["id"]}],
    }, headers=auth_headers).status_code == 201

    contents = client.get(f"/api/lpns/{lpn['id']}/contents", headers=auth_headers).json()
    assert contents["total_quantity"] == 5
    assert contents["contents"][0]["product_name"] == prod["name"]
    assert contents["contents"][0]["quantity"] == 5


def test_move_lpn_moves_contents(auth_headers):
    src = _loc(auth_headers, "LPN-C")
    dst = _loc(auth_headers, "LPN-D")
    lpn = client.post("/api/lpns", json={"lpn_number": "PAL-MOVE", "location_id": src["id"]}, headers=auth_headers).json()
    prod = client.post("/api/products", json={"location_id": 1, 
        "sku": "LPN-MOV", "name": "LPN Mov", "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 3, "location_id": src["id"], "lpn_id": lpn["id"]}],
    }, headers=auth_headers).status_code == 201

    moved = client.post(f"/api/lpns/{lpn['id']}/move", params={"to_location_id": dst["id"]}, headers=auth_headers)
    assert moved.status_code == 200
    assert moved.json()["location_id"] == dst["id"]

    prod_after = client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()
    assert prod_after["quantity"] == 3


def test_move_lpn_merges_into_existing_line(auth_headers):
    src = _loc(auth_headers, "LPN-E")
    dst = _loc(auth_headers, "LPN-F")
    lpn = client.post("/api/lpns", json={"lpn_number": "PAL-MRG", "location_id": src["id"]}, headers=auth_headers).json()
    prod = client.post("/api/products", json={"location_id": 1, 
        "sku": "LPN-MRG", "name": "LPN Mrg", "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    # Existing stock at dst for same product (no LPN)
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 2, "location_id": dst["id"]}],
    }, headers=auth_headers).status_code == 201
    # LPN stock at src
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 3, "location_id": src["id"], "lpn_id": lpn["id"]}],
    }, headers=auth_headers).status_code == 201

    moved = client.post(f"/api/lpns/{lpn['id']}/move", params={"to_location_id": dst["id"]}, headers=auth_headers)
    assert moved.status_code == 200
    assert client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()["quantity"] == 5


def test_lpn_detail_includes_serialized_items(auth_headers):
    loc = _loc(auth_headers, "LPN-L")
    lpn = client.post("/api/lpns", json={"lpn_number": "PAL-SER2", "location_id": loc["id"]}, headers=auth_headers).json()
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "LPN-SER2", "name": "LPN Ser2", "unit_price": 1.0, "quantity": 0, "is_serialized": True,
    }, headers=auth_headers).json()
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 2, "serial_numbers": ["S-LPN-A", "S-LPN-B"],
                   "location_id": loc["id"], "lpn_id": lpn["id"]}],
    }, headers=auth_headers).status_code == 201

    contents = client.get(f"/api/lpns/{lpn['id']}/contents", headers=auth_headers).json()
    assert contents["content_count"] == 2
    assert len(contents["serials"]) == 2
    assert {s["serial_number"] for s in contents["serials"]} == {"S-LPN-A", "S-LPN-B"}
    assert all(s["location_name"] == loc["name"] for s in contents["serials"])
    assert all(s["product_name"] == "LPN Ser2" for s in contents["serials"])
    lst = client.get("/api/lpns", headers=auth_headers).json()
    match = next(l for l in lst["items"] if l["id"] == lpn["id"])
    assert len(match["serials"]) == 2


def test_move_lpn_moves_serials(auth_headers):
    src = _loc(auth_headers, "LPN-J")
    dst = _loc(auth_headers, "LPN-K")
    lpn = client.post("/api/lpns", json={"lpn_number": "PAL-SER", "location_id": src["id"]}, headers=auth_headers).json()
    prod = client.post("/api/products", json={"location_id": 1, 
        "sku": "LPN-SER", "name": "LPN Ser", "unit_price": 1.0, "quantity": 0, "is_serialized": True,
    }, headers=auth_headers).json()
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 2, "serial_numbers": ["S-LPN-1", "S-LPN-2"],
                   "location_id": src["id"], "lpn_id": lpn["id"]}],
    }, headers=auth_headers).status_code == 201

    moved = client.post(f"/api/lpns/{lpn['id']}/move", params={"to_location_id": dst["id"]}, headers=auth_headers)
    assert moved.status_code == 200

    serials = client.get("/api/serial-numbers", params={"product_id": prod["id"]}, headers=auth_headers).json()
    assert serials["total"] == 2
    assert all(s["location_id"] == dst["id"] for s in serials["items"])


def test_delete_empty_lpn(auth_headers):
    loc = _loc(auth_headers, "LPN-G")
    lpn = client.post("/api/lpns", json={"lpn_number": "PAL-EMPTY", "location_id": loc["id"]}, headers=auth_headers).json()

    resp = client.delete(f"/api/lpns/{lpn['id']}", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["deleted"] == lpn["id"]

    assert client.get(f"/api/lpns/{lpn['id']}", headers=auth_headers).status_code == 404
    lst = client.get("/api/lpns", headers=auth_headers).json()
    assert all(item["id"] != lpn["id"] for item in lst["items"])


def test_delete_lpn_with_stock_rejected(auth_headers):
    loc = _loc(auth_headers, "LPN-H")
    lpn = client.post("/api/lpns", json={"lpn_number": "PAL-STK", "location_id": loc["id"]}, headers=auth_headers).json()
    prod = client.post("/api/products", json={"location_id": 1, 
        "sku": "LPN-STK", "name": "LPN Stk", "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 5, "location_id": loc["id"], "lpn_id": lpn["id"]}],
    }, headers=auth_headers).status_code == 201

    resp = client.delete(f"/api/lpns/{lpn['id']}", headers=auth_headers)
    assert resp.status_code == 400
    assert "stock on hand" in resp.json()["detail"]


def test_load_and_unload_lpn_quantity(auth_headers):
    loc = _loc(auth_headers, "LPN-LD1")
    lpn = client.post("/api/lpns", json={"lpn_number": "PAL-LD1", "location_id": loc["id"]}, headers=auth_headers).json()
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "LPN-LD1", "name": "LPN Load 1", "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 7, "location_id": loc["id"]}],
    }, headers=auth_headers).status_code == 201

    resp = client.post(f"/api/lpns/{lpn['id']}/items", json={
        "product_id": prod["id"], "quantity": 4, "from_location_id": loc["id"],
    }, headers=auth_headers)
    assert resp.status_code == 201
    assert resp.json()["total_quantity"] == 4

    # Location on-hand still counts the LPN-held stock.
    locs = client.get("/api/stock-movements/locations", params={"product_id": prod["id"]}, headers=auth_headers).json()["locations"]
    assert {l["location_id"]: l["quantity"] for l in locs}.get(loc["id"]) == 7

    resp = client.post(f"/api/lpns/{lpn['id']}/unload", json={
        "product_id": prod["id"], "quantity": 3, "to_location_id": loc["id"],
    }, headers=auth_headers)
    assert resp.status_code == 201
    assert resp.json()["total_quantity"] == 1
    assert client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()["quantity"] == 7


def test_unload_lpn_to_other_location(auth_headers):
    src = _loc(auth_headers, "LPN-UL1")
    dst = _loc(auth_headers, "LPN-UL2")
    lpn = client.post("/api/lpns", json={"lpn_number": "PAL-UL1", "location_id": src["id"]}, headers=auth_headers).json()
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "LPN-UL1", "name": "LPN Unload 1", "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 5, "location_id": src["id"], "lpn_id": lpn["id"]}],
    }, headers=auth_headers).status_code == 201

    resp = client.post(f"/api/lpns/{lpn['id']}/unload", json={
        "product_id": prod["id"], "quantity": 2, "to_location_id": dst["id"],
    }, headers=auth_headers)
    assert resp.status_code == 201
    assert resp.json()["total_quantity"] == 3

    locs = client.get("/api/stock-movements/locations", params={"product_id": prod["id"]}, headers=auth_headers).json()["locations"]
    by_id = {l["location_id"]: l["quantity"] for l in locs}
    assert by_id.get(src["id"]) == 3
    assert by_id.get(dst["id"]) == 2


def test_load_lpn_wrong_location_rejected(auth_headers):
    other = _loc(auth_headers, "LPN-WR")
    loc = _loc(auth_headers, "LPN-WL")
    lpn = client.post("/api/lpns", json={"lpn_number": "PAL-WR", "location_id": loc["id"]}, headers=auth_headers).json()
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "LPN-WR", "name": "LPN Wrong Loc", "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 4, "location_id": other["id"]}],
    }, headers=auth_headers).status_code == 201

    resp = client.post(f"/api/lpns/{lpn['id']}/items", json={
        "product_id": prod["id"], "quantity": 2, "from_location_id": other["id"],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "at" in resp.json()["detail"].lower()


def test_unload_lpn_over_available_rejected(auth_headers):
    loc = _loc(auth_headers, "LPN-OV")
    lpn = client.post("/api/lpns", json={"lpn_number": "PAL-OV", "location_id": loc["id"]}, headers=auth_headers).json()
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "LPN-OV", "name": "LPN Over", "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 2, "location_id": loc["id"], "lpn_id": lpn["id"]}],
    }, headers=auth_headers).status_code == 201

    resp = client.post(f"/api/lpns/{lpn['id']}/unload", json={
        "product_id": prod["id"], "quantity": 3, "to_location_id": loc["id"],
    }, headers=auth_headers)
    assert resp.status_code == 400


def test_load_and_unload_serialized_lpn(auth_headers):
    src = _loc(auth_headers, "LPN-SL1")
    dst = _loc(auth_headers, "LPN-SL2")
    lpn = client.post("/api/lpns", json={"lpn_number": "PAL-SL1", "location_id": src["id"]}, headers=auth_headers).json()
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "LPN-SL1", "name": "LPN Ser Load", "unit_price": 1.0, "quantity": 0, "is_serialized": True,
    }, headers=auth_headers).json()
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 2, "serial_numbers": ["S-LD-A", "S-LD-B"],
                   "location_id": src["id"]}],
    }, headers=auth_headers).status_code == 201
    serials = client.get("/api/serial-numbers", params={"product_id": prod["id"]}, headers=auth_headers).json()["items"]
    assert all(s["lpn_id"] is None for s in serials)

    resp = client.post(f"/api/lpns/{lpn['id']}/items", json={
        "product_id": prod["id"], "serial_ids": [s["id"] for s in serials], "from_location_id": src["id"],
    }, headers=auth_headers)
    assert resp.status_code == 201
    assert resp.json()["content_count"] == 2
    after = client.get("/api/serial-numbers", params={"product_id": prod["id"]}, headers=auth_headers).json()["items"]
    assert all(s["lpn_id"] == lpn["id"] for s in after)
    assert all(s["location_id"] == src["id"] for s in after)

    resp = client.post(f"/api/lpns/{lpn['id']}/unload", json={
        "product_id": prod["id"], "serial_ids": [s["id"] for s in serials], "to_location_id": dst["id"],
    }, headers=auth_headers)
    assert resp.status_code == 201
    assert resp.json()["content_count"] == 0
    after = client.get("/api/serial-numbers", params={"product_id": prod["id"]}, headers=auth_headers).json()["items"]
    assert all(s["lpn_id"] is None for s in after)
    assert all(s["location_id"] == dst["id"] for s in after)


def test_delete_lpn_detaches_historical_movements(auth_headers):
    loc = _loc(auth_headers, "LPN-I")
    lpn = client.post("/api/lpns", json={"lpn_number": "PAL-HIST", "location_id": loc["id"]}, headers=auth_headers).json()
    prod = client.post("/api/products", json={"location_id": 1, 
        "sku": "LPN-HIST", "name": "LPN Hist", "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 3, "location_id": loc["id"], "lpn_id": lpn["id"]}],
    }, headers=auth_headers).status_code == 201

    # Consume the stock so the LPN is empty, leaving the receipt movement on record
    db = TestingSessionLocal()
    try:
        line = db.query(StockLine).filter(StockLine.lpn_id == lpn["id"]).first()
        assert line is not None
        db.delete(line)
        db.commit()
    finally:
        db.close()

    resp = client.delete(f"/api/lpns/{lpn['id']}", headers=auth_headers)
    assert resp.status_code == 200

    movements = client.get(f"/api/products/{prod['id']}/movements", headers=auth_headers).json()
    assert len(movements) >= 1
    assert all(m["lpn_id"] is None for m in movements)


def test_lpn_activity_lists_receipt_load_and_unload(auth_headers):
    src = _loc(auth_headers, "LPN-AC1")
    lpn = client.post("/api/lpns", json={"lpn_number": "PAL-AC1", "location_id": src["id"]}, headers=auth_headers).json()
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "LPN-AC1", "name": "LPN Activity", "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    # receive straight onto the LPN
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 5, "location_id": src["id"], "lpn_id": lpn["id"]}],
    }, headers=auth_headers).status_code == 201
    # load loose stock in
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 3, "location_id": src["id"]}],
    }, headers=auth_headers).status_code == 201
    assert client.post(f"/api/lpns/{lpn['id']}/items", json={
        "product_id": prod["id"], "quantity": 2, "from_location_id": src["id"],
    }, headers=auth_headers).status_code == 201
    # unload some out
    assert client.post(f"/api/lpns/{lpn['id']}/unload", json={
        "product_id": prod["id"], "quantity": 1, "to_location_id": src["id"],
    }, headers=auth_headers).status_code == 201

    movements = client.get(f"/api/lpns/{lpn['id']}/movements", headers=auth_headers).json()
    assert len(movements) == 3
    types = {(m["reference_type"], m["movement_type"], m["quantity_change"]) for m in movements}
    assert ("receipt", "receive", 5) in types
    assert ("lpn_load", "transfer_in", 2) in types
    assert ("lpn_unload", "transfer_out", -1) in types
    assert all(m["product_name"] == "LPN Activity" for m in movements)
    assert all(m["lpn_id"] == lpn["id"] for m in movements)


def test_move_lpn_posts_journal_entries(auth_headers):
    src = _loc(auth_headers, "LPN-MV1")
    dst = _loc(auth_headers, "LPN-MV2")
    lpn = client.post("/api/lpns", json={"lpn_number": "PAL-MV1", "location_id": src["id"]}, headers=auth_headers).json()
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "LPN-MV1", "name": "LPN Move J", "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 3, "location_id": src["id"], "lpn_id": lpn["id"]}],
    }, headers=auth_headers).status_code == 201

    moved = client.post(f"/api/lpns/{lpn['id']}/move", params={"to_location_id": dst["id"]}, headers=auth_headers)
    assert moved.status_code == 200

    moves = [m for m in client.get(f"/api/lpns/{lpn['id']}/movements", headers=auth_headers).json()
             if m["reference_type"] == "lpn_move"]
    assert len(moves) == 2
    by_type = {m["movement_type"]: m for m in moves}
    out = by_type["transfer_out"]
    inbound = by_type["transfer_in"]
    assert out["quantity_change"] == -3
    assert inbound["quantity_change"] == 3
    assert out["reference"] == inbound["reference"] and inbound["reference"].startswith("MOV-")
    assert out["transfer_id"] == inbound["id"]
    assert inbound["transfer_id"] == out["id"]
    assert out["from_location_id"] == src["id"] and out["to_location_id"] == dst["id"]
    assert inbound["from_location_id"] == src["id"] and inbound["to_location_id"] == dst["id"]
    assert inbound["lpn_id"] == lpn["id"]


def test_move_lpn_serialized_posts_journal_entries(auth_headers):
    src = _loc(auth_headers, "LPN-MVS")
    dst = _loc(auth_headers, "LPN-MVD")
    lpn = client.post("/api/lpns", json={"lpn_number": "PAL-MVS", "location_id": src["id"]}, headers=auth_headers).json()
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "LPN-MVS", "name": "LPN Move S", "unit_price": 1.0, "quantity": 0, "is_serialized": True,
    }, headers=auth_headers).json()
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 2, "serial_numbers": ["S-MV-A", "S-MV-B"],
                   "location_id": src["id"], "lpn_id": lpn["id"]}],
    }, headers=auth_headers).status_code == 201

    moved = client.post(f"/api/lpns/{lpn['id']}/move", params={"to_location_id": dst["id"]}, headers=auth_headers)
    assert moved.status_code == 200
    assert all(s["location_id"] == dst["id"] for s in
               client.get("/api/serial-numbers", params={"product_id": prod["id"]}, headers=auth_headers).json()["items"])

    moves = [m for m in client.get(f"/api/lpns/{lpn['id']}/movements", headers=auth_headers).json()
             if m["reference_type"] == "lpn_move"]
    assert len(moves) == 4
    assert sum(1 for m in moves if m["movement_type"] == "transfer_out" and m["quantity_change"] == -1) == 2
    assert sum(1 for m in moves if m["movement_type"] == "transfer_in" and m["quantity_change"] == 1) == 2
    assert all(m["lpn_id"] == lpn["id"] for m in moves)


def test_lpn_serialized_double_load_rejected(auth_headers):
    src = _loc(auth_headers, "LPN-DL1")
    lpn1 = client.post("/api/lpns", json={"lpn_number": "PAL-DL1", "location_id": src["id"]}, headers=auth_headers).json()
    lpn2 = client.post("/api/lpns", json={"lpn_number": "PAL-DL2", "location_id": src["id"]}, headers=auth_headers).json()
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "LPN-DL1", "name": "LPN Dbl Load", "unit_price": 1.0, "quantity": 0, "is_serialized": True,
    }, headers=auth_headers).json()
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 1, "serial_numbers": ["S-DL-A"], "location_id": src["id"]}],
    }, headers=auth_headers).status_code == 201
    serial = client.get("/api/serial-numbers", params={"product_id": prod["id"]}, headers=auth_headers).json()["items"][0]

    first = client.post(f"/api/lpns/{lpn1['id']}/items", json={
        "product_id": prod["id"], "serial_ids": [serial["id"]], "from_location_id": src["id"],
    }, headers=auth_headers)
    assert first.status_code == 201

    second = client.post(f"/api/lpns/{lpn2['id']}/items", json={
        "product_id": prod["id"], "serial_ids": [serial["id"]], "from_location_id": src["id"],
    }, headers=auth_headers)
    assert second.status_code == 400
    assert "already assigned to an LPN" in second.json()["detail"]


def _quarantine_loc(auth_headers, code):
    return client.post("/api/locations", json={"name": f"Quarantine {code}", "code": code, "location_type": "quarantine"}, headers=auth_headers).json()


def _lot_for(auth_headers, product_id, lot_number):
    items = client.get("/api/lots", params={"product_id": product_id}, headers=auth_headers).json()["items"]
    return next(l for l in items if l["lot_number"] == lot_number)


def test_serialized_lpn_total_quantity_counts_serials(auth_headers):
    """Serialized units in an LPN count toward total_quantity."""
    src = _loc(auth_headers, "LPN-TQ")
    lpn = client.post("/api/lpns", json={"lpn_number": "PAL-TQ", "location_id": src["id"]}, headers=auth_headers).json()
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "LPN-TQ", "name": "LPN TQ", "unit_price": 1.0, "quantity": 0, "is_serialized": True,
    }, headers=auth_headers).json()
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 2, "serial_numbers": ["S-TQ-A", "S-TQ-B"],
                   "location_id": src["id"]}],
    }, headers=auth_headers).status_code == 201
    serials = client.get("/api/serial-numbers", params={"product_id": prod["id"]}, headers=auth_headers).json()["items"]
    resp = client.post(f"/api/lpns/{lpn['id']}/items", json={
        "product_id": prod["id"], "serial_ids": [s["id"] for s in serials], "from_location_id": src["id"],
    }, headers=auth_headers)
    assert resp.status_code == 201
    assert resp.json()["total_quantity"] == 2
    assert resp.json()["content_count"] == 2
    listed = client.get("/api/lpns", headers=auth_headers).json()
    match = next(l for l in listed["items"] if l["id"] == lpn["id"])
    assert match["total_quantity"] == 2


def test_unload_serialized_quarantined_lot_to_normal_rejected(auth_headers):
    """A serial whose lot is quarantined cannot be unloaded to a normal location."""
    src = _loc(auth_headers, "LPN-QN")
    dst = _loc(auth_headers, "LPN-QD")
    lpn = client.post("/api/lpns", json={"lpn_number": "PAL-QN", "location_id": src["id"]}, headers=auth_headers).json()
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "LPN-QN", "name": "LPN QN", "unit_price": 1.0, "quantity": 0, "is_serialized": True,
    }, headers=auth_headers).json()
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 1, "serial_numbers": ["S-QN-A"], "lot_number": "L-QN",
                   "location_id": src["id"]}],
    }, headers=auth_headers).status_code == 201
    serial = client.get("/api/serial-numbers", params={"product_id": prod["id"]}, headers=auth_headers).json()["items"][0]
    assert client.post(f"/api/lpns/{lpn['id']}/items", json={
        "product_id": prod["id"], "serial_ids": [serial["id"]], "from_location_id": src["id"],
    }, headers=auth_headers).status_code == 201
    lot = _lot_for(auth_headers, prod["id"], "L-QN")
    assert client.put(f"/api/lots/{lot['id']}", json={"status": "quarantined"}, headers=auth_headers).status_code == 200

    resp = client.post(f"/api/lpns/{lpn['id']}/unload", json={
        "product_id": prod["id"], "serial_ids": [serial["id"]], "to_location_id": dst["id"],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "quarantined" in resp.json()["detail"]


def test_unload_serialized_quarantined_lot_to_quarantine_allowed(auth_headers):
    """A serial whose lot is quarantined may be unloaded into a quarantine area."""
    src = _loc(auth_headers, "LPN-QL")
    q = _quarantine_loc(auth_headers, "LPN-Q")
    lpn = client.post("/api/lpns", json={"lpn_number": "PAL-QL", "location_id": src["id"]}, headers=auth_headers).json()
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "LPN-QL", "name": "LPN QL", "unit_price": 1.0, "quantity": 0, "is_serialized": True,
    }, headers=auth_headers).json()
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 1, "serial_numbers": ["S-QL-A"], "lot_number": "L-QL",
                   "location_id": src["id"]}],
    }, headers=auth_headers).status_code == 201
    serial = client.get("/api/serial-numbers", params={"product_id": prod["id"]}, headers=auth_headers).json()["items"][0]
    assert client.post(f"/api/lpns/{lpn['id']}/items", json={
        "product_id": prod["id"], "serial_ids": [serial["id"]], "from_location_id": src["id"],
    }, headers=auth_headers).status_code == 201
    lot = _lot_for(auth_headers, prod["id"], "L-QL")
    assert client.put(f"/api/lots/{lot['id']}", json={"status": "quarantined"}, headers=auth_headers).status_code == 200

    resp = client.post(f"/api/lpns/{lpn['id']}/unload", json={
        "product_id": prod["id"], "serial_ids": [serial["id"]], "to_location_id": q["id"],
    }, headers=auth_headers)
    assert resp.status_code == 201
    after = client.get("/api/serial-numbers", params={"product_id": prod["id"]}, headers=auth_headers).json()["items"][0]
    assert after["status"] == "quarantined"


def test_unload_serialized_expired_lot_rejected(auth_headers):
    """A serial whose lot is expired cannot be unloaded from an LPN."""
    src = _loc(auth_headers, "LPN-EX")
    dst = _loc(auth_headers, "LPN-EXD")
    lpn = client.post("/api/lpns", json={"lpn_number": "PAL-EX", "location_id": src["id"]}, headers=auth_headers).json()
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "LPN-EX", "name": "LPN EX", "unit_price": 1.0, "quantity": 0, "is_serialized": True,
    }, headers=auth_headers).json()
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 1, "serial_numbers": ["S-EX-A"], "lot_number": "L-EX",
                   "location_id": src["id"]}],
    }, headers=auth_headers).status_code == 201
    serial = client.get("/api/serial-numbers", params={"product_id": prod["id"]}, headers=auth_headers).json()["items"][0]
    assert client.post(f"/api/lpns/{lpn['id']}/items", json={
        "product_id": prod["id"], "serial_ids": [serial["id"]], "from_location_id": src["id"],
    }, headers=auth_headers).status_code == 201
    lot = _lot_for(auth_headers, prod["id"], "L-EX")
    assert client.put(f"/api/lots/{lot['id']}", json={"status": "expired"}, headers=auth_headers).status_code == 200

    resp = client.post(f"/api/lpns/{lpn['id']}/unload", json={
        "product_id": prod["id"], "serial_ids": [serial["id"]], "to_location_id": dst["id"],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "expired" in resp.json()["detail"]


def test_move_lpn_to_inactive_location_rejected(auth_headers):
    """Moving an LPN to an inactive location is rejected."""
    src = _loc(auth_headers, "LPN-IA")
    inactive = client.post("/api/locations", json={"name": "Inactive", "code": "LPN-IAX", "is_active": False}, headers=auth_headers).json()
    lpn = client.post("/api/lpns", json={"lpn_number": "PAL-IA", "location_id": src["id"]}, headers=auth_headers).json()
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "LPN-IA", "name": "LPN IA", "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 1, "location_id": src["id"], "lpn_id": lpn["id"]}],
    }, headers=auth_headers).status_code == 201

    resp = client.post(f"/api/lpns/{lpn['id']}/move", params={"to_location_id": inactive["id"]}, headers=auth_headers)
    assert resp.status_code == 400
    assert "inactive" in resp.json()["detail"]
