from app.models import SerialNumber, User
from app.services import inventory
from tests.conftest import TestingSessionLocal, client


def _make_serialized_product(auth_headers, sku="SER-PROD"):
    return client.post("/api/products", json={"location_id": 1, 
        "sku": sku, "name": sku, "unit_price": 50.0, "cost_price": 30.0,
        "quantity": 0, "is_serialized": True,
    }, headers=auth_headers).json()


def _receive_serials(auth_headers, product_id, serials):
    return client.post("/api/receipts", json={
        "items": [{"product_id": product_id, "quantity": len(serials), "serial_numbers": serials}],
    }, headers=auth_headers)


def test_list_serials_with_search_and_product_filter(auth_headers):
    prod = _make_serialized_product(auth_headers, sku="SER-LIST")
    assert _receive_serials(auth_headers, prod["id"], ["SER-0001", "SER-0002"]).status_code == 201

    res = client.get("/api/serial-numbers", params={"product_id": prod["id"]}, headers=auth_headers).json()
    assert res["total"] == 2
    assert all(s["product_name"] == prod["name"] for s in res["items"])
    by_search = client.get("/api/serial-numbers", params={"search": "0002"}, headers=auth_headers).json()
    assert by_search["total"] == 1
    assert by_search["items"][0]["serial_number"] == "SER-0002"


def test_get_serial_detail(auth_headers):
    prod = _make_serialized_product(auth_headers, sku="SER-DET")
    _receive_serials(auth_headers, prod["id"], ["SER-DET-1"])
    serial = client.get("/api/serial-numbers", params={"product_id": prod["id"]}, headers=auth_headers).json()["items"][0]
    detail = client.get(f"/api/serial-numbers/{serial['id']}", headers=auth_headers).json()
    assert detail["serial_number"] == "SER-DET-1"
    assert detail["status"] == "in_stock"


def test_serial_movements(auth_headers):
    prod = _make_serialized_product(auth_headers, sku="SER-MOV")
    receipt = _receive_serials(auth_headers, prod["id"], ["SER-MOV-1"]).json()
    serial = client.get("/api/serial-numbers", params={"product_id": prod["id"]}, headers=auth_headers).json()["items"][0]
    movements = client.get(f"/api/serial-numbers/{serial['id']}/movements", headers=auth_headers).json()
    assert any(m["movement_type"] == "receive" and m["serial_id"] == serial["id"]
               and m["reference"] == receipt["receipt_number"] for m in movements)


def test_serial_lot_filter(auth_headers):
    prod = _make_serialized_product(auth_headers, sku="SER-LOT")
    assert _receive_serials(auth_headers, prod["id"], ["SER-LOT-1"]).status_code == 201
    resp = client.post("/api/receipts", json={
        "items": [{
            "product_id": prod["id"], "quantity": 1,
            "serial_numbers": ["SER-LOT-2"], "lot_number": "LOT-SER-1",
        }],
    }, headers=auth_headers)
    assert resp.status_code == 201
    lots = client.get("/api/lots", params={"product_id": prod["id"]}, headers=auth_headers).json()["items"]
    assert len(lots) == 1
    lot_id = lots[0]["id"]
    filtered = client.get("/api/serial-numbers", params={"lot_id": lot_id}, headers=auth_headers).json()
    assert filtered["total"] == 1
    assert all(s["lot_id"] == lot_id and s["serial_number"] == "SER-LOT-2" for s in filtered["items"])


def test_serial_list_accepts_lookup_limit(auth_headers):
    prod = _make_serialized_product(auth_headers, sku="SER-LOOKUP")
    assert _receive_serials(auth_headers, prod["id"], ["SER-LOOKUP-1"]).status_code == 201
    resp = client.get("/api/serial-numbers", params={"limit": 5000}, headers=auth_headers)
    assert resp.status_code == 200


