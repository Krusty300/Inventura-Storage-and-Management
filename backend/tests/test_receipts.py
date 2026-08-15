from app.models import Location, StockLine
from app.services import inventory
from tests.conftest import TestingSessionLocal, client


def _make_product(auth_headers, sku="RCP-PROD", serialized=False):
    return client.post("/api/products", json={"location_id": 1, 
        "sku": sku, "name": sku, "unit_price": 20.0, "cost_price": 10.0,
        "quantity": 0, "is_serialized": serialized,
    }, headers=auth_headers).json()


def _make_supplier(auth_headers, name="Acme Supplies"):
    return client.post("/api/suppliers", json={"name": name}, headers=auth_headers).json()


def _make_location():
    db = TestingSessionLocal()
    try:
        loc = Location(name="Receiving Dock", code="RD-01")
        db.add(loc)
        db.commit()
        loc_id = loc.id
    finally:
        db.close()
    return loc_id


def _post_receipt(auth_headers, items, **kwargs):
    payload = {"items": items}
    payload.update(kwargs)
    return client.post("/api/receipts", json=payload, headers=auth_headers)


def test_receive_non_serialized_increases_stock(auth_headers):
    prod = _make_product(auth_headers)
    resp = _post_receipt(auth_headers, [{"product_id": prod["id"], "quantity": 5, "unit_cost": 10.0}])
    assert resp.status_code == 201
    data = resp.json()
    assert data["receipt_number"].startswith("RCP-")
    assert data["total_quantity"] == 5
    assert data["total_cost"] == 50.0

    updated = client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()
    assert updated["quantity"] == 5
    movements = client.get(f"/api/products/{prod['id']}/movements", headers=auth_headers).json()
    assert any(m["movement_type"] == "receive" and m["quantity_change"] == 5
               and m["reference_type"] == "receipt" and m["reference"] == data["receipt_number"]
               for m in movements)


def test_receipt_with_lot_creates_lot(auth_headers):
    prod = _make_product(auth_headers, sku="RCP-LOT")
    resp = _post_receipt(auth_headers, [{
        "product_id": prod["id"], "quantity": 4, "lot_number": "LOT-RCP-1",
        "expiry_date": "2026-12-31",
    }])
    assert resp.status_code == 201

    lots = client.get("/api/lots", params={"product_id": prod["id"]}, headers=auth_headers).json()
    assert lots["total"] == 1
    lot = lots["items"][0]
    assert lot["lot_number"] == "LOT-RCP-1"
    assert lot["expiry_date"] == "2026-12-31"
    assert lot["on_hand"] == 4


def test_reuse_lot_number_accumulates(auth_headers):
    prod = _make_product(auth_headers, sku="RCP-LOT2")
    _post_receipt(auth_headers, [{"product_id": prod["id"], "quantity": 3, "lot_number": "LOT-SAME"}])
    _post_receipt(auth_headers, [{"product_id": prod["id"], "quantity": 2, "lot_number": "LOT-SAME"}])

    lots = client.get("/api/lots", params={"product_id": prod["id"]}, headers=auth_headers).json()
    assert lots["total"] == 1
    assert lots["items"][0]["on_hand"] == 5


def test_receipt_into_location(auth_headers):
    prod = _make_product(auth_headers, sku="RCP-LOC")
    loc_id = _make_location()
    resp = _post_receipt(auth_headers, [{"product_id": prod["id"], "quantity": 6, "location_id": loc_id}])
    assert resp.status_code == 201

    db = TestingSessionLocal()
    try:
        assert inventory.on_hand(db, product_id=prod["id"], location_id=loc_id) == 6
        lines = db.query(StockLine).filter(StockLine.product_id == prod["id"]).all()
        assert len(lines) == 1
        assert lines[0].location_id == loc_id
    finally:
        db.close()


def test_serialized_receipt_registers_serials(auth_headers):
    prod = _make_product(auth_headers, sku="RCP-SER", serialized=True)
    resp = _post_receipt(auth_headers, [{
        "product_id": prod["id"], "quantity": 2, "serial_numbers": ["SN-1001", "SN-1002"],
    }])
    assert resp.status_code == 201

    updated = client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()
    assert updated["quantity"] == 2
    assert updated["is_serialized"] is True
    serials = client.get("/api/serial-numbers", params={"product_id": prod["id"]}, headers=auth_headers).json()
    assert serials["total"] == 2
    assert all(s["status"] == "in_stock" for s in serials["items"])


