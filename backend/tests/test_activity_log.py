from tests.conftest import client


def test_activity_logs_created_on_actions(auth_headers):
    prod = client.post("/api/products", json={"sku": "ACT-001", "name": "Act Item"}, headers=auth_headers).json()
    resp = client.get("/api/activity-logs", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] >= 1
    logs = client.get("/api/activity-logs", params={"entity_type": "product"}, headers=auth_headers).json()
    assert any(l["entity_id"] == prod["id"] and l["action"] == "create" for l in logs["items"])


def test_activity_log_search_and_filter(auth_headers):
    client.post("/api/products", json={"sku": "ACT-002", "name": "Zebra Item"}, headers=auth_headers)
    res = client.get("/api/activity-logs", params={"search": "Zebra"}, headers=auth_headers).json()
    assert res["total"] >= 1
    res = client.get("/api/activity-logs", params={"action": "delete"}, headers=auth_headers).json()
    assert all(l["action"] == "delete" for l in res["items"])


def test_activity_log_filter_by_entity_id(auth_headers):
    a = client.post("/api/users", json={
        "username": "targeta", "email": "targeta@example.com", "password": "testpass123", "role": "worker",
    }, headers=auth_headers).json()
    b = client.post("/api/users", json={
        "username": "targetb", "email": "targetb@example.com", "password": "testpass123", "role": "worker",
    }, headers=auth_headers).json()
    client.put(f"/api/users/{a['id']}", json={"email": "targeta2@example.com"}, headers=auth_headers)
    client.put(f"/api/users/{b['id']}", json={"email": "targetb2@example.com"}, headers=auth_headers)
    logs = client.get("/api/activity-logs", params={"entity_type": "user", "entity_id": a["id"]}, headers=auth_headers).json()
    assert all(l["entity_id"] == a["id"] for l in logs["items"])
    assert all("targeta" in l["description"] for l in logs["items"])
