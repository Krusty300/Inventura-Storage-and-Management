from app.models import StockMovement
from tests.conftest import TestingSessionLocal, client


def _make_product(auth_headers, sku="LOT-PROD"):
    return client.post("/api/products", json={"location_id": 1, 
        "sku": sku, "name": sku, "unit_price": 20.0, "cost_price": 10.0, "quantity": 0,
    }, headers=auth_headers).json()


def _receive_with_lot(auth_headers, product_id, qty, lot_number, expiry=None, supplier_id=None):
    item = {"product_id": product_id, "quantity": qty, "lot_number": lot_number}
    if expiry:
        item["expiry_date"] = expiry
    payload = {"items": [item]}
    if supplier_id:
        payload["supplier_id"] = supplier_id
    resp = client.post("/api/receipts", json=payload, headers=auth_headers)
    assert resp.status_code == 201
    return resp.json()


def _lot_for(auth_headers, product_id, lot_number):
    lots = client.get("/api/lots", params={"product_id": product_id}, headers=auth_headers).json()
    return next(l for l in lots["items"] if l["lot_number"] == lot_number)


def test_list_lots_with_filters(auth_headers):
    prod = _make_product(auth_headers)
    _receive_with_lot(auth_headers, prod["id"], 4, "LOT-AAA")
    _receive_with_lot(auth_headers, prod["id"], 2, "LOT-BBB")

    res = client.get("/api/lots", params={"product_id": prod["id"]}, headers=auth_headers).json()
    assert res["total"] == 2
    by_search = client.get("/api/lots", params={"search": "LOT-AAA"}, headers=auth_headers).json()
    assert by_search["total"] == 1
    assert by_search["items"][0]["product_name"] == prod["name"]


def test_lot_on_hand_tracks_movements(auth_headers):
    prod = _make_product(auth_headers)
    _receive_with_lot(auth_headers, prod["id"], 5, "LOT-TRACK")
    lot = _lot_for(auth_headers, prod["id"], "LOT-TRACK")
    assert lot["on_hand"] == 5

    sale = client.post("/api/sales", json={
        "items": [{"product_id": prod["id"], "quantity": 2, "unit_price": 20.0}],
    }, headers=auth_headers)
    assert sale.status_code == 201

    lot = client.get(f"/api/lots/{lot['id']}", headers=auth_headers).json()
    assert lot["on_hand"] == 3


def test_lot_list_returns_supplier_and_expiry(auth_headers):
    supplier = client.post("/api/suppliers", json={"name": "Coffee Roasters Co"}, headers=auth_headers)
    assert supplier.status_code == 201
    prod = _make_product(auth_headers, sku="LOT-SUP")
    _receive_with_lot(auth_headers, prod["id"], 4, "BQ-001",
                      expiry="2026-08-26", supplier_id=supplier.json()["id"])

    lots = client.get("/api/lots", params={"product_id": prod["id"]}, headers=auth_headers).json()
    item = lots["items"][0]
    assert item["supplier_name"] == "Coffee Roasters Co"
    assert item["expiry_date"] == "2026-08-26"


def test_update_lot_status_and_expiry(auth_headers):
    prod = _make_product(auth_headers)
    _receive_with_lot(auth_headers, prod["id"], 3, "LOT-UPD")
    lot = _lot_for(auth_headers, prod["id"], "LOT-UPD")

    resp = client.put(f"/api/lots/{lot['id']}", json={"status": "quarantined"}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "quarantined"

    resp = client.put(f"/api/lots/{lot['id']}", json={"expiry_date": "2026-06-30"}, headers=auth_headers)
    assert resp.json()["expiry_date"] == "2026-06-30"


def test_quarantined_lot_excluded_from_fefo_allocation(auth_headers):
    prod = _make_product(auth_headers, sku="LOT-FEFO")
    _receive_with_lot(auth_headers, prod["id"], 5, "LOT-SOON", expiry="2026-01-31")
    _receive_with_lot(auth_headers, prod["id"], 5, "LOT-LATE", expiry="2026-12-31")
    soon = _lot_for(auth_headers, prod["id"], "LOT-SOON")
    late = _lot_for(auth_headers, prod["id"], "LOT-LATE")

    client.put(f"/api/lots/{soon['id']}", json={"status": "quarantined"}, headers=auth_headers)

    sale = client.post("/api/sales", json={
        "items": [{"product_id": prod["id"], "quantity": 5, "unit_price": 20.0}],
    }, headers=auth_headers)
    assert sale.status_code == 201

    db = TestingSessionLocal()
    try:
        outs = db.query(StockMovement).filter(
            StockMovement.product_id == prod["id"], StockMovement.movement_type == "sale"
        ).all()
        assert outs and all(m.lot_id == late["id"] for m in outs)
    finally:
        db.close()

    over = client.post("/api/sales", json={
        "items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 20.0}],
    }, headers=auth_headers)
    assert over.status_code == 400


def test_lot_movements_endpoint(auth_headers):
    prod = _make_product(auth_headers, sku="LOT-MOV")
    receipt = _receive_with_lot(auth_headers, prod["id"], 6, "LOT-MOV")
    lot = _lot_for(auth_headers, prod["id"], "LOT-MOV")

    movements = client.get(f"/api/lots/{lot['id']}/movements", headers=auth_headers).json()
    assert any(m["movement_type"] == "receive" and m["lot_id"] == lot["id"]
               and m["reference"] == receipt["receipt_number"] for m in movements)


def test_invalid_lot_status_rejected(auth_headers):
    prod = _make_product(auth_headers, sku="LOT-BAD")
    _receive_with_lot(auth_headers, prod["id"], 1, "LOT-BAD")
    lot = _lot_for(auth_headers, prod["id"], "LOT-BAD")
    resp = client.put(f"/api/lots/{lot['id']}", json={"status": "exploded"}, headers=auth_headers)
    assert resp.status_code == 422


def test_update_lot_quarantine_cascades_to_serials(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "LOT-SERC", "name": "LOT-SERC", "unit_price": 20.0, "cost_price": 10.0,
        "quantity": 0, "is_serialized": True,
    }, headers=auth_headers).json()
    assert client.post("/api/receipts", json={"items": [{
        "product_id": prod["id"], "quantity": 2,
        "serial_numbers": ["LOT-SERC-1", "LOT-SERC-2"], "lot_number": "LOT-SERC",
    }]}, headers=auth_headers).status_code == 201
    lot = _lot_for(auth_headers, prod["id"], "LOT-SERC")

    resp = client.put(f"/api/lots/{lot['id']}", json={"status": "quarantined"}, headers=auth_headers)
    assert resp.status_code == 200
    serials = client.get("/api/serial-numbers", params={"product_id": prod["id"]}, headers=auth_headers).json()["items"]
    assert all(s["status"] == "quarantined" for s in serials)
    detail = client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()
    # quarantined serials stay on-hand (parity with bulk quarantined lots), so
    # Qty is unchanged and the pair becomes the quarantined breakdown
    assert detail["quantity"] == 2
    assert detail["quarantined_qty"] == 2
    assert detail["sellable_qty"] == 0

    resp = client.put(f"/api/lots/{lot['id']}", json={"status": "in_stock"}, headers=auth_headers)
    assert resp.status_code == 200
    serials = client.get("/api/serial-numbers", params={"product_id": prod["id"]}, headers=auth_headers).json()["items"]
    assert all(s["status"] == "in_stock" for s in serials)
