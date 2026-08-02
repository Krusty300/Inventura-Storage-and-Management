from tests.conftest import client


def test_create_supplier(auth_headers):
    resp = client.post("/api/suppliers", json={
        "name": "ACME Corp",
        "contact_person": "John Doe",
        "email": "john@acme.com",
        "phone": "555-0100",
    }, headers=auth_headers)
    assert resp.status_code == 201
    assert resp.json()["name"] == "ACME Corp"


def test_list_suppliers(auth_headers):
    client.post("/api/suppliers", json={"name": "Supplier A"}, headers=auth_headers)
    client.post("/api/suppliers", json={"name": "Supplier B"}, headers=auth_headers)
    resp = client.get("/api/suppliers", headers=auth_headers)
    assert resp.status_code == 200
    assert len(resp.json()["items"]) >= 2


def test_get_supplier(auth_headers):
    create = client.post("/api/suppliers", json={"name": "Specific Supplier"}, headers=auth_headers)
    sid = create.json()["id"]
    resp = client.get(f"/api/suppliers/{sid}", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["name"] == "Specific Supplier"


def test_update_supplier(auth_headers):
    create = client.post("/api/suppliers", json={"name": "Old Co"}, headers=auth_headers)
    sid = create.json()["id"]
    resp = client.put(f"/api/suppliers/{sid}", json={"name": "New Co", "phone": "555-9999"}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["name"] == "New Co"
    assert resp.json()["phone"] == "555-9999"


def test_delete_supplier(auth_headers):
    create = client.post("/api/suppliers", json={"name": "Temp Supplier"}, headers=auth_headers)
    sid = create.json()["id"]
    resp = client.delete(f"/api/suppliers/{sid}", headers=auth_headers)
    assert resp.status_code == 200


def test_delete_supplier_with_products(auth_headers):
    sup = client.post("/api/suppliers", json={"name": "Has Products"}, headers=auth_headers).json()
    client.post("/api/products", json={"sku": "SUPPPRD", "name": "Test", "supplier_id": sup["id"]}, headers=auth_headers)
    resp = client.delete(f"/api/suppliers/{sup['id']}", headers=auth_headers)
    assert resp.status_code == 200
    assert client.get(f"/api/suppliers/{sup['id']}", headers=auth_headers).json()["is_active"] is False


def _received_order(auth_headers, supplier_id, sku, price=10.0, qty=2):
    prod = client.post("/api/products", json={"sku": sku, "name": "Test Item", "quantity": 10, "unit_price": price, "supplier_id": supplier_id}, headers=auth_headers).json()
    order = client.post("/api/orders", json={
        "supplier_id": supplier_id,
        "items": [{"product_id": prod["id"], "quantity": qty, "unit_price": price}],
    }, headers=auth_headers).json()
    client.put(f"/api/orders/{order['id']}", json={"status": "received"}, headers=auth_headers)
    return order


def test_list_includes_analytics(auth_headers):
    sup = client.post("/api/suppliers", json={"name": "Analytics Supply"}, headers=auth_headers).json()
    _received_order(auth_headers, sup["id"], "SAP-1", price=10.0)
    row = next(i for i in client.get("/api/suppliers", headers=auth_headers).json()["items"] if i["id"] == sup["id"])
    assert row["total_orders"] == 1
    assert row["total_spent"] == 20.0
    assert row["avg_order_value"] == 20.0
    assert row["last_order_at"] is not None
    assert row["product_count"] == 1


def test_supplier_stats_endpoint(auth_headers):
    sup = client.post("/api/suppliers", json={"name": "Stats Supply"}, headers=auth_headers).json()
    _received_order(auth_headers, sup["id"], "SPS-1", price=8.0)
    data = client.get(f"/api/suppliers/{sup['id']}/stats", headers=auth_headers).json()
    assert data["total_orders"] == 1
    assert data["total_spent"] == 16.0
    assert data["avg_order_value"] == 16.0
    assert data["last_order_at"] is not None
    assert data["product_count"] == 1


def test_duplicate_supplier_rejected(auth_headers):
    client.post("/api/suppliers", json={"name": "Dup Supply", "email": "dup@example.com"}, headers=auth_headers)
    r = client.post("/api/suppliers", json={"name": "Other Supply", "email": "dup@example.com"}, headers=auth_headers)
    assert r.status_code == 400
    free = client.post("/api/suppliers", json={"name": "Free Supply", "email": "free@example.com"}, headers=auth_headers).json()
    r2 = client.put(f"/api/suppliers/{free['id']}", json={"name": "Dup Supply"}, headers=auth_headers)
    assert r2.status_code == 400


def test_invalid_email_rejected(auth_headers):
    r = client.post("/api/suppliers", json={"name": "Bad Email Co", "email": "not-an-email"}, headers=auth_headers)
    assert r.status_code == 422


def test_include_inactive_and_restore(auth_headers):
    s = client.post("/api/suppliers", json={"name": "Archived Supply"}, headers=auth_headers).json()
    client.delete(f"/api/suppliers/{s['id']}", headers=auth_headers)
    assert all(x["id"] != s["id"] for x in client.get("/api/suppliers", headers=auth_headers).json()["items"])
    incl = client.get("/api/suppliers", params={"include_inactive": "true"}, headers=auth_headers).json()
    assert any(i["id"] == s["id"] for i in incl["items"])
    resp = client.post(f"/api/suppliers/{s['id']}/restore", headers=auth_headers)
    assert resp.status_code == 200 and resp.json()["is_active"] is True


def test_import_suppliers_csv(auth_headers):
    csv_data = ("name,contact_person,email,phone\n"
                "Imp Supply One,Alice,i1@example.com,111\n"
                "Imp Supply Two,Bob,i2@example.com,222\n"
                ",,,\n"
                "Imp Supply One,Alice,i1@example.com,111\n")
    resp = client.post("/api/suppliers/import", headers=auth_headers, files={"file": ("s.csv", csv_data, "text/csv")})
    assert resp.status_code == 200
    data = resp.json()
    assert data["created"] == 2
    assert data["skipped"] == 1
    assert any("missing required field" in e for e in data["errors"])

    bad = client.post("/api/suppliers/import", headers=auth_headers, files={"file": ("s.txt", b"x", "text/plain")})
    assert bad.status_code == 400
