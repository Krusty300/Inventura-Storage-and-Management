from app.models import Location
from app.services import inventory
from tests.conftest import TestingSessionLocal, client


def _create_location(auth_headers, name="Bin A-01", code="A-01", location_type="bin", parent_id=None):
    return client.post("/api/locations", json={
        "name": name, "code": code, "location_type": location_type, "parent_id": parent_id,
    }, headers=auth_headers)


def test_location_crud(auth_headers):
    resp = _create_location(auth_headers)
    assert resp.status_code == 201
    loc = resp.json()
    assert loc["path"] == "Bin A-01"
    assert loc["location_type"] == "bin"

    child = _create_location(auth_headers, name="Shelf 1", code="A-01-01", parent_id=loc["id"])
    assert child.status_code == 201
    assert child.json()["path"] == "Bin A-01 / Shelf 1"

    tree = client.get("/api/locations/tree", headers=auth_headers).json()
    assert len(tree) == 1
    assert tree[0]["children"][0]["name"] == "Shelf 1"

    updated = client.put(f"/api/locations/{loc['id']}", json={"location_type": "aisle"}, headers=auth_headers)
    assert updated.status_code == 200
    assert updated.json()["location_type"] == "aisle"

    assert client.delete(f"/api/locations/{child.json()['id']}", headers=auth_headers).status_code == 200


def test_location_delete_blocked_with_stock(auth_headers):
    loc = _create_location(auth_headers).json()
    prod = client.post("/api/products", json={
        "sku": "LOC-STOCK", "name": "Loc Stock", "unit_price": 1.0, "quantity": 0, "location_id": loc["id"],
    }, headers=auth_headers).json()
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 3, "location_id": loc["id"]}],
    }, headers=auth_headers).status_code == 201

    assert client.delete(f"/api/locations/{loc['id']}", headers=auth_headers).status_code == 400


def test_location_delete_blocked_with_children(auth_headers):
    loc = _create_location(auth_headers, code="P-BLOCK").json()
    _create_location(auth_headers, name="Kid", code="P-BLOCK-1", parent_id=loc["id"])
    assert client.delete(f"/api/locations/{loc['id']}", headers=auth_headers).status_code == 400


def test_duplicate_location_code_rejected(auth_headers):
    _create_location(auth_headers, code="DUP")
    resp = _create_location(auth_headers, name="Other", code="DUP")
    assert resp.status_code == 400


def test_product_location_id_wiring(auth_headers):
    loc = _create_location(auth_headers).json()
    prod = client.post("/api/products", json={
        "sku": "LOC-PROD", "name": "Loc Prod", "unit_price": 1.0, "quantity": 0, "location_id": loc["id"],
    }, headers=auth_headers).json()
    assert prod["location_id"] == loc["id"]

    fetched = client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()
    assert fetched["location_id"] == loc["id"]

    assert client.post("/api/products", json={
        "sku": "LOC-BAD", "name": "Bad", "quantity": 0, "location_id": 99999,
    }, headers=auth_headers).status_code == 400


def test_worker_cannot_create_location(auth_headers):
    client.post("/api/users", json={
        "username": "loc_worker", "email": "loc_worker@example.com", "password": "workerpass123", "role": "worker",
    }, headers=auth_headers)
    token = client.post("/api/auth/login", json={"username": "loc_worker", "password": "workerpass123"}).json()["access_token"]
    worker = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/locations", headers=worker).status_code == 200
    assert _create_location(worker).status_code == 403


def test_location_type_validated(auth_headers):
    resp = _create_location(auth_headers, code="BADTYPE", location_type="binn")
    assert resp.status_code == 400

    loc = _create_location(auth_headers, code="TVALID").json()
    resp = client.put(f"/api/locations/{loc['id']}", json={"location_type": "cubby"}, headers=auth_headers)
    assert resp.status_code == 400


