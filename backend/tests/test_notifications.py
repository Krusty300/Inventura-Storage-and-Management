from tests.conftest import client


def _make_product(auth_headers, sku="NOTIF-PROD", quantity=10, reorder_level=0):
    return client.post("/api/products", json={"location_id": 1, 
        "sku": sku, "name": sku, "quantity": quantity, "reorder_level": reorder_level,
    }, headers=auth_headers).json()


def test_sale_creates_notification_for_admin(auth_headers):
    prod = _make_product(auth_headers)
    client.post("/api/sales", json={"items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 10.0}]}, headers=auth_headers)
    notifs = client.get("/api/notifications", headers=auth_headers).json()
    assert len(notifs) >= 1
    assert client.get("/api/notifications/unread-count", headers=auth_headers).json() >= 1
    assert notifs[0]["is_read"] is False


def test_mark_read_and_read_all(auth_headers):
    prod = _make_product(auth_headers)
    client.post("/api/sales", json={"items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 10.0}]}, headers=auth_headers)
    notifs = client.get("/api/notifications", headers=auth_headers).json()
    nid = notifs[0]["id"]
    resp = client.put(f"/api/notifications/{nid}/read", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["is_read"] is True
    assert client.get("/api/notifications/unread-count", headers=auth_headers).json() == 0
    client.post("/api/sales", json={"items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 10.0}]}, headers=auth_headers)
    client.put("/api/notifications/read-all", headers=auth_headers)
    assert client.get("/api/notifications/unread-count", headers=auth_headers).json() == 0


def test_notification_belongs_to_owner(auth_headers):
    prod = _make_product(auth_headers)
    client.post("/api/sales", json={"items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 10.0}]}, headers=auth_headers)
    nid = client.get("/api/notifications", headers=auth_headers).json()[0]["id"]
    client.post("/api/users", json={"username": "worker4", "email": "worker4@example.com", "password": "testpass123", "role": "worker"}, headers=auth_headers)
    token = client.post("/api/auth/login", json={"username": "worker4", "password": "testpass123"}).json()["access_token"]
    other = {"Authorization": f"Bearer {token}"}
    assert client.put(f"/api/notifications/{nid}/read", headers=other).status_code == 403
    assert client.delete(f"/api/notifications/{nid}", headers=other).status_code == 403
    assert client.get("/api/notifications", headers=other).json() == []


def test_delete_notification(auth_headers):
    prod = _make_product(auth_headers)
    client.post("/api/sales", json={"items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 10.0}]}, headers=auth_headers)
    nid = client.get("/api/notifications", headers=auth_headers).json()[0]["id"]
    resp = client.delete(f"/api/notifications/{nid}", headers=auth_headers)
    assert resp.status_code == 200
    assert client.get("/api/notifications", headers=auth_headers).json() == []


def _low_stock_notifs(auth_headers):
    return [n for n in client.get("/api/notifications", headers=auth_headers).json()
            if n["type"] == "warning" and n["title"].startswith("Low stock:")]


def _lot(auth_headers, product_id, lot_number):
    lots = client.get("/api/lots", params={"product_id": product_id}, headers=auth_headers).json()
    return next(l for l in lots["items"] if l["lot_number"] == lot_number)


def _receive(auth_headers, product_id, qty, lot):
    resp = client.post("/api/receipts", json={
        "items": [{"product_id": product_id, "quantity": qty, "lot_number": lot}],
    }, headers=auth_headers)
    assert resp.status_code == 201, resp.text


def test_low_stock_notification_uses_sellable_qty(auth_headers):
    # Raw on-hand is 5 (above reorder level 4) but 3 of it is quarantined,
    # so sellable (2) is at/below the reorder level -> must still notify.
    prod = _make_product(auth_headers, sku="LOW-SELL", quantity=0, reorder_level=4)
    _receive(auth_headers, prod["id"], 2, "LOT-SELL-S")
    _receive(auth_headers, prod["id"], 3, "LOT-SELL-Q")
    client.put(f"/api/lots/{_lot(auth_headers, prod['id'], 'LOT-SELL-Q')['id']}",
               json={"status": "quarantined"}, headers=auth_headers)
    assert client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()["quantity"] == 5

    client.post("/api/sales", json={"items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 10.0}]}, headers=auth_headers)
    low = _low_stock_notifs(auth_headers)
    assert len(low) == 1
    assert f"reorder level 4" in low[0]["message"]


def test_low_stock_notification_dedupe(auth_headers):
    prod = _make_product(auth_headers, sku="LOW-PROD", quantity=5, reorder_level=5)
    # First sale drops stock to 4 <= reorder level -> notification created
    client.post("/api/sales", json={"items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 10.0}]}, headers=auth_headers)
    # Second sale while still low -> should NOT create a duplicate
    client.post("/api/sales", json={"items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 10.0}]}, headers=auth_headers)
    assert len(_low_stock_notifs(auth_headers)) == 1
    # Once the notification is read, a later low-stock trigger creates a new one
    nid = _low_stock_notifs(auth_headers)[0]["id"]
    client.put(f"/api/notifications/{nid}/read", headers=auth_headers)
    client.post("/api/sales", json={"items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 10.0}]}, headers=auth_headers)
    low = _low_stock_notifs(auth_headers)
    assert len(low) == 2
    assert sum(1 for n in low if not n["is_read"]) == 1