def test_serialized_receipt_requires_serial_numbers(auth_headers):
    prod = _make_product(auth_headers, sku="RCP-SER2", serialized=True)
    resp = _post_receipt(auth_headers, [{"product_id": prod["id"], "quantity": 1}])
    assert resp.status_code == 400
    assert "serialized" in resp.json()["detail"].lower()


def test_serialized_receipt_quantity_mismatch_rejected(auth_headers):
    prod = _make_product(auth_headers, sku="RCP-SER3", serialized=True)
    resp = _post_receipt(auth_headers, [{
        "product_id": prod["id"], "quantity": 2, "serial_numbers": ["SN-1"],
    }])
    assert resp.status_code == 422


def test_serialized_receipt_duplicate_serial_in_line_rejected(auth_headers):
    prod = _make_product(auth_headers, sku="RCP-SER4", serialized=True)
    resp = _post_receipt(auth_headers, [{
        "product_id": prod["id"], "quantity": 2, "serial_numbers": ["SN-DUP", "SN-DUP"],
    }])
    assert resp.status_code == 400
    assert "Duplicate" in resp.json()["detail"]


def test_serialized_receipt_duplicate_serial_across_receipts_rejected(auth_headers):
    prod = _make_product(auth_headers, sku="RCP-SER5", serialized=True)
    ok = _post_receipt(auth_headers, [{
        "product_id": prod["id"], "quantity": 1, "serial_numbers": ["SN-GONE"],
    }])
    assert ok.status_code == 201
    resp = _post_receipt(auth_headers, [{
        "product_id": prod["id"], "quantity": 1, "serial_numbers": ["SN-GONE"],
    }])
    assert resp.status_code == 400
    assert "already registered" in resp.json()["detail"]


def test_non_serialized_receipt_with_serials_rejected(auth_headers):
    prod = _make_product(auth_headers, sku="RCP-NOSER")
    resp = _post_receipt(auth_headers, [{
        "product_id": prod["id"], "quantity": 1, "serial_numbers": ["SN-X"],
    }])
    assert resp.status_code == 400


def test_receipt_with_supplier(auth_headers):
    sup = _make_supplier(auth_headers)
    prod = _make_product(auth_headers, sku="RCP-SUP")
    resp = _post_receipt(auth_headers, [{"product_id": prod["id"], "quantity": 2}], supplier_id=sup["id"])
    assert resp.status_code == 201
    assert resp.json()["supplier_name"] == "Acme Supplies"


def test_receipt_with_variant_parent_rejected(auth_headers):
    parent = _make_product(auth_headers, sku="RCP-PARENT")
    client.post("/api/products", json={"location_id": 1, 
        "sku": "RCP-VAR", "name": parent["name"], "parent_id": parent["id"],
        "attributes": {"Color": "Red"}, "quantity": 0,
    }, headers=auth_headers).json()
    resp = _post_receipt(auth_headers, [{"product_id": parent["id"], "quantity": 1}])
    assert resp.status_code == 400
    assert "variants" in resp.json()["detail"]


def test_receipt_list_search_and_detail(auth_headers):
    prod = _make_product(auth_headers, sku="RCP-LIST")
    receipt = _post_receipt(auth_headers, [{"product_id": prod["id"], "quantity": 3}]).json()
    res = client.get("/api/receipts", headers=auth_headers).json()
    assert res["total"] >= 1
    by_number = client.get("/api/receipts", params={"search": receipt["receipt_number"]}, headers=auth_headers).json()
    assert by_number["total"] == 1
    detail = client.get(f"/api/receipts/{receipt['id']}", headers=auth_headers).json()
    assert detail["items"][0]["product_id"] == prod["id"]
    assert detail["items"][0]["quantity"] == 3


def test_receipt_pdf_generated(auth_headers):
    prod = _make_product(auth_headers, sku="RCP-PDF")
    receipt = _post_receipt(auth_headers, [
        {"product_id": prod["id"], "quantity": 3, "unit_cost": 10.0, "lot_number": "PDF-LOT"},
    ]).json()
    resp = client.get(f"/api/receipts/{receipt['id']}/pdf", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert receipt["receipt_number"] in resp.headers["content-disposition"]


def test_receipt_pdf_not_found(auth_headers):
    assert client.get("/api/receipts/99999/pdf", headers=auth_headers).status_code == 404
