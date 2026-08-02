from app.models import Location
from tests.conftest import TestingSessionLocal, client


def _make_product(auth_headers, sku="ASN-PROD"):
    return client.post("/api/products", json={
        "sku": sku, "name": sku, "unit_price": 10.0, "quantity": 0,
    }, headers=auth_headers).json()


def _make_location(auth_headers, code="ASN-LOC"):
    return client.post("/api/locations", json={"name": "ASN Bin", "code": code}, headers=auth_headers).json()


def test_asn_crud_and_receive(auth_headers):
    prod = _make_product(auth_headers)
    loc = _make_location(auth_headers)

    created = client.post("/api/asns", json={
        "expected_arrival": "2026-08-15",
        "notes": "August shipment",
        "items": [{"product_id": prod["id"], "expected_qty": 10, "location_id": loc["id"]}],
    }, headers=auth_headers)
    assert created.status_code == 201
    asn = created.json()
    assert asn["asn_number"].startswith("ASN-")
    assert asn["total_expected"] == 10
    assert asn["status"] == "pending"

    fetched = client.get(f"/api/asns/{asn['id']}", headers=auth_headers).json()
    assert fetched["items"][0]["product_name"] == prod["name"]

    received = client.post(f"/api/asns/{asn['id']}/receive", json={
        "items": [{
            "product_id": prod["id"], "received_qty": 10, "lot_number": "ASN-LOT-1",
            "expiry_date": "2027-01-01", "location_id": loc["id"],
        }],
    }, headers=auth_headers)
    assert received.status_code == 200
    body = received.json()
    assert body["status"] == "received"
    assert body["items"][0]["status"] == "received"
    assert body["total_received"] == 10

    prod_after = client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()
    assert prod_after["quantity"] == 10


def test_asn_partial_receive_flow(auth_headers):
    prod = _make_product(auth_headers, sku="ASN-PART")
    asn = client.post("/api/asns", json={
        "items": [{"product_id": prod["id"], "expected_qty": 5}],
    }, headers=auth_headers).json()

    first = client.post(f"/api/asns/{asn['id']}/receive", json={
        "items": [{"product_id": prod["id"], "received_qty": 2}],
    }, headers=auth_headers).json()
    assert first["status"] == "pending"
    assert first["items"][0]["status"] == "partial"

    over = client.post(f"/api/asns/{asn['id']}/receive", json={
        "items": [{"product_id": prod["id"], "received_qty": 4}],
    }, headers=auth_headers)
    assert over.status_code == 400

    final = client.post(f"/api/asns/{asn['id']}/receive", json={
        "items": [{"product_id": prod["id"], "received_qty": 3}],
    }, headers=auth_headers).json()
    assert final["status"] == "received"
    assert final["total_received"] == 5


def test_asn_cancel_and_delete(auth_headers):
    prod = _make_product(auth_headers, sku="ASN-CAN")
    asn = client.post("/api/asns", json={
        "items": [{"product_id": prod["id"], "expected_qty": 3}],
    }, headers=auth_headers).json()
    assert client.put(f"/api/asns/{asn['id']}", json={"status": "cancelled"}, headers=auth_headers).status_code == 200
    assert client.post(f"/api/asns/{asn['id']}/receive", json={
        "items": [{"product_id": prod["id"], "received_qty": 1}],
    }, headers=auth_headers).status_code == 400

    asn2 = client.post("/api/asns", json={
        "items": [{"product_id": prod["id"], "expected_qty": 1}],
    }, headers=auth_headers).json()
    assert client.delete(f"/api/asns/{asn2['id']}", headers=auth_headers).status_code == 200
    assert client.get(f"/api/asns/{asn2['id']}", headers=auth_headers).status_code == 404


def test_asn_receive_rejects_unknown_product(auth_headers):
    prod = _make_product(auth_headers, sku="ASN-UNK")
    asn = client.post("/api/asns", json={
        "items": [{"product_id": prod["id"], "expected_qty": 3}],
    }, headers=auth_headers).json()
    other = _make_product(auth_headers, sku="ASN-OTHER")
    resp = client.post(f"/api/asns/{asn['id']}/receive", json={
        "items": [{"product_id": other["id"], "received_qty": 1}],
    }, headers=auth_headers)
    assert resp.status_code == 400


def test_asn_list_filters(auth_headers):
    prod = _make_product(auth_headers, sku="ASN-LIST")
    client.post("/api/asns", json={"items": [{"product_id": prod["id"], "expected_qty": 1}]}, headers=auth_headers)
    by_status = client.get("/api/asns", params={"status": "pending"}, headers=auth_headers).json()
    assert by_status["total"] == 1
    by_done = client.get("/api/asns", params={"status": "received"}, headers=auth_headers).json()
    assert by_done["total"] == 0


def test_lot_label_pdf(auth_headers):
    prod = _make_product(auth_headers, sku="ASN-LBL")
    client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 2, "lot_number": "LBL-LOT"}],
    }, headers=auth_headers)
    db = TestingSessionLocal()
    try:
        lot = db.query(__import__("app.models", fromlist=["Lot"]).Lot).first()
        lot_id = lot.id
    finally:
        db.close()
    resp = client.get(f"/api/labels/lot/{lot_id}", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.content[:4] == b"%PDF"
