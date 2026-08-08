from tests.conftest import client


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
    items = resp.json()["items"]
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

