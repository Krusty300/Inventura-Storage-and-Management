from app.models import Product
from tests.conftest import TestingSessionLocal, client, submit_approve


def _make_location(auth_headers, name="Rule Bin", code="RULE-1"):
    resp = client.post("/api/locations", json={"name": name, "code": code}, headers=auth_headers)
    assert resp.status_code == 201
    return resp.json()


def _make_product_without_location(auth_headers, sku):
    """Bypass the API to create a product that predates the location rule."""
    db = TestingSessionLocal()
    try:
        p = Product(sku=sku, name=sku, quantity=0, reorder_level=10, location_id=None)
        db.add(p)
        db.commit()
        pid = p.id
    finally:
        db.close()
    return pid


def test_create_product_without_location_rejected(auth_headers):
    resp = client.post("/api/products", json={
        "sku": "RUL-NOLOC", "name": "No Loc", "quantity": 5,
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "location" in resp.json()["detail"].lower()


def test_create_product_with_inactive_location_rejected(auth_headers):
    loc = _make_location(auth_headers, code="RULE-IA")
    client.put(f"/api/locations/{loc['id']}", json={"is_active": False}, headers=auth_headers)
    resp = client.post("/api/products", json={
        "sku": "RUL-IALOC", "name": "Inactive Loc", "quantity": 5, "location_id": loc["id"],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "active" in resp.json()["detail"].lower()


def test_create_product_with_unknown_location_rejected(auth_headers):
    resp = client.post("/api/products", json={
        "sku": "RUL-BADLOC", "name": "Bad Loc", "quantity": 5, "location_id": 99999,
    }, headers=auth_headers)
    assert resp.status_code == 400


def test_update_product_cannot_clear_location(auth_headers):
    prod = client.post("/api/products", json={
        "sku": "RUL-CLEAR", "name": "Clear Me", "quantity": 0, "location_id": 1,
    }, headers=auth_headers).json()
    resp = client.put(f"/api/products/{prod['id']}", json={"location_id": None}, headers=auth_headers)
    assert resp.status_code == 400
    resp = client.put(f"/api/products/{prod['id']}", json={"location": ""}, headers=auth_headers)
    assert resp.status_code == 400


def test_update_product_with_inactive_location_rejected(auth_headers):
    prod = client.post("/api/products", json={
        "sku": "RUL-MVIN", "name": "Move Inactive", "quantity": 0, "location_id": 1,
    }, headers=auth_headers).json()
    loc = _make_location(auth_headers, code="RULE-MV")
    client.put(f"/api/locations/{loc['id']}", json={"is_active": False}, headers=auth_headers)
    resp = client.put(f"/api/products/{prod['id']}", json={"location_id": loc["id"]}, headers=auth_headers)
    assert resp.status_code == 400
    assert "active" in resp.json()["detail"].lower()


def test_order_requires_product_location(auth_headers):
    pid = _make_product_without_location(auth_headers, "RUL-ORD-NOLOC")
    resp = client.post("/api/orders", json={
        "items": [{"product_id": pid, "quantity": 2, "unit_price": 5.0}],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "no location" in resp.json()["detail"].lower()


def test_receive_order_requires_active_location(auth_headers):
    loc = _make_location(auth_headers, code="RULE-RCV")
    prod = client.post("/api/products", json={
        "sku": "RUL-ORD-IA", "name": "Order Inactive", "quantity": 0, "location_id": loc["id"],
    }, headers=auth_headers).json()
    order = client.post("/api/orders", json={
        "items": [{"product_id": prod["id"], "quantity": 3, "unit_price": 5.0}],
    }, headers=auth_headers).json()
    client.put(f"/api/locations/{loc['id']}", json={"is_active": False}, headers=auth_headers)
    submit_approve(client, auth_headers, order["id"])
    resp = client.put(f"/api/orders/{order['id']}", json={"status": "received"}, headers=auth_headers)
    assert resp.status_code == 400
    assert client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()["quantity"] == 0


def test_receipt_requires_product_location(auth_headers):
    pid = _make_product_without_location(auth_headers, "RUL-RCP-NOLOC")
    resp = client.post("/api/receipts", json={
        "items": [{"product_id": pid, "quantity": 2, "unit_cost": 1.0}],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "no location" in resp.json()["detail"].lower()


def test_receipt_with_inactive_location_rejected(auth_headers):
    loc = _make_location(auth_headers, code="RULE-RCP-IA")
    prod = client.post("/api/products", json={
        "sku": "RUL-RCP-IA", "name": "Receipt Inactive", "quantity": 0, "location_id": 1,
    }, headers=auth_headers).json()
    client.put(f"/api/locations/{loc['id']}", json={"is_active": False}, headers=auth_headers)
    resp = client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 2, "unit_cost": 1.0, "location_id": loc["id"]}],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "inactive" in resp.json()["detail"].lower()


def test_asn_receive_requires_active_location(auth_headers):
    loc = _make_location(auth_headers, code="RULE-ASN")
    prod = client.post("/api/products", json={
        "sku": "RUL-ASN-IA", "name": "ASN Inactive", "quantity": 0, "location_id": loc["id"],
    }, headers=auth_headers).json()
    asn = client.post("/api/asns", json={
        "items": [{"product_id": prod["id"], "expected_qty": 2}],
    }, headers=auth_headers).json()
    client.put(f"/api/locations/{loc['id']}", json={"is_active": False}, headers=auth_headers)
    resp = client.post(f"/api/asns/{asn['id']}/receive", json={
        "items": [{"product_id": prod["id"], "received_qty": 2}],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "inactive" in resp.json()["detail"].lower()


def test_transfer_to_inactive_location_rejected(auth_headers):
    src = _make_location(auth_headers, code="RULE-TFR-S")
    dst = _make_location(auth_headers, code="RULE-TFR-D")
    prod = client.post("/api/products", json={
        "sku": "RUL-TFR-IA", "name": "Transfer Inactive", "quantity": 0, "location_id": 1,
    }, headers=auth_headers).json()
    client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 5, "unit_cost": 1.0, "location_id": src["id"]}],
    }, headers=auth_headers)
    client.put(f"/api/locations/{dst['id']}", json={"is_active": False}, headers=auth_headers)
    resp = client.post("/api/stock-movements/transfer", json={
        "product_id": prod["id"], "quantity": 2,
        "from_location_id": src["id"], "to_location_id": dst["id"],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "inactive" in resp.json()["detail"].lower()


def test_transfer_from_inactive_location_rejected(auth_headers):
    src = _make_location(auth_headers, code="RULE-TFR-S2")
    dst = _make_location(auth_headers, code="RULE-TFR-D2")
    prod = client.post("/api/products", json={
        "sku": "RUL-TFR-IA2", "name": "Transfer Inactive 2", "quantity": 0, "location_id": 1,
    }, headers=auth_headers).json()
    client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 5, "unit_cost": 1.0, "location_id": src["id"]}],
    }, headers=auth_headers)
    client.put(f"/api/locations/{src['id']}", json={"is_active": False}, headers=auth_headers)
    resp = client.post("/api/stock-movements/transfer", json={
        "product_id": prod["id"], "quantity": 2,
        "from_location_id": src["id"], "to_location_id": dst["id"],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "inactive" in resp.json()["detail"].lower()


def test_auto_reorder_skips_products_without_active_location(auth_headers):
    pid = _make_product_without_location(auth_headers, "RUL-AR-NOLOC")
    client.post("/api/products", json={
        "sku": "RUL-AR-FULL", "name": "Full", "quantity": 100, "location_id": 1,
    }, headers=auth_headers)
    resp = client.post("/api/orders/auto-reorder", headers=auth_headers)
    assert resp.status_code == 400
    assert pid


def test_import_csv_without_location_reports_error(auth_headers):
    csv_data = "sku,name,quantity\nRUL-CSV,No Loc Csv,5\n"
    resp = client.post(
        "/api/products/import-csv",
        files={"file": ("import.csv", csv_data, "text/csv")},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    result = resp.json()
    assert result["created"] == 0
    assert len(result["errors"]) == 1
    assert "location" in result["errors"][0].lower()
