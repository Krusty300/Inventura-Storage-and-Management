from tests.conftest import client


def test_serialized_variant_under_parent_with_stock_rejected(auth_headers):
    parent = client.post("/api/products", json={
        "location_id": 1, "sku": "VZ-PARENT", "name": "VZ Parent", "quantity": 10,
    }, headers=auth_headers).json()
    resp = client.post("/api/products", json={
        "location_id": 1, "sku": "VZ-SER-VAR", "name": "VZ Serial Variant",
        "parent_id": parent["id"], "attributes": {"Color": "Red"}, "is_serialized": True,
    }, headers=auth_headers)
    assert resp.status_code == 400, resp.text
    assert "serialized variant" in resp.json()["detail"].lower()


def test_serialized_variant_under_parent_without_stock_ok(auth_headers):
    parent = client.post("/api/products", json={
        "location_id": 1, "sku": "VZ-PARENT2", "name": "VZ Parent 2", "quantity": 0,
    }, headers=auth_headers).json()
    resp = client.post("/api/products", json={
        "location_id": 1, "sku": "VZ-SER-VAR2", "name": "VZ Serial Variant 2",
        "parent_id": parent["id"], "attributes": {"Color": "Blue"}, "is_serialized": True,
    }, headers=auth_headers)
    assert resp.status_code == 201, resp.text