def test_location_parent_cycle_rejected(auth_headers):
    a = _create_location(auth_headers, code="CYC-A").json()
    b = _create_location(auth_headers, code="CYC-B", parent_id=a["id"]).json()
    c = _create_location(auth_headers, code="CYC-C", parent_id=b["id"]).json()

    resp = client.put(f"/api/locations/{a['id']}", json={"parent_id": c["id"]}, headers=auth_headers)
    assert resp.status_code == 400

    resp = client.put(f"/api/locations/{a['id']}", json={"parent_id": b["id"]}, headers=auth_headers)
    assert resp.status_code == 400

    assert client.put(f"/api/locations/{a['id']}", json={"parent_id": a["id"]}, headers=auth_headers).status_code == 400


def test_location_tree_and_list_include_quantity_and_value(auth_headers):
    loc = _create_location(auth_headers, code="QTY-1").json()
    prod = client.post("/api/products", json={
        "sku": "LOC-QTY", "name": "Qty Loc", "unit_price": 2.0, "cost_price": 5.0, "quantity": 0, "location_id": loc["id"],
    }, headers=auth_headers).json()
    client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 3, "location_id": loc["id"]}],
    }, headers=auth_headers)

    tree = client.get("/api/locations/tree", headers=auth_headers).json()
    assert tree[0]["stock_line_count"] == 1
    assert tree[0]["total_quantity"] == 3
    assert tree[0]["stock_value"] == 15.0

    items = client.get("/api/locations", headers=auth_headers).json()["items"]
    loc_item = next(i for i in items if i["id"] == loc["id"])
    assert loc_item["total_quantity"] == 3
    assert loc_item["stock_value"] == 15.0


def test_location_summary(auth_headers):
    _create_location(auth_headers, name="Sum One", code="SUM-1")
    _create_location(auth_headers, name="Sum Two", code="SUM-2")
    _create_location(auth_headers, name="Sum Three", code="SUM-3")
    summary = client.get("/api/locations/summary", headers=auth_headers).json()
    assert summary["total"] == 3
    assert summary["active"] == 3
    assert summary["inactive"] == 0
    assert summary["total_stock_lines"] == 0
    assert summary["total_value"] == 0.0

    items = client.get("/api/locations", headers=auth_headers).json()["items"]
    target = next(i for i in items if i["code"] == "SUM-1")
    client.put(f"/api/locations/{target['id']}", json={"is_active": False}, headers=auth_headers)
    summary2 = client.get("/api/locations/summary", headers=auth_headers).json()
    assert summary2["inactive"] == 1
    assert summary2["active"] == 2


def test_location_detail_endpoint(auth_headers):
    loc = _create_location(auth_headers, code="DET-1").json()
    prod = client.post("/api/products", json={
        "sku": "LOC-DET", "name": "Det Loc", "unit_price": 2.0, "cost_price": 5.0, "quantity": 0, "location_id": loc["id"],
    }, headers=auth_headers).json()
    client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 4, "location_id": loc["id"]}],
    }, headers=auth_headers)
    client.post("/api/lpns", json={"lpn_number": "LPN-DET", "lpn_type": "pallet", "location_id": loc["id"]}, headers=auth_headers)

    detail = client.get(f"/api/locations/{loc['id']}/detail", headers=auth_headers).json()
    assert detail["location"]["id"] == loc["id"]
    assert detail["location"]["total_quantity"] == 4
    assert len(detail["stock_lines"]) == 1
    assert detail["stock_lines"][0]["product_name"] == "Det Loc"
    assert detail["stock_lines"][0]["quantity"] == 4
    assert detail["stock_lines"][0]["value"] == 20.0
    assert len(detail["lpns"]) == 1
    assert detail["lpns"][0]["lpn_number"] == "LPN-DET"


def test_location_list_accepts_large_limit(auth_headers):
    resp = client.get("/api/locations", params={"limit": 5000}, headers=auth_headers)
    assert resp.status_code == 200
