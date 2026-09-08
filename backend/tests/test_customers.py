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
    assert client.get(f"/api/customers/{c['id']}", headers=auth_headers).status_code == 404
    # The deleted customer is recoverable from the Trash.
    trash = client.get("/api/trash", headers=auth_headers).json()
    assert any(i["entity_type"] == "customer" and i["id"] == c["id"] for i in trash["items"])


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


def test_customer_frequent_products_ranks_by_order_count(auth_headers):
    c = client.post("/api/customers", json={"name": "Freq Co"}, headers=auth_headers).json()
    p1 = client.post("/api/products", json={"location_id": 1, "sku": "FR-1", "name": "Frequent Item", "quantity": 50, "unit_price": 5.0}, headers=auth_headers).json()
    p2 = client.post("/api/products", json={"location_id": 1, "sku": "FR-2", "name": "One-Off Item", "quantity": 50, "unit_price": 5.0}, headers=auth_headers).json()
    for _ in range(3):
        client.post("/api/sales", json={"customer_id": c["id"], "items": [{"product_id": p1["id"], "quantity": 1, "unit_price": 5.0}]}, headers=auth_headers)
    client.post("/api/sales", json={"customer_id": c["id"], "items": [{"product_id": p2["id"], "quantity": 2, "unit_price": 5.0}]}, headers=auth_headers)

    data = client.get(f"/api/customers/{c['id']}/frequent-products", headers=auth_headers).json()
    assert [r["product_id"] for r in data] == [p1["id"], p2["id"]]
    assert data[0]["product_name"] == p1["name"]
    assert data[0]["order_count"] == 3
    assert data[0]["total_quantity"] == 3
    assert data[1]["order_count"] == 1
    assert data[1]["total_quantity"] == 2


def test_customer_frequent_products_excludes_refunded_and_others(auth_headers):
    c1 = client.post("/api/customers", json={"name": "Owner Co"}, headers=auth_headers).json()
    c2 = client.post("/api/customers", json={"name": "Other Co"}, headers=auth_headers).json()
    prod = client.post("/api/products", json={"location_id": 1, "sku": "FR-3", "name": "Shared Item", "quantity": 50, "unit_price": 5.0}, headers=auth_headers).json()
    sale = client.post("/api/sales", json={"customer_id": c1["id"], "items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 5.0}]}, headers=auth_headers).json()
    client.put(f"/api/sales/{sale['id']}/refund", headers=auth_headers)
    client.post("/api/sales", json={"customer_id": c2["id"], "items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 5.0}]}, headers=auth_headers)

    assert client.get(f"/api/customers/{c1['id']}/frequent-products", headers=auth_headers).json() == []
    assert len(client.get(f"/api/customers/{c2['id']}/frequent-products", headers=auth_headers).json()) == 1


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
    # Soft-deleted (trashed) customers no longer appear with include_inactive.
    incl = client.get("/api/customers", params={"include_inactive": "true"}, headers=auth_headers).json()
    assert all(i["id"] != c["id"] for i in incl["items"])
    trash = client.get("/api/trash", headers=auth_headers).json()
    assert any(i["entity_type"] == "customer" and i["id"] == c["id"] for i in trash["items"])
    # Restore through the Trash endpoint re-activates the customer.
    resp = client.post(f"/api/trash/customer/{c['id']}/restore", headers=auth_headers)
    assert resp.status_code == 200
    restored = client.get(f"/api/customers/{c['id']}", headers=auth_headers).json()
    assert restored["is_active"] is True
    # A deactivated-but-not-deleted customer still shows up with include_inactive.
    c2 = client.post("/api/customers", json={"name": "Deact Only"}, headers=auth_headers).json()
    client.patch("/api/customers/bulk-edit", json={"ids": [c2["id"]], "is_active": False}, headers=auth_headers)
    incl2 = client.get("/api/customers", params={"include_inactive": "true"}, headers=auth_headers).json()
    assert any(i["id"] == c2["id"] for i in incl2["items"])
    assert all(i["id"] != c2["id"] for i in client.get("/api/customers", headers=auth_headers).json()["items"])


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
