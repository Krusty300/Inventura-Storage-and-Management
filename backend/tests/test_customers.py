from tests.conftest import client


def _register(auth_headers, username, email, password="testpass123"):
    client.post("/api/users", json={
        "username": username, "email": email, "password": password, "role": "worker",
    }, headers=auth_headers)
    token = client.post("/api/auth/login", json={"username": username, "password": password}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_create_and_get_customer(auth_headers):
    resp = client.post("/api/customers", json={"name": "Acme Corp", "phone": "123", "customer_type": "wholesale"}, headers=auth_headers)
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Acme Corp"
    assert data["customer_type"] == "wholesale"
    assert client.get(f"/api/customers/{data['id']}", headers=auth_headers).json()["name"] == "Acme Corp"


def test_list_customers_search_and_type_filter(auth_headers):
    client.post("/api/customers", json={"name": "Alpha Retail", "phone": "111", "customer_type": "retail"}, headers=auth_headers)
    client.post("/api/customers", json={"name": "Beta Wholesale", "phone": "222", "customer_type": "wholesale"}, headers=auth_headers)
    res = client.get("/api/customers", headers=auth_headers).json()
    assert res["total"] >= 2
    res = client.get("/api/customers", params={"search": "Alpha"}, headers=auth_headers).json()
    assert all("Alpha" in c["name"] for c in res["items"])
    res = client.get("/api/customers", params={"customer_type": "wholesale"}, headers=auth_headers).json()
    assert all(c["customer_type"] == "wholesale" for c in res["items"])


def test_update_customer(auth_headers):
    c = client.post("/api/customers", json={"name": "Old Name"}, headers=auth_headers).json()
    resp = client.put(f"/api/customers/{c['id']}", json={"name": "New Name", "notes": "updated"}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["name"] == "New Name"


def test_delete_customer_is_soft_and_hidden(auth_headers):
    c = client.post("/api/customers", json={"name": "To Delete"}, headers=auth_headers).json()
    resp = client.delete(f"/api/customers/{c['id']}", headers=auth_headers)
    assert resp.status_code == 200
    res = client.get("/api/customers", headers=auth_headers).json()
    assert all(x["id"] != c["id"] for x in res["items"])
    assert client.get(f"/api/customers/{c['id']}", headers=auth_headers).json()["is_active"] is False


def test_worker_cannot_create_customer(auth_headers):
    worker = _register(auth_headers, "worker", "worker@example.com")
    resp = client.post("/api/customers", json={"name": "Nope"}, headers=worker)
    assert resp.status_code == 403


def test_list_includes_analytics(auth_headers):
    c = client.post("/api/customers", json={"name": "Analytics Co", "email": "a@example.com"}, headers=auth_headers).json()
    prod = client.post("/api/products", json={"location_id": 1, "sku": "AN-1", "name": "Analytics Item", "quantity": 10, "unit_price": 10.0}, headers=auth_headers).json()
    client.post("/api/sales", json={"customer_id": c["id"], "items": [{"product_id": prod["id"], "quantity": 2, "unit_price": 10.0}]}, headers=auth_headers)
    row = next(i for i in client.get("/api/customers", headers=auth_headers).json()["items"] if i["id"] == c["id"])
    assert row["total_sales"] == 1
    assert row["total_spent"] > 0
    assert row["avg_order_value"] == row["total_spent"]
    assert row["last_purchase_at"] is not None


def test_customer_stats_endpoint(auth_headers):
    c = client.post("/api/customers", json={"name": "Stats Co"}, headers=auth_headers).json()
    prod = client.post("/api/products", json={"location_id": 1, "sku": "ST-1", "name": "Stats Item", "quantity": 10, "unit_price": 8.0}, headers=auth_headers).json()
    client.post("/api/sales", json={"customer_id": c["id"], "items": [{"product_id": prod["id"], "quantity": 3, "unit_price": 8.0}]}, headers=auth_headers)
    data = client.get(f"/api/customers/{c['id']}/stats", headers=auth_headers).json()
    assert data["total_sales"] == 1
    assert data["total_spent"] > 0
    assert data["last_purchase_at"] is not None
    assert data["avg_order_value"] == round(data["total_spent"], 2)


def test_duplicate_customer_rejected(auth_headers):
    client.post("/api/customers", json={"name": "Dup Co", "phone": "555-1234"}, headers=auth_headers)
    r = client.post("/api/customers", json={"name": "Other", "phone": "555-1234"}, headers=auth_headers)
    assert r.status_code == 400
    free = client.post("/api/customers", json={"name": "Free Co", "email": "free@example.com"}, headers=auth_headers).json()
    r2 = client.put(f"/api/customers/{free['id']}", json={"name": "Dup Co"}, headers=auth_headers)
    assert r2.status_code == 400


def test_invalid_email_rejected(auth_headers):
    r = client.post("/api/customers", json={"name": "Bad Email", "email": "not-an-email"}, headers=auth_headers)
    assert r.status_code == 422


def test_include_inactive_and_restore(auth_headers):
    c = client.post("/api/customers", json={"name": "Archived Co"}, headers=auth_headers).json()
    client.delete(f"/api/customers/{c['id']}", headers=auth_headers)
    assert client.get("/api/customers", headers=auth_headers).json()["total"] == 0
    incl = client.get("/api/customers", params={"include_inactive": "true"}, headers=auth_headers).json()
    assert any(i["id"] == c["id"] for i in incl["items"])
    resp = client.post(f"/api/customers/{c['id']}/restore", headers=auth_headers)
    assert resp.status_code == 200 and resp.json()["is_active"] is True


def test_import_customers_csv(auth_headers):
    csv_data = ("name,phone,email,customer_type\n"
                "Imp One,111,i1@example.com,frequent\n"
                "Imp Two,222,i2@example.com,walk-in\n"
                ",999,,walk-in\n"
                "Imp One,111,i1@example.com,frequent\n")
    resp = client.post("/api/customers/import", headers=auth_headers, files={"file": ("c.csv", csv_data, "text/csv")})
    assert resp.status_code == 200
    data = resp.json()
    assert data["created"] == 2
    assert data["skipped"] == 1
    assert any("missing required field" in e for e in data["errors"])

    bad = client.post("/api/customers/import", headers=auth_headers, files={"file": ("c.txt", b"x", "text/plain")})
    assert bad.status_code == 400
