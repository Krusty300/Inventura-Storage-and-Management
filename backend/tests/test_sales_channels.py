from tests.conftest import client


def test_create_channel(auth_headers):
    resp = client.post("/api/sales-channels", json={"name": "Main Store", "type": "store"}, headers=auth_headers)
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Main Store"
    assert data["type"] == "store"
    assert data["is_active"] is True


def test_create_channel_duplicate_name(auth_headers):
    client.post("/api/sales-channels", json={"name": "Dup Ch", "type": "store"}, headers=auth_headers)
    resp = client.post("/api/sales-channels", json={"name": "Dup Ch", "type": "webstore"}, headers=auth_headers)
    assert resp.status_code == 400
    assert "already exists" in resp.json()["detail"]


def test_create_channel_invalid_type(auth_headers):
    resp = client.post("/api/sales-channels", json={"name": "Bad", "type": "invalid"}, headers=auth_headers)
    assert resp.status_code == 400


def test_list_channels(auth_headers):
    client.post("/api/sales-channels", json={"name": "List A", "type": "store"}, headers=auth_headers)
    client.post("/api/sales-channels", json={"name": "List B", "type": "webstore"}, headers=auth_headers)
    resp = client.get("/api/sales-channels", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["total"] >= 2


def test_list_channels_search(auth_headers):
    client.post("/api/sales-channels", json={"name": "Searchable XYZ", "type": "marketplace"}, headers=auth_headers)
    resp = client.get("/api/sales-channels?search=Searchable", headers=auth_headers)
    assert resp.status_code == 200
    assert any(ch["name"] == "Searchable XYZ" for ch in resp.json()["items"])


def test_list_all_active(auth_headers):
    ch = client.post("/api/sales-channels", json={"name": "Active Ch", "type": "b2b"}, headers=auth_headers).json()
    client.put(f"/api/sales-channels/{ch['id']}", json={"is_active": False}, headers=auth_headers)
    resp = client.get("/api/sales-channels/all", headers=auth_headers)
    assert resp.status_code == 200
    names = [c["name"] for c in resp.json()]
    assert "Active Ch" not in names


def test_get_channel(auth_headers):
    ch = client.post("/api/sales-channels", json={"name": "Get Me", "type": "store"}, headers=auth_headers).json()
    resp = client.get(f"/api/sales-channels/{ch['id']}", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["name"] == "Get Me"


def test_get_channel_not_found(auth_headers):
    resp = client.get("/api/sales-channels/99999", headers=auth_headers)
    assert resp.status_code == 404


def test_update_channel(auth_headers):
    ch = client.post("/api/sales-channels", json={"name": "Old Name", "type": "store"}, headers=auth_headers).json()
    resp = client.put(f"/api/sales-channels/{ch['id']}", json={"name": "New Name", "type": "webstore"}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["name"] == "New Name"
    assert resp.json()["type"] == "webstore"


def test_update_channel_duplicate_name(auth_headers):
    ch1 = client.post("/api/sales-channels", json={"name": "Uniq1", "type": "store"}, headers=auth_headers).json()
    client.post("/api/sales-channels", json={"name": "Uniq2", "type": "store"}, headers=auth_headers)
    resp = client.put(f"/api/sales-channels/{ch1['id']}", json={"name": "Uniq2"}, headers=auth_headers)
    assert resp.status_code == 400


def test_delete_channel(auth_headers):
    ch = client.post("/api/sales-channels", json={"name": "Del Me", "type": "store"}, headers=auth_headers).json()
    resp = client.delete(f"/api/sales-channels/{ch['id']}", headers=auth_headers)
    assert resp.status_code == 200
    resp = client.get(f"/api/sales-channels/{ch['id']}", headers=auth_headers)
    assert resp.status_code == 404


def test_delete_channel_with_sales_blocked(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, "sku": "CH-SALE", "name": "Ch Sale", "unit_price": 10.0, "quantity": 20}, headers=auth_headers).json()
    ch = client.post("/api/sales-channels", json={"name": "Has Sales", "type": "store"}, headers=auth_headers).json()
    client.post("/api/sales", json={"items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 10.0}], "channel_id": ch["id"]}, headers=auth_headers)
    resp = client.delete(f"/api/sales-channels/{ch['id']}", headers=auth_headers)
    assert resp.status_code == 400
    assert "linked" in resp.json()["detail"].lower()


def test_sale_records_channel(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, "sku": "CH-REC", "name": "Ch Rec", "unit_price": 15.0, "quantity": 20}, headers=auth_headers).json()
    ch = client.post("/api/sales-channels", json={"name": "Track Me", "type": "marketplace"}, headers=auth_headers).json()
    resp = client.post("/api/sales", json={"items": [{"product_id": prod["id"], "quantity": 2, "unit_price": 15.0}], "channel_id": ch["id"]}, headers=auth_headers)
    assert resp.status_code == 201
    assert resp.json()["channel_id"] == ch["id"]
    assert resp.json()["channel_name"] == "Track Me"


def test_sale_invalid_channel(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, "sku": "CH-BAD", "name": "Ch Bad", "unit_price": 10.0, "quantity": 20}, headers=auth_headers).json()
    resp = client.post("/api/sales", json={"items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 10.0}], "channel_id": 99999}, headers=auth_headers)
    assert resp.status_code == 400
    assert "not found" in resp.json()["detail"].lower()


def test_list_sales_filter_by_channel(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, "sku": "CH-FIL", "name": "Ch Fil", "unit_price": 10.0, "quantity": 20}, headers=auth_headers).json()
    ch = client.post("/api/sales-channels", json={"name": "Filter Ch", "type": "store"}, headers=auth_headers).json()
    client.post("/api/sales", json={"items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 10.0}], "channel_id": ch["id"]}, headers=auth_headers)
    client.post("/api/sales", json={"items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 10.0}]}, headers=auth_headers)
    resp = client.get(f"/api/sales?channel_id={ch['id']}", headers=auth_headers)
    assert resp.status_code == 200
    for s in resp.json()["items"]:
        assert s["channel_id"] == ch["id"]
