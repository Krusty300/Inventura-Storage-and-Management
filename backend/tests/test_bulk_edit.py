from tests.conftest import client


def _worker(auth_headers, username):
    client.post("/api/users", json={
        "username": username, "email": f"{username}@example.com", "password": "testpass123", "role": "worker",
    }, headers=auth_headers)
    token = client.post("/api/auth/login", json={"username": username, "password": "testpass123"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _make_order(auth_headers, sku):
    prod = client.post("/api/products", json={"location_id": 1, 
        "sku": sku, "name": sku, "unit_price": 10.0, "cost_price": 5.0, "quantity": 10,
    }, headers=auth_headers).json()
    return client.post("/api/orders", json={
        "items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 5.0}],
    }, headers=auth_headers).json()


# --- Categories ----------------------------------------------------------

def test_bulk_edit_categories(auth_headers):
    c1 = client.post("/api/categories", json={"name": "Cat 1", "description": "old"}, headers=auth_headers).json()
    c2 = client.post("/api/categories", json={"name": "Cat 2"}, headers=auth_headers).json()
    parent = client.post("/api/categories", json={"name": "Parent"}, headers=auth_headers).json()
    resp = client.patch("/api/categories/bulk-edit", json={
        "ids": [c1["id"], c2["id"]], "description": "new desc", "parent_id": parent["id"],
    }, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["updated"] == 2
    assert client.get(f"/api/categories/{c1['id']}", headers=auth_headers).json()["parent_id"] == parent["id"]
    assert client.get(f"/api/categories/{c2['id']}", headers=auth_headers).json()["description"] == "new desc"


def test_bulk_edit_categories_clear_parent(auth_headers):
    parent = client.post("/api/categories", json={"name": "P"}, headers=auth_headers).json()
    child = client.post("/api/categories", json={"name": "Child", "parent_id": parent["id"]}, headers=auth_headers).json()
    resp = client.patch("/api/categories/bulk-edit", json={"ids": [child["id"]], "parent_id": None}, headers=auth_headers)
    assert resp.status_code == 200
    assert client.get(f"/api/categories/{child['id']}", headers=auth_headers).json()["parent_id"] is None


def test_bulk_edit_categories_rejects_self_parent(auth_headers):
    c = client.post("/api/categories", json={"name": "Self"}, headers=auth_headers).json()
    resp = client.patch("/api/categories/bulk-edit", json={"ids": [c["id"]], "parent_id": c["id"]}, headers=auth_headers)
    assert resp.status_code == 400


def test_bulk_edit_categories_rejects_cycle(auth_headers):
    a = client.post("/api/categories", json={"name": "A"}, headers=auth_headers).json()
    b = client.post("/api/categories", json={"name": "B"}, headers=auth_headers).json()
    client.put(f"/api/categories/{b['id']}", json={"parent_id": a["id"]}, headers=auth_headers)
    resp = client.patch("/api/categories/bulk-edit", json={"ids": [a["id"]], "parent_id": b["id"]}, headers=auth_headers)
    assert resp.status_code == 400


# --- Suppliers -----------------------------------------------------------

def test_bulk_edit_suppliers(auth_headers):
    s1 = client.post("/api/suppliers", json={"name": "Sup 1", "contact_person": "Old"}, headers=auth_headers).json()
    s2 = client.post("/api/suppliers", json={"name": "Sup 2"}, headers=auth_headers).json()
    resp = client.patch("/api/suppliers/bulk-edit", json={
        "ids": [s1["id"], s2["id"]], "contact_person": "New Contact", "is_active": False,
    }, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["updated"] == 2
    assert client.get(f"/api/suppliers/{s1['id']}", headers=auth_headers).json()["is_active"] is False
    assert client.get(f"/api/suppliers/{s2['id']}", headers=auth_headers).json()["contact_person"] == "New Contact"


def test_bulk_edit_suppliers_duplicate_email(auth_headers):
    client.post("/api/suppliers", json={"name": "Sup Dup", "email": "dup@example.com"}, headers=auth_headers)
    s2 = client.post("/api/suppliers", json={"name": "Sup Other"}, headers=auth_headers).json()
    resp = client.patch("/api/suppliers/bulk-edit", json={"ids": [s2["id"]], "email": "dup@example.com"}, headers=auth_headers)
    assert resp.status_code == 400


def test_bulk_edit_suppliers_invalid_email(auth_headers):
    s = client.post("/api/suppliers", json={"name": "Sup Mail"}, headers=auth_headers).json()
    resp = client.patch("/api/suppliers/bulk-edit", json={"ids": [s["id"]], "email": "not-an-email"}, headers=auth_headers)
    assert resp.status_code == 422


# --- Customers -----------------------------------------------------------

def test_bulk_edit_customers(auth_headers):
    c1 = client.post("/api/customers", json={"name": "Cust 1", "customer_type": "walk-in"}, headers=auth_headers).json()
    c2 = client.post("/api/customers", json={"name": "Cust 2"}, headers=auth_headers).json()
    resp = client.patch("/api/customers/bulk-edit", json={
        "ids": [c1["id"], c2["id"]], "customer_type": "frequent", "is_active": False,
    }, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["updated"] == 2
    assert client.get(f"/api/customers/{c1['id']}", headers=auth_headers).json()["customer_type"] == "frequent"
    assert client.get(f"/api/customers/{c2['id']}", headers=auth_headers).json()["is_active"] is False


def test_bulk_edit_customers_invalid_type(auth_headers):
    c = client.post("/api/customers", json={"name": "Cust Bad"}, headers=auth_headers).json()
    resp = client.patch("/api/customers/bulk-edit", json={"ids": [c["id"]], "customer_type": "vip"}, headers=auth_headers)
    assert resp.status_code == 400


# --- Orders --------------------------------------------------------------

def test_bulk_edit_orders_cancel(auth_headers):
    o1 = _make_order(auth_headers, "ORD-B1")
    o2 = _make_order(auth_headers, "ORD-B2")
    resp = client.patch("/api/orders/bulk-edit", json={"ids": [o1["id"], o2["id"]], "status": "cancelled"}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["updated"] == 2
    assert client.get(f"/api/orders/{o1['id']}", headers=auth_headers).json()["status"] == "cancelled"
    assert client.get(f"/api/orders/{o2['id']}", headers=auth_headers).json()["status"] == "cancelled"


def test_bulk_edit_orders_rejects_received(auth_headers):
    o = _make_order(auth_headers, "ORD-B3")
    resp = client.patch("/api/orders/bulk-edit", json={"ids": [o["id"]], "status": "received"}, headers=auth_headers)
    assert resp.status_code == 400


def test_bulk_edit_orders_rejects_acknowledged_and_in_transit(auth_headers):
    o = _make_order(auth_headers, "ORD-B5")
    resp = client.patch("/api/orders/bulk-edit", json={"ids": [o["id"]], "status": "acknowledged"}, headers=auth_headers)
    assert resp.status_code == 400
    assert client.get(f"/api/orders/{o['id']}", headers=auth_headers).json()["status"] == "pending"
    resp = client.patch("/api/orders/bulk-edit", json={"ids": [o["id"]], "status": "in_transit"}, headers=auth_headers)
    assert resp.status_code == 400


def test_bulk_edit_orders_rejects_invalid_transition(auth_headers):
    o = _make_order(auth_headers, "ORD-B4")
    client.put(f"/api/orders/{o['id']}", json={"status": "cancelled"}, headers=auth_headers)
    resp = client.patch("/api/orders/bulk-edit", json={"ids": [o["id"]], "status": "pending"}, headers=auth_headers)
    assert resp.status_code == 400


# --- Sales ---------------------------------------------------------------

def test_bulk_edit_sales_notes(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, 
        "sku": "SALE-B1", "name": "S1", "unit_price": 10.0, "cost_price": 5.0, "quantity": 10,
    }, headers=auth_headers).json()
    s = client.post("/api/sales", json={
        "items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 10.0}],
    }, headers=auth_headers).json()
    resp = client.patch("/api/sales/bulk-edit", json={"ids": [s["id"]], "notes": "bulk note"}, headers=auth_headers)
    assert resp.status_code == 200
    assert client.get(f"/api/sales/{s['id']}", headers=auth_headers).json()["notes"] == "bulk note"


def test_bulk_edit_sales_cancel_restores_stock(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "SALE-BC", "name": "BC-Sale", "unit_price": 10.0, "cost_price": 5.0, "quantity": 10,
    }, headers=auth_headers).json()
    sale = client.post("/api/sales", json={
        "items": [{"product_id": prod["id"], "quantity": 4, "unit_price": 10.0}],
        "payment_method": "mobile_money",
        "payment_provider": "m-pesa",
        "payment_provider_amount": 40.0,
        "currency": "KES",
    }, headers=auth_headers).json()
    assert sale["status"] == "pending"
    assert client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()["quantity"] == 6

    resp = client.patch("/api/sales/bulk-edit", json={"ids": [sale["id"]], "status": "cancelled"}, headers=auth_headers)
    assert resp.status_code == 200
    updated = client.get(f"/api/sales/{sale['id']}", headers=auth_headers).json()
    assert updated["status"] == "cancelled"
    assert client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()["quantity"] == 10
    movements = client.get(f"/api/products/{prod['id']}/movements", headers=auth_headers).json()
    assert any(m["movement_type"] == "sale_return" and m["quantity_change"] == 4 for m in movements)


def test_bulk_edit_sales_cancel_rejects_completed(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "SALE-BD", "name": "BD-Sale", "unit_price": 10.0, "cost_price": 5.0, "quantity": 5,
    }, headers=auth_headers).json()
    sale = client.post("/api/sales", json={
        "items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 10.0}],
        "payment_method": "cash",
        "payment_status": "completed",
    }, headers=auth_headers).json()
    assert sale["status"] == "completed"
    resp = client.patch("/api/sales/bulk-edit", json={"ids": [sale["id"]], "status": "cancelled"}, headers=auth_headers)
    assert resp.status_code == 400


# --- Validation ----------------------------------------------------------

def test_bulk_edit_no_fields(auth_headers):
    c = client.post("/api/categories", json={"name": "NF"}, headers=auth_headers).json()
    assert client.patch("/api/categories/bulk-edit", json={"ids": [c["id"]]}, headers=auth_headers).status_code == 400
    s = client.post("/api/suppliers", json={"name": "NF S"}, headers=auth_headers).json()
    assert client.patch("/api/suppliers/bulk-edit", json={"ids": [s["id"]]}, headers=auth_headers).status_code == 400
    cu = client.post("/api/customers", json={"name": "NF C"}, headers=auth_headers).json()
    assert client.patch("/api/customers/bulk-edit", json={"ids": [cu["id"]]}, headers=auth_headers).status_code == 400
    o = _make_order(auth_headers, "NF-O")
    assert client.patch("/api/orders/bulk-edit", json={"ids": [o["id"]]}, headers=auth_headers).status_code == 400
    prod = client.post("/api/products", json={"location_id": 1, "sku": "NF-SALE", "name": "NS", "unit_price": 1.0, "quantity": 5}, headers=auth_headers).json()
    sale = client.post("/api/sales", json={"items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 1.0}]}, headers=auth_headers).json()
    assert client.patch("/api/sales/bulk-edit", json={"ids": [sale["id"]]}, headers=auth_headers).status_code == 400


def test_bulk_edit_missing_ids(auth_headers):
    resp = client.patch("/api/categories/bulk-edit", json={"ids": [99999], "description": "x"}, headers=auth_headers)
    assert resp.status_code == 404


# --- Permissions ---------------------------------------------------------

def test_workers_cannot_bulk_edit(auth_headers):
    worker = _worker(auth_headers, "bulkworker")
    c = client.post("/api/categories", json={"name": "W C"}, headers=auth_headers).json()
    assert client.patch("/api/categories/bulk-edit", json={"ids": [c["id"]], "description": "x"}, headers=worker).status_code == 403
    s = client.post("/api/suppliers", json={"name": "W S"}, headers=auth_headers).json()
    assert client.patch("/api/suppliers/bulk-edit", json={"ids": [s["id"]], "notes": "x"}, headers=worker).status_code == 403
    cu = client.post("/api/customers", json={"name": "W C2"}, headers=auth_headers).json()
    assert client.patch("/api/customers/bulk-edit", json={"ids": [cu["id"]], "notes": "x"}, headers=worker).status_code == 403
    o = _make_order(auth_headers, "W-O")
    assert client.patch("/api/orders/bulk-edit", json={"ids": [o["id"]], "notes": "x"}, headers=worker).status_code == 403
    prod = client.post("/api/products", json={"location_id": 1, "sku": "W-SALE", "name": "WS", "unit_price": 1.0, "quantity": 5}, headers=auth_headers).json()
    sale = client.post("/api/sales", json={"items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 1.0}]}, headers=auth_headers).json()
    assert client.patch("/api/sales/bulk-edit", json={"ids": [sale["id"]], "notes": "x"}, headers=worker).status_code == 403
