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
