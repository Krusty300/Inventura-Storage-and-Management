from tests.conftest import client, TestingSessionLocal
from app.models.user import User
from app.services.auth import hash_password


def test_create_order(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, "sku": "ORD001", "name": "Order Item", "cost_price": 15.00}, headers=auth_headers).json()
    sup = client.post("/api/suppliers", json={"name": "Order Supplier"}, headers=auth_headers).json()
    resp = client.post("/api/orders", json={
        "supplier_id": sup["id"],
        "items": [{"product_id": prod["id"], "quantity": 5, "unit_price": 15.00}],
    }, headers=auth_headers)
    assert resp.status_code == 201
    data = resp.json()
    assert data["order_number"].startswith("PO-")
    assert data["total_amount"] == 75.0
    assert len(data["items"]) == 1


def test_list_orders(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, "sku": "ORD002", "name": "Order Item 2", "cost_price": 10.00}, headers=auth_headers).json()
    client.post("/api/orders", json={"items": [{"product_id": prod["id"], "quantity": 2, "unit_price": 10.00}]}, headers=auth_headers)
    resp = client.get("/api/orders", headers=auth_headers)
    assert resp.status_code == 200
    assert len(resp.json()["items"]) >= 1


def test_get_order(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, "sku": "ORD003", "name": "Order Item 3", "cost_price": 25.00}, headers=auth_headers).json()
    create = client.post("/api/orders", json={"items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 25.00}]}, headers=auth_headers).json()
    resp = client.get(f"/api/orders/{create['id']}", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["total_amount"] == 25.0


def test_update_order_status(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, "sku": "ORD004", "name": "Order Item 4", "cost_price": 5.00}, headers=auth_headers).json()
    create = client.post("/api/orders", json={"items": [{"product_id": prod["id"], "quantity": 10, "unit_price": 5.00}]}, headers=auth_headers).json()
    resp = client.put(f"/api/orders/{create['id']}", json={"status": "received"}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "received"


def test_delete_order(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, "sku": "ORD005", "name": "Order Item 5", "cost_price": 8.00}, headers=auth_headers).json()
    create = client.post("/api/orders", json={"items": [{"product_id": prod["id"], "quantity": 3, "unit_price": 8.00}]}, headers=auth_headers).json()
    resp = client.delete(f"/api/orders/{create['id']}", headers=auth_headers)
    assert resp.status_code == 200


def test_receive_order_adds_stock_and_logs_movement(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, "sku": "ORD-RCV", "name": "Receive Item", "cost_price": 5.00}, headers=auth_headers).json()
    order = client.post("/api/orders", json={"items": [{"product_id": prod["id"], "quantity": 10, "unit_price": 5.00}]}, headers=auth_headers).json()
    resp = client.put(f"/api/orders/{order['id']}", json={"status": "received"}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "received"
    updated = client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()
    assert updated["quantity"] == 10
    movements = client.get(f"/api/products/{prod['id']}/movements", headers=auth_headers).json()
    assert any(m["movement_type"] == "in" and m["quantity_change"] == 10 for m in movements)


def test_receive_serialized_order_rejected_cleanly(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, 
        "sku": "ORD-SER", "name": "Serialized Item", "cost_price": 5.00, "is_serialized": True,
    }, headers=auth_headers).json()
    order = client.post("/api/orders", json={
        "items": [{"product_id": prod["id"], "quantity": 3, "unit_price": 5.00}],
    }, headers=auth_headers).json()
    resp = client.put(f"/api/orders/{order['id']}", json={"status": "received"}, headers=auth_headers)
    assert resp.status_code == 400
    assert "serialized" in resp.json()["detail"].lower()
    assert client.get(f"/api/orders/{order['id']}", headers=auth_headers).json()["status"] == "pending"
    assert client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()["quantity"] == 0


def test_receive_serialized_order_with_serials(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, 
        "sku": "ORD-SER2", "name": "Serialized Receive", "cost_price": 5.00, "is_serialized": True,
    }, headers=auth_headers).json()
    order = client.post("/api/orders", json={
        "items": [{"product_id": prod["id"], "quantity": 2, "unit_price": 5.00}],
    }, headers=auth_headers).json()
    resp = client.put(f"/api/orders/{order['id']}", json={
        "status": "received",
        "serial_numbers": {prod["id"]: ["SER-A", "SER-B"]},
    }, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "received"
    assert client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()["quantity"] == 2
    serials = client.get(f"/api/serial-numbers?product_id={prod['id']}", headers=auth_headers).json()
    assert len(serials["items"]) == 2


def test_receive_serialized_order_wrong_serial_count_rejected(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, 
        "sku": "ORD-SER3", "name": "Serialized Count", "cost_price": 5.00, "is_serialized": True,
    }, headers=auth_headers).json()
    order = client.post("/api/orders", json={
        "items": [{"product_id": prod["id"], "quantity": 2, "unit_price": 5.00}],
    }, headers=auth_headers).json()
    resp = client.put(f"/api/orders/{order['id']}", json={
        "status": "received",
        "serial_numbers": {prod["id"]: ["SER-C"]},
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert client.get(f"/api/orders/{order['id']}", headers=auth_headers).json()["status"] == "pending"


def test_receive_serialized_order_duplicate_serial_rejected(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, 
        "sku": "ORD-SER4", "name": "Serialized Dup", "cost_price": 5.00, "is_serialized": True,
    }, headers=auth_headers).json()
    order = client.post("/api/orders", json={
        "items": [{"product_id": prod["id"], "quantity": 2, "unit_price": 5.00}],
    }, headers=auth_headers).json()
    resp = client.put(f"/api/orders/{order['id']}", json={
        "status": "received",
        "serial_numbers": {prod["id"]: ["SER-D", "SER-D"]},
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert client.get(f"/api/orders/{order['id']}", headers=auth_headers).json()["status"] == "pending"


def test_receive_twice_is_noop(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, "sku": "ORD-RCV2", "name": "Receive Item 2", "cost_price": 5.00}, headers=auth_headers).json()
    order = client.post("/api/orders", json={"items": [{"product_id": prod["id"], "quantity": 10, "unit_price": 5.00}]}, headers=auth_headers).json()
    client.put(f"/api/orders/{order['id']}", json={"status": "received"}, headers=auth_headers)
    resp = client.put(f"/api/orders/{order['id']}", json={"status": "received"}, headers=auth_headers)
    assert resp.status_code == 200
    updated = client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()
    assert updated["quantity"] == 10


def test_cancel_received_order_rejected(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, "sku": "ORD-RCV3", "name": "Receive Item 3", "cost_price": 5.00}, headers=auth_headers).json()
    order = client.post("/api/orders", json={"items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 5.00}]}, headers=auth_headers).json()
    client.put(f"/api/orders/{order['id']}", json={"status": "received"}, headers=auth_headers)
    resp = client.put(f"/api/orders/{order['id']}", json={"status": "cancelled"}, headers=auth_headers)
    assert resp.status_code == 400


def test_receive_order_with_custom_location(auth_headers):
    loc = client.post("/api/locations", json={"name": "Receiving Dock", "code": "RDOCK"}, headers=auth_headers).json()
    prod = client.post("/api/products", json={"location_id": 1, "sku": "ORD-LOC", "name": "Location Item", "cost_price": 5.00}, headers=auth_headers).json()
    order = client.post("/api/orders", json={"items": [{"product_id": prod["id"], "quantity": 6, "unit_price": 5.00}]}, headers=auth_headers).json()
    resp = client.put(f"/api/orders/{order['id']}", json={"status": "received", "receive_locations": {prod["id"]: loc["id"]}}, headers=auth_headers)
    assert resp.status_code == 200
    assert client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()["quantity"] == 6
    movements = client.get(f"/api/products/{prod['id']}/movements", headers=auth_headers).json()
    assert any(m["movement_type"] == "in" and m["quantity_change"] == 6 and m["to_location_id"] == loc["id"] for m in movements)


def test_receive_order_with_unknown_location_rejected(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, "sku": "ORD-BADLOC", "name": "Bad Loc Item", "cost_price": 5.00}, headers=auth_headers).json()
    order = client.post("/api/orders", json={"items": [{"product_id": prod["id"], "quantity": 2, "unit_price": 5.00}]}, headers=auth_headers).json()
    resp = client.put(f"/api/orders/{order['id']}", json={"status": "received", "receive_locations": {prod["id"]: 99999}}, headers=auth_headers)
    assert resp.status_code == 400
    assert client.get(f"/api/orders/{order['id']}", headers=auth_headers).json()["status"] == "pending"
    assert client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()["quantity"] == 0


def test_receive_order_with_inactive_location_rejected(auth_headers):
    loc = client.post("/api/locations", json={"name": "Closed Bin", "code": "CLOSED"}, headers=auth_headers).json()
    client.put(f"/api/locations/{loc['id']}", json={"is_active": False}, headers=auth_headers)
    prod = client.post("/api/products", json={"location_id": 1, "sku": "ORD-INACT", "name": "Inactive Loc Item", "cost_price": 5.00}, headers=auth_headers).json()
    order = client.post("/api/orders", json={"items": [{"product_id": prod["id"], "quantity": 2, "unit_price": 5.00}]}, headers=auth_headers).json()
    resp = client.put(f"/api/orders/{order['id']}", json={"status": "received", "receive_locations": {prod["id"]: loc["id"]}}, headers=auth_headers)
    assert resp.status_code == 400
    assert client.get(f"/api/orders/{order['id']}", headers=auth_headers).json()["status"] == "pending"


def test_receive_serialized_order_with_custom_location(auth_headers):
    loc = client.post("/api/locations", json={"name": "Ser Dock", "code": "SDOCK"}, headers=auth_headers).json()
    prod = client.post("/api/products", json={"location_id": 1, "sku": "ORD-SERLOC", "name": "Ser Loc Item", "cost_price": 5.00, "is_serialized": True}, headers=auth_headers).json()
    order = client.post("/api/orders", json={"items": [{"product_id": prod["id"], "quantity": 2, "unit_price": 5.00}]}, headers=auth_headers).json()
    resp = client.put(f"/api/orders/{order['id']}", json={
        "status": "received",
        "serial_numbers": {prod["id"]: ["SER-L1", "SER-L2"]},
        "receive_locations": {prod["id"]: loc["id"]},
    }, headers=auth_headers)
    assert resp.status_code == 200
    serials = client.get(f"/api/serial-numbers?product_id={prod['id']}", headers=auth_headers).json()
    assert len(serials["items"]) == 2
    assert all(s["location_id"] == loc["id"] for s in serials["items"])


def test_cancelled_order_cannot_be_received(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, "sku": "ORD-CAN", "name": "Cancel Item", "cost_price": 5.00}, headers=auth_headers).json()
    order = client.post("/api/orders", json={"items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 5.00}]}, headers=auth_headers).json()
    client.put(f"/api/orders/{order['id']}", json={"status": "cancelled"}, headers=auth_headers)
    resp = client.put(f"/api/orders/{order['id']}", json={"status": "received"}, headers=auth_headers)
    assert resp.status_code == 400


def test_invalid_order_status_rejected(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, "sku": "ORD-BAD", "name": "Bad Status", "cost_price": 5.00}, headers=auth_headers).json()
    order = client.post("/api/orders", json={"items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 5.00}]}, headers=auth_headers).json()
    resp = client.put(f"/api/orders/{order['id']}", json={"status": "shipped"}, headers=auth_headers)
    assert resp.status_code == 400


def test_edit_items_on_received_order_rejected(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, "sku": "ORD-EDIT", "name": "Edit Item", "cost_price": 5.00}, headers=auth_headers).json()
    order = client.post("/api/orders", json={"items": [{"product_id": prod["id"], "quantity": 10, "unit_price": 5.00}]}, headers=auth_headers).json()
    client.put(f"/api/orders/{order['id']}", json={"status": "received"}, headers=auth_headers)
    resp = client.put(f"/api/orders/{order['id']}", json={"items": [{"product_id": prod["id"], "quantity": 2, "unit_price": 5.00}]}, headers=auth_headers)
    assert resp.status_code == 400


def test_edit_items_on_pending_order_updates_total(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, "sku": "ORD-PEND", "name": "Pending Item", "cost_price": 5.00}, headers=auth_headers).json()
    order = client.post("/api/orders", json={"items": [{"product_id": prod["id"], "quantity": 2, "unit_price": 5.00}]}, headers=auth_headers).json()
    resp = client.put(f"/api/orders/{order['id']}", json={"items": [{"product_id": prod["id"], "quantity": 7, "unit_price": 5.00}]}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["total_amount"] == 35.0


def test_delete_received_order_rejected(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, "sku": "ORD-DELR", "name": "Delete Received", "cost_price": 5.00}, headers=auth_headers).json()
    order = client.post("/api/orders", json={"items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 5.00}]}, headers=auth_headers).json()
    client.put(f"/api/orders/{order['id']}", json={"status": "received"}, headers=auth_headers)
    resp = client.delete(f"/api/orders/{order['id']}", headers=auth_headers)
    assert resp.status_code == 400
    assert client.get(f"/api/orders/{order['id']}", headers=auth_headers).status_code == 200


def test_create_order_unknown_supplier_rejected(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, "sku": "ORD-BADSUP", "name": "Bad Supplier", "cost_price": 5.00}, headers=auth_headers).json()
    resp = client.post("/api/orders", json={
        "supplier_id": 99999,
        "items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 5.00}],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "supplier" in resp.json()["detail"].lower()


def test_update_order_unknown_supplier_rejected(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, "sku": "ORD-UPBSUP", "name": "Update Bad Supplier", "cost_price": 5.00}, headers=auth_headers).json()
    sup = client.post("/api/suppliers", json={"name": "Good Supplier"}, headers=auth_headers).json()
    order = client.post("/api/orders", json={
        "supplier_id": sup["id"],
        "items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 5.00}],
    }, headers=auth_headers).json()
    resp = client.put(f"/api/orders/{order['id']}", json={"supplier_id": 99999}, headers=auth_headers)
    assert resp.status_code == 400
    assert client.get(f"/api/orders/{order['id']}", headers=auth_headers).json()["supplier_id"] == sup["id"]


def test_update_order_clears_supplier(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, "sku": "ORD-CLRSUP", "name": "Clear Supplier", "cost_price": 5.00}, headers=auth_headers).json()
    sup = client.post("/api/suppliers", json={"name": "Clear Supplier Co"}, headers=auth_headers).json()
    order = client.post("/api/orders", json={
        "supplier_id": sup["id"],
        "items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 5.00}],
    }, headers=auth_headers).json()
    resp = client.put(f"/api/orders/{order['id']}", json={"supplier_id": None}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["supplier_id"] is None


def test_create_order_duplicate_product_rejected(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, "sku": "ORD-DUP", "name": "Duplicate Item", "cost_price": 5.00}, headers=auth_headers).json()
    resp = client.post("/api/orders", json={
        "items": [
            {"product_id": prod["id"], "quantity": 2, "unit_price": 5.00},
            {"product_id": prod["id"], "quantity": 3, "unit_price": 5.00},
        ],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "more than once" in resp.json()["detail"].lower()


def test_update_order_duplicate_product_rejected(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, "sku": "ORD-DUP2", "name": "Duplicate Edit", "cost_price": 5.00}, headers=auth_headers).json()
    order = client.post("/api/orders", json={
        "items": [{"product_id": prod["id"], "quantity": 2, "unit_price": 5.00}],
    }, headers=auth_headers).json()
    resp = client.put(f"/api/orders/{order['id']}", json={
        "items": [
            {"product_id": prod["id"], "quantity": 1, "unit_price": 5.00},
            {"product_id": prod["id"], "quantity": 1, "unit_price": 5.00},
        ],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert client.get(f"/api/orders/{order['id']}", headers=auth_headers).json()["total_amount"] == 10.0


def test_receive_order_attributes_receiving_user(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, "sku": "ORD-USER", "name": "User Item", "cost_price": 5.00}, headers=auth_headers).json()
    order = client.post("/api/orders", json={
        "items": [{"product_id": prod["id"], "quantity": 4, "unit_price": 5.00}],
    }, headers=auth_headers).json()
    db = TestingSessionLocal()
    db.add(User(username="receiver", email="receiver@example.com", password_hash=hash_password("testpass123"), role="worker", is_approved=True))
    db.commit()
    db.close()
    login = client.post("/api/auth/login", json={"username": "receiver", "password": "testpass123"})
    recv_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    resp = client.put(f"/api/orders/{order['id']}", json={"status": "received"}, headers=recv_headers)
    assert resp.status_code == 200
    movements = client.get(f"/api/products/{prod['id']}/movements", headers=auth_headers).json()
    receive_moves = [m for m in movements if m["movement_type"] == "in"]
    assert receive_moves
    assert all(m["username"] == "receiver" for m in receive_moves)


def test_order_zero_or_negative_quantity_rejected(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, "sku": "ORD-QTY", "name": "Qty Item", "cost_price": 5.00}, headers=auth_headers).json()
    resp = client.post("/api/orders", json={"items": [{"product_id": prod["id"], "quantity": 0, "unit_price": 5.00}]}, headers=auth_headers)
    assert resp.status_code == 422
    resp = client.post("/api/orders", json={"items": [{"product_id": prod["id"], "quantity": -1, "unit_price": 5.00}]}, headers=auth_headers)
    assert resp.status_code == 422


def test_auto_reorder_skips_above_threshold_and_optouts(auth_headers):
    low = client.post("/api/products", json={"location_id": 1, "sku": "ORD-LOW", "name": "Low Item", "cost_price": 5.00, "quantity": 3}, headers=auth_headers).json()
    ok = client.post("/api/products", json={"location_id": 1, "sku": "ORD-OK", "name": "Ok Item", "cost_price": 5.00, "quantity": 50}, headers=auth_headers).json()
    optout = client.post("/api/products", json={"location_id": 1, "sku": "ORD-OFF", "name": "Opt Out", "cost_price": 5.00, "quantity": 0, "reorder_level": 0}, headers=auth_headers).json()
    resp = client.post("/api/orders/auto-reorder", headers=auth_headers)
    assert resp.status_code == 200
    orders = resp.json()
    assert isinstance(orders, list)
    assert len(orders) == 1
    items = orders[0]["items"]
    assert len(items) == 1
    assert items[0]["product_id"] == low["id"]
    # No demand history: top stock back up to the reorder level.
    assert items[0]["quantity"] == low["reorder_level"] - 3
    assert ok["id"] not in [i["product_id"] for i in items]
    assert optout["id"] not in [i["product_id"] for i in items]


def test_auto_reorder_without_low_stock_errors(auth_headers):
    client.post("/api/products", json={"location_id": 1, "sku": "ORD-NONE", "name": "Full Item", "cost_price": 5.00, "quantity": 100}, headers=auth_headers)
    resp = client.post("/api/orders/auto-reorder", headers=auth_headers)
    assert resp.status_code == 400


def test_order_pdf_generated(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, "sku": "ORD-PDF", "name": "Pdf Item", "cost_price": 5.00}, headers=auth_headers).json()
    order = client.post("/api/orders", json={"items": [{"product_id": prod["id"], "quantity": 2, "unit_price": 5.00}]}, headers=auth_headers).json()
    resp = client.get(f"/api/orders/{order['id']}/pdf", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.content.startswith(b"%PDF")


def test_order_pdf_not_found(auth_headers):
    assert client.get("/api/orders/99999/pdf", headers=auth_headers).status_code == 404


def test_receive_order_creates_lot(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, "sku": "ORD-LOT1", "name": "Lot Create", "cost_price": 5.00}, headers=auth_headers).json()
    order = client.post("/api/orders", json={"items": [{"product_id": prod["id"], "quantity": 6, "unit_price": 5.00}]}, headers=auth_headers).json()
    resp = client.put(f"/api/orders/{order['id']}", json={
        "status": "received",
        "lot_numbers": {prod["id"]: "LOT-NEW-1"},
        "expiry_dates": {prod["id"]: "2027-06-30"},
    }, headers=auth_headers)
    assert resp.status_code == 200
    lots = client.get(f"/api/lots?product_id={prod['id']}", headers=auth_headers).json()["items"]
    assert len(lots) == 1
    assert lots[0]["lot_number"] == "LOT-NEW-1"
    assert lots[0]["status"] == "in_stock"
    assert lots[0]["on_hand"] == 6
    assert lots[0]["expiry_date"] == "2027-06-30"
    movements = client.get(f"/api/products/{prod['id']}/movements", headers=auth_headers).json()
    assert any(m["lot_id"] == lots[0]["id"] and m["quantity_change"] == 6 for m in movements)


def test_receive_order_reuses_existing_lot(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, "sku": "ORD-LOT2", "name": "Lot Reuse", "cost_price": 5.00}, headers=auth_headers).json()
    order1 = client.post("/api/orders", json={"items": [{"product_id": prod["id"], "quantity": 4, "unit_price": 5.00}]}, headers=auth_headers).json()
    assert client.put(f"/api/orders/{order1['id']}", json={
        "status": "received", "lot_numbers": {prod["id"]: "LOT-REUSE"},
    }, headers=auth_headers).status_code == 200
    lots = client.get(f"/api/lots?product_id={prod['id']}", headers=auth_headers).json()["items"]
    assert len(lots) == 1
    lot_id = lots[0]["id"]
    order2 = client.post("/api/orders", json={"items": [{"product_id": prod["id"], "quantity": 3, "unit_price": 5.00}]}, headers=auth_headers).json()
    assert client.put(f"/api/orders/{order2['id']}", json={
        "status": "received", "lot_numbers": {prod["id"]: "LOT-REUSE"},
    }, headers=auth_headers).status_code == 200
    lots = client.get(f"/api/lots?product_id={prod['id']}", headers=auth_headers).json()["items"]
    assert len(lots) == 1
    assert lots[0]["id"] == lot_id
    assert lots[0]["on_hand"] == 7
    assert client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()["quantity"] == 7


def test_receive_order_with_invalid_expiry_rejected(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, "sku": "ORD-LOTEXP", "name": "Bad Expiry", "cost_price": 5.00}, headers=auth_headers).json()
    order = client.post("/api/orders", json={"items": [{"product_id": prod["id"], "quantity": 2, "unit_price": 5.00}]}, headers=auth_headers).json()
    resp = client.put(f"/api/orders/{order['id']}", json={
        "status": "received",
        "lot_numbers": {prod["id"]: "LOT-BADEXP"},
        "expiry_dates": {prod["id"]: "not-a-date"},
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert client.get(f"/api/orders/{order['id']}", headers=auth_headers).json()["status"] == "pending"
    assert client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()["quantity"] == 0


def test_receive_order_into_lpn(auth_headers):
    loc = client.post("/api/locations", json={"name": "Pallet Staging", "code": "PSTG"}, headers=auth_headers).json()
    lpn = client.post("/api/lpns", json={"lpn_number": "LPN-ORD1", "location_id": loc["id"]}, headers=auth_headers).json()
    prod = client.post("/api/products", json={"location_id": 1, "sku": "ORD-LPN", "name": "LPN Item", "cost_price": 5.00}, headers=auth_headers).json()
    order = client.post("/api/orders", json={"items": [{"product_id": prod["id"], "quantity": 5, "unit_price": 5.00}]}, headers=auth_headers).json()
    resp = client.put(f"/api/orders/{order['id']}", json={
        "status": "received",
        "receive_locations": {prod["id"]: loc["id"]},
        "lpn_ids": {prod["id"]: lpn["id"]},
        "lot_numbers": {prod["id"]: "LOT-LPN"},
    }, headers=auth_headers)
    assert resp.status_code == 200
    updated = client.get(f"/api/lpns/{lpn['id']}", headers=auth_headers).json()
    assert updated["total_quantity"] == 5
    assert any(c["product_id"] == prod["id"] and c["quantity"] == 5 and c["lot_number"] == "LOT-LPN" for c in updated["contents"])
    movements = client.get(f"/api/products/{prod['id']}/movements", headers=auth_headers).json()
    assert any(m["lpn_id"] == lpn["id"] and m["quantity_change"] == 5 for m in movements)


def test_receive_order_unknown_lpn_rejected(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, "sku": "ORD-BADLPN", "name": "Bad LPN Item", "cost_price": 5.00}, headers=auth_headers).json()
    order = client.post("/api/orders", json={"items": [{"product_id": prod["id"], "quantity": 2, "unit_price": 5.00}]}, headers=auth_headers).json()
    resp = client.put(f"/api/orders/{order['id']}", json={"status": "received", "lpn_ids": {prod["id"]: 99999}}, headers=auth_headers)
    assert resp.status_code == 404
    assert client.get(f"/api/orders/{order['id']}", headers=auth_headers).json()["status"] == "pending"
    assert client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()["quantity"] == 0


def test_receive_order_lpn_at_wrong_location_rejected(auth_headers):
    other = client.post("/api/locations", json={"name": "Other Bay", "code": "OBAY"}, headers=auth_headers).json()
    target = client.post("/api/locations", json={"name": "Target Dock", "code": "TDOCK"}, headers=auth_headers).json()
    lpn = client.post("/api/lpns", json={"lpn_number": "LPN-ORD2", "location_id": other["id"]}, headers=auth_headers).json()
    prod = client.post("/api/products", json={"location_id": 1, "sku": "ORD-LPNLOC", "name": "LPN Loc Item", "cost_price": 5.00}, headers=auth_headers).json()
    order = client.post("/api/orders", json={"items": [{"product_id": prod["id"], "quantity": 2, "unit_price": 5.00}]}, headers=auth_headers).json()
    resp = client.put(f"/api/orders/{order['id']}", json={
        "status": "received",
        "receive_locations": {prod["id"]: target["id"]},
        "lpn_ids": {prod["id"]: lpn["id"]},
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "lpn" in resp.json()["detail"].lower()
    assert client.get(f"/api/orders/{order['id']}", headers=auth_headers).json()["status"] == "pending"
    assert client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()["quantity"] == 0


def test_receive_order_into_quarantine_area_quarantines_lot(auth_headers):
    qloc = client.post("/api/locations", json={"name": "Quarantine Bay", "code": "QBAY", "location_type": "quarantine"}, headers=auth_headers).json()
    prod = client.post("/api/products", json={"location_id": 1, "sku": "ORD-QRCV", "name": "Q Req Item", "cost_price": 5.00}, headers=auth_headers).json()
    order = client.post("/api/orders", json={"items": [{"product_id": prod["id"], "quantity": 4, "unit_price": 5.00}]}, headers=auth_headers).json()
    resp = client.put(f"/api/orders/{order['id']}", json={
        "status": "received",
        "receive_locations": {prod["id"]: qloc["id"]},
        "lot_numbers": {prod["id"]: "LOT-Q"},
    }, headers=auth_headers)
    assert resp.status_code == 200
    lots = client.get(f"/api/lots?product_id={prod['id']}", headers=auth_headers).json()["items"]
    assert len(lots) == 1
    assert lots[0]["status"] == "quarantined"
    assert lots[0]["on_hand"] == 4
    assert client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()["quantity"] == 4


def test_receive_serialized_order_into_lpn(auth_headers):
    loc = client.post("/api/locations", json={"name": "Ser Pallet", "code": "SPAL"}, headers=auth_headers).json()
    lpn = client.post("/api/lpns", json={"lpn_number": "LPN-ORD3", "location_id": loc["id"]}, headers=auth_headers).json()
    prod = client.post("/api/products", json={"location_id": 1, "sku": "ORD-SERLPN", "name": "Ser LPN Item", "cost_price": 5.00, "is_serialized": True}, headers=auth_headers).json()
    order = client.post("/api/orders", json={"items": [{"product_id": prod["id"], "quantity": 2, "unit_price": 5.00}]}, headers=auth_headers).json()
    resp = client.put(f"/api/orders/{order['id']}", json={
        "status": "received",
        "receive_locations": {prod["id"]: loc["id"]},
        "lpn_ids": {prod["id"]: lpn["id"]},
        "serial_numbers": {prod["id"]: ["SER-LPN-A", "SER-LPN-B"]},
    }, headers=auth_headers)
    assert resp.status_code == 200
    serials = client.get(f"/api/serial-numbers?product_id={prod['id']}", headers=auth_headers).json()
    assert len(serials["items"]) == 2
    assert all(s["lpn_id"] == lpn["id"] for s in serials["items"])
    updated = client.get(f"/api/lpns/{lpn['id']}", headers=auth_headers).json()
    assert updated["total_quantity"] == 2
    assert {s["serial_number"] for s in updated["serials"]} == {"SER-LPN-A", "SER-LPN-B"}


def test_receive_serialized_order_into_quarantine_quarantines_serials(auth_headers):
    qloc = client.post("/api/locations", json={"name": "Ser Quarantine", "code": "SQR", "location_type": "quarantine"}, headers=auth_headers).json()
    prod = client.post("/api/products", json={"location_id": 1, "sku": "ORD-SERQR", "name": "Ser Q Item", "cost_price": 5.00, "is_serialized": True}, headers=auth_headers).json()
    order = client.post("/api/orders", json={"items": [{"product_id": prod["id"], "quantity": 2, "unit_price": 5.00}]}, headers=auth_headers).json()
    resp = client.put(f"/api/orders/{order['id']}", json={
        "status": "received",
        "receive_locations": {prod["id"]: qloc["id"]},
        "serial_numbers": {prod["id"]: ["SER-Q1", "SER-Q2"]},
    }, headers=auth_headers)
    assert resp.status_code == 200
    serials = client.get(f"/api/serial-numbers?product_id={prod['id']}", headers=auth_headers).json()
    assert len(serials["items"]) == 2
    assert all(s["status"] == "quarantined" for s in serials["items"])


def test_order_items_expose_product_image(auth_headers):
    prod_with = client.post("/api/products", json={
        "location_id": 1, "sku": "ORD-IMG-W", "name": "Ord Image Prod",
        "unit_price": 10.0, "cost_price": 5.0, "quantity": 0, "image_url": "/uploads/ord-with.png",
    }, headers=auth_headers).json()
    prod_without = client.post("/api/products", json={
        "location_id": 1, "sku": "ORD-IMG-N", "name": "Ord No Image",
        "unit_price": 10.0, "cost_price": 5.0, "quantity": 0,
    }, headers=auth_headers).json()

    created = client.post("/api/orders", json={
        "items": [
            {"product_id": prod_with["id"], "quantity": 1, "unit_price": 10.0},
            {"product_id": prod_without["id"], "quantity": 1, "unit_price": 10.0},
        ],
    }, headers=auth_headers)
    assert created.status_code == 201
    by_product = {i["product_id"]: i for i in created.json()["items"]}
    assert by_product[prod_with["id"]]["product_image"] == "/uploads/ord-with.png"
    assert by_product[prod_without["id"]]["product_image"] == ""

    detail = client.get(f"/api/orders/{created.json()['id']}", headers=auth_headers).json()
    detail_items = {i["product_id"]: i for i in detail["items"]}
    assert detail_items[prod_with["id"]]["product_image"] == "/uploads/ord-with.png"
    assert detail_items[prod_without["id"]]["product_image"] == ""

    listing = client.get("/api/orders", headers=auth_headers).json()["items"]
    row = next(o for o in listing if o["id"] == created.json()["id"])
    listed = {i["product_id"]: i for i in row["items"]}
    assert listed[prod_with["id"]]["product_image"] == "/uploads/ord-with.png"
    assert listed[prod_without["id"]]["product_image"] == ""