def test_serial_status_filter(auth_headers):
    prod = _make_serialized_product(auth_headers, sku="SER-STAT")
    _receive_serials(auth_headers, prod["id"], ["SER-STAT-1", "SER-STAT-2"])

    db = TestingSessionLocal()
    try:
        user = db.query(User).first()
        serial = db.query(SerialNumber).filter(
            SerialNumber.product_id == prod["id"], SerialNumber.serial_number == "SER-STAT-1"
        ).first()
        inventory.post_journal_entry(
            db, product_id=prod["id"], user_id=user.id,
            quantity_change=-1, movement_type=inventory.SALE,
            serial_id=serial.id, reference_type="sale", reference="INV-TEST",
        )
        db.commit()
    finally:
        db.close()

    in_stock = client.get("/api/serial-numbers", params={"status": "in_stock"}, headers=auth_headers).json()
    sold = client.get("/api/serial-numbers", params={"status": "sold"}, headers=auth_headers).json()
    assert any(s["serial_number"] == "SER-STAT-2" for s in in_stock["items"])
    assert any(s["serial_number"] == "SER-STAT-1" for s in sold["items"])


def test_checkout_blocked_for_serialized_product(auth_headers):
    prod = _make_serialized_product(auth_headers, sku="SER-CHECK")
    assert _receive_serials(auth_headers, prod["id"], ["SER-CHECK-1"]).status_code == 201
    resp = client.post("/api/sales", json={
        "items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 50.0}],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "serialized" in resp.json()["detail"].lower()


def test_toggle_serial_active_inactive(auth_headers):
    prod = _make_serialized_product(auth_headers, sku="SER-TOGGLE")
    assert _receive_serials(auth_headers, prod["id"], ["SER-TOGGLE-1"]).status_code == 201
    serial = client.get("/api/serial-numbers", params={"product_id": prod["id"]}, headers=auth_headers).json()["items"][0]

    deactivated = client.put(f"/api/serial-numbers/{serial['id']}/status", json={"status": "inactive"}, headers=auth_headers)
    assert deactivated.status_code == 200
    assert deactivated.json()["status"] == "inactive"
    assert client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()["quantity"] == 0
    assert any(m["movement_type"] == "deactivate" for m in
               client.get(f"/api/serial-numbers/{serial['id']}/movements", headers=auth_headers).json())

    activated = client.put(f"/api/serial-numbers/{serial['id']}/status", json={"status": "in_stock"}, headers=auth_headers)
    assert activated.status_code == 200
    assert activated.json()["status"] == "in_stock"
    assert client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()["quantity"] == 1
    assert any(m["movement_type"] == "activate" for m in
               client.get(f"/api/serial-numbers/{serial['id']}/movements", headers=auth_headers).json())


def test_toggle_serial_rejects_invalid_transitions(auth_headers):
    prod = _make_serialized_product(auth_headers, sku="SER-TOGGLE2")
    assert _receive_serials(auth_headers, prod["id"], ["SER-TOGGLE2-1"]).status_code == 201
    serial = client.get("/api/serial-numbers", params={"product_id": prod["id"]}, headers=auth_headers).json()["items"][0]

    # activating an in-stock serial is invalid
    resp = client.put(f"/api/serial-numbers/{serial['id']}/status", json={"status": "in_stock"}, headers=auth_headers)
    assert resp.status_code == 400

    # deactivating twice is invalid
    assert client.put(f"/api/serial-numbers/{serial['id']}/status", json={"status": "inactive"}, headers=auth_headers).status_code == 200
    resp = client.put(f"/api/serial-numbers/{serial['id']}/status", json={"status": "inactive"}, headers=auth_headers)
    assert resp.status_code == 400

    # unknown status is rejected
    resp = client.put(f"/api/serial-numbers/{serial['id']}/status", json={"status": "sold"}, headers=auth_headers)
    assert resp.status_code == 400


def test_worker_cannot_toggle_serial_status(auth_headers):
    client.post("/api/users", json={
        "username": "ser-worker", "email": "ser-worker@example.com", "password": "testpass123", "role": "worker",
    }, headers=auth_headers)
    token = client.post("/api/auth/login", json={"username": "ser-worker", "password": "testpass123"}).json()["access_token"]
    worker = {"Authorization": f"Bearer {token}"}

    prod = _make_serialized_product(auth_headers, sku="SER-WORKER")
    assert _receive_serials(auth_headers, prod["id"], ["SER-WORKER-1"]).status_code == 201
    serial = client.get("/api/serial-numbers", params={"product_id": prod["id"]}, headers=auth_headers).json()["items"][0]
    assert client.put(f"/api/serial-numbers/{serial['id']}/status", json={"status": "inactive"}, headers=worker).status_code == 403
