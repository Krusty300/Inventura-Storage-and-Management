from tests.conftest import client


def test_create_category(auth_headers):
    resp = client.post("/api/categories", json={"name": "Electronics", "description": "Gadgets"}, headers=auth_headers)
    assert resp.status_code == 201
    assert resp.json()["name"] == "Electronics"


def test_create_duplicate_category(auth_headers):
    client.post("/api/categories", json={"name": "Duplicate"}, headers=auth_headers)
    resp = client.post("/api/categories", json={"name": "Duplicate"}, headers=auth_headers)
    assert resp.status_code == 400


def test_list_categories(auth_headers):
    client.post("/api/categories", json={"name": "Cat A"}, headers=auth_headers)
    client.post("/api/categories", json={"name": "Cat B"}, headers=auth_headers)
    resp = client.get("/api/categories", headers=auth_headers)
    assert resp.status_code == 200
    assert len(resp.json()["items"]) >= 2


def test_get_category(auth_headers):
    create = client.post("/api/categories", json={"name": "Specific"}, headers=auth_headers)
    cid = create.json()["id"]
    resp = client.get(f"/api/categories/{cid}", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["name"] == "Specific"


def test_update_category(auth_headers):
    create = client.post("/api/categories", json={"name": "Old Name"}, headers=auth_headers)
    cid = create.json()["id"]
    resp = client.put(f"/api/categories/{cid}", json={"name": "New Name"}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["name"] == "New Name"


def test_delete_category(auth_headers):
    create = client.post("/api/categories", json={"name": "Temp"}, headers=auth_headers)
    cid = create.json()["id"]
    resp = client.delete(f"/api/categories/{cid}", headers=auth_headers)
    assert resp.status_code == 200


def test_delete_category_with_products(auth_headers):
    cat = client.post("/api/categories", json={"name": "Has Products"}, headers=auth_headers)
    cid = cat.json()["id"]
    client.post("/api/products", json={"location_id": 1, "sku": "CATPRD", "name": "Test", "category_id": cid}, headers=auth_headers)
    resp = client.delete(f"/api/categories/{cid}", headers=auth_headers)
    assert resp.status_code == 400


def test_category_list_accepts_large_limit(auth_headers):
    client.post("/api/categories", json={"name": "Big List"}, headers=auth_headers)
    resp = client.get("/api/categories", params={"limit": 1000}, headers=auth_headers)
    assert resp.status_code == 200
    assert any(c["name"] == "Big List" for c in resp.json()["items"])


def test_category_tree(auth_headers):
    parent = client.post("/api/categories", json={"name": "Parent"}, headers=auth_headers).json()
    client.post("/api/categories", json={"name": "Child", "parent_id": parent["id"]}, headers=auth_headers)
    resp = client.get("/api/categories/tree", headers=auth_headers)
    assert resp.status_code == 200
    parents = [c for c in resp.json() if c["name"] == "Parent"]
    assert len(parents) == 1
    assert len(parents[0]["subcategories"]) == 1
