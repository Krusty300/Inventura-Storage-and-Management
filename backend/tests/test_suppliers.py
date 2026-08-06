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
    client.post("/api/products", json={"location_id": 1, "sku": "SUPPPRD", "name": "Test", "supplier_id": sup["id"]}, headers=auth_headers)
    resp = client.delete(f"/api/suppliers/{sup['id']}", headers=auth_headers)
    assert resp.status_code == 200
    assert client.get(f"/api/suppliers/{sup['id']}", headers=auth_headers).json()["is_active"] is False


def _received_order(auth_headers, supplier_id, sku, price=10.0, qty=2):
    prod = client.post("/api/products", json={"location_id": 1, "sku": sku, "name": "Test Item", "quantity": 10, "unit_price": price, "supplier_id": supplier_id}, headers=auth_headers).json()
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


def test_supplier_products_endpoint(auth_headers):
    sup_a = client.post("/api/suppliers", json={"name": "Prod Sup A"}, headers=auth_headers).json()
    sup_b = client.post("/api/suppliers", json={"name": "Prod Sup B"}, headers=auth_headers).json()

    client.post("/api/products", json={"location_id": 1, "sku": "PSA-ACT", "name": "A Active", "supplier_id": sup_a["id"], "quantity": 5}, headers=auth_headers).json()
    client.post("/api/products", json={"location_id": 1, "sku": "PSA-INA", "name": "A Inactive", "supplier_id": sup_a["id"], "is_active": False}, headers=auth_headers).json()
    parent = client.post("/api/products", json={"location_id": 1, "sku": "PSA-GRP", "name": "A Group", "supplier_id": sup_a["id"]}, headers=auth_headers).json()
    client.post("/api/products", json={"location_id": 1, "sku": "PSA-VAR", "parent_id": parent["id"], "quantity": 3, "attributes": {"Color": "Red"}}, headers=auth_headers).json()
    client.post("/api/products", json={"location_id": 1, "sku": "PSB-ONE", "name": "B Product", "supplier_id": sup_b["id"]}, headers=auth_headers).json()

    data = client.get(f"/api/suppliers/{sup_a['id']}/products", params={"limit": 50}, headers=auth_headers).json()
    assert data["total"] == 3
    skus = {p["sku"] for p in data["items"]}
    assert skus == {"PSA-ACT", "PSA-INA", "PSA-GRP"}
    by_sku = {p["sku"]: p for p in data["items"]}
    assert by_sku["PSA-INA"]["is_active"] is False
    assert by_sku["PSA-ACT"]["supplier_name"] == "Prod Sup A"
    assert [v["sku"] for v in by_sku["PSA-GRP"]["variants"]] == ["PSA-VAR"]
    assert all(p["supplier_id"] == sup_a["id"] for p in data["items"])

    assert client.get("/api/suppliers/999999/products", headers=auth_headers).status_code == 404


def test_suppliers_filtered_by_category(auth_headers):
    cat = client.post("/api/categories", json={"name": "Cat Filter"}, headers=auth_headers).json()
    other_cat = client.post("/api/categories", json={"name": "Other Cat"}, headers=auth_headers).json()
    sup_a = client.post("/api/suppliers", json={"name": "Cat Sup A"}, headers=auth_headers).json()
    sup_b = client.post("/api/suppliers", json={"name": "Cat Sup B"}, headers=auth_headers).json()
    sup_c = client.post("/api/suppliers", json={"name": "Cat Sup C"}, headers=auth_headers).json()
    client.post("/api/products", json={"location_id": 1, "sku": "CS-1", "name": "In Cat", "supplier_id": sup_a["id"], "category_id": cat["id"]}, headers=auth_headers)
    client.post("/api/products", json={"location_id": 1, "sku": "CS-2", "name": "Other Cat Item", "supplier_id": sup_b["id"], "category_id": other_cat["id"]}, headers=auth_headers)
    client.post("/api/products", json={"location_id": 1, "sku": "CS-3", "name": "In Cat C", "supplier_id": sup_c["id"], "category_id": cat["id"]}, headers=auth_headers)

    names = {i["name"] for i in client.get("/api/suppliers", params={"category_id": cat["id"], "limit": 50}, headers=auth_headers).json()["items"]}
    assert names == {"Cat Sup A", "Cat Sup C"}
    assert "Cat Sup B" not in names

    client.delete(f"/api/suppliers/{sup_c['id']}", headers=auth_headers)
    active = {i["name"] for i in client.get("/api/suppliers", params={"category_id": cat["id"], "limit": 50}, headers=auth_headers).json()["items"]}
    assert active == {"Cat Sup A"}
    with_inactive = {i["name"] for i in client.get("/api/suppliers", params={"category_id": cat["id"], "include_inactive": "true", "limit": 50}, headers=auth_headers).json()["items"]}
    assert with_inactive == {"Cat Sup A", "Cat Sup C"}


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
