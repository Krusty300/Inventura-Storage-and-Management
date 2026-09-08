from tests.conftest import client


def _create_category(auth_headers, name="Test Category"):
    resp = client.post("/api/categories", json={"name": name}, headers=auth_headers)
    return resp.json()


def test_list_trash_empty(auth_headers):
    resp = client.get("/api/trash", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["items"] == []
    assert all(count == 0 for count in data["counts"].values())
    assert "category" in data["counts"]


def test_soft_delete_appears_in_trash(auth_headers):
    cat = _create_category(auth_headers)
    resp = client.delete(f"/api/categories/{cat['id']}", headers=auth_headers)
    assert resp.status_code == 200

    resp = client.get("/api/trash", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["items"]) == 1
    assert data["items"][0]["entity_type"] == "category"
    assert data["items"][0]["label"] == "Test Category"
    assert "category" in data["counts"]
    assert data["counts"]["category"] == 1


def test_restore_item(auth_headers):
    cat = _create_category(auth_headers)
    cid = cat["id"]
    client.delete(f"/api/categories/{cid}", headers=auth_headers)

    resp = client.post(f"/api/trash/category/{cid}/restore", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    # Should no longer appear in trash
    resp = client.get("/api/trash", headers=auth_headers)
    assert resp.json()["items"] == []

    # Should be accessible again
    resp = client.get(f"/api/categories/{cid}", headers=auth_headers)
    assert resp.status_code == 200


def test_permanent_delete(auth_headers):
    cat = _create_category(auth_headers)
    cid = cat["id"]
    client.delete(f"/api/categories/{cid}", headers=auth_headers)

    resp = client.delete(f"/api/trash/category/{cid}", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    # Should no longer appear in trash
    resp = client.get("/api/trash", headers=auth_headers)
    assert resp.json()["items"] == []


def test_restore_nonexistent_entity_type(auth_headers):
    resp = client.post("/api/trash/no_such_entity/1/restore", headers=auth_headers)
    assert resp.status_code == 404


def test_permanent_delete_nonexistent_entity_type(auth_headers):
    resp = client.delete("/api/trash/no_such_entity/1", headers=auth_headers)
    assert resp.status_code == 404


def test_trash_search_filter(auth_headers):
    _create_category(auth_headers, "Alpha")
    _create_category(auth_headers, "Beta")
    cat3 = _create_category(auth_headers, "Charlie")
    client.delete(f"/api/categories/{cat3['id']}", headers=auth_headers)

    resp = client.get("/api/trash?search=har", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["items"]) == 1
    assert data["items"][0]["label"] == "Charlie"


def test_trash_entity_type_filter(auth_headers):
    _create_category(auth_headers, "Cat Item")
    client.post("/api/suppliers", json={"name": "Supplier X", "phone": "1234567890"}, headers=auth_headers)
    from tests.conftest import TestingSessionLocal
    from app.models.supplier import Supplier
    db = TestingSessionLocal()
    sup = db.query(Supplier).first()
    db.close()
    client.delete(f"/api/suppliers/{sup.id}", headers=auth_headers)

    cat = _create_category(auth_headers, "Cat to trash")
    client.delete(f"/api/categories/{cat['id']}", headers=auth_headers)

    resp = client.get("/api/trash?entity_type=supplier", headers=auth_headers)
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert all(i["entity_type"] == "supplier" for i in items)


def test_multiple_entities_in_trash(auth_headers):
    cat = _create_category(auth_headers, "Del Cat")
    client.post("/api/suppliers", json={"name": "Del Supplier", "phone": "1234567890"}, headers=auth_headers)
    from tests.conftest import TestingSessionLocal
    from app.models.supplier import Supplier
    db = TestingSessionLocal()
    sup = db.query(Supplier).first()
    db.close()

    client.delete(f"/api/categories/{cat['id']}", headers=auth_headers)
    client.delete(f"/api/suppliers/{sup.id}", headers=auth_headers)

    resp = client.get("/api/trash", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["items"]) == 2
    assert data["counts"]["category"] == 1
    assert data["counts"]["supplier"] == 1
