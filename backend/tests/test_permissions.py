from tests.conftest import client, create_test_user


def _register(auth_headers, username, email, password="testpass123"):
    client.post("/api/users", json={
        "username": username, "email": email, "password": password, "role": "worker",
    }, headers=auth_headers)
    token = client.post("/api/auth/login", json={"username": username, "password": password}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _register_custom(auth_headers, username, email, permissions, password="testpass123"):
    client.post("/api/users", json={
        "username": username, "email": email, "password": password, "role": "worker",
        "permissions": permissions,
    }, headers=auth_headers)
    token = client.post("/api/auth/login", json={"username": username, "password": password}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _make_product(headers, sku="PERM-PROD", quantity=10):
    return client.post("/api/products", json={"location_id": 1, 
        "sku": sku, "name": sku, "unit_price": 10.0, "cost_price": 5.0, "quantity": quantity,
    }, headers=headers).json()


# --- Workers are denied admin-only mutations -----------------------------

def test_worker_cannot_create_product(auth_headers):
    worker = _register(auth_headers, "w_noprod", "w_noprod@example.com")
    resp = client.post("/api/products", json={"location_id": 1, "sku": "P-X", "name": "X", "unit_price": 1.0}, headers=worker)
    assert resp.status_code == 403


def test_worker_cannot_update_or_delete_product(auth_headers):
    prod = _make_product(auth_headers)
    worker = _register(auth_headers, "w_noprod2", "w_noprod2@example.com")
    assert client.put(f"/api/products/{prod['id']}", json={"name": "Hacked"}, headers=worker).status_code == 403
    assert client.delete(f"/api/products/{prod['id']}", headers=worker).status_code == 403


def test_worker_cannot_bulk_edit_products(auth_headers):
    prod = _make_product(auth_headers)
    worker = _register(auth_headers, "w_bulk", "w_bulk@example.com")
    resp = client.patch("/api/products/bulk-edit", json={"ids": [prod["id"]], "reorder_level": 99}, headers=worker)
    assert resp.status_code == 403


def test_worker_cannot_manage_categories(auth_headers):
    worker = _register(auth_headers, "w_cat", "w_cat@example.com")
    assert client.post("/api/categories", json={"name": "Nope"}, headers=worker).status_code == 403


def test_worker_cannot_manage_customers(auth_headers):
    worker = _register(auth_headers, "w_cust", "w_cust@example.com")
    assert client.post("/api/customers", json={"name": "Nope"}, headers=worker).status_code == 403


def test_worker_cannot_manage_suppliers(auth_headers):
    worker = _register(auth_headers, "w_sup", "w_sup@example.com")
    assert client.post("/api/suppliers", json={"name": "Nope"}, headers=worker).status_code == 403


def test_worker_cannot_import_suppliers(auth_headers):
    worker = _register(auth_headers, "w_supimp", "w_supimp@example.com")
    resp = client.post("/api/suppliers/import", headers=worker, files={"file": ("s.csv", b"name\nX\n", "text/csv")})
    assert resp.status_code == 403


def test_worker_can_record_but_cannot_adjust_stock(auth_headers):
    prod = _make_product(auth_headers)
    worker = _register(auth_headers, "w_stock", "w_stock@example.com")
    assert client.post("/api/stock-movements", json={
        "product_id": prod["id"], "quantity_change": 5, "movement_type": "in",
    }, headers=worker).status_code == 201
    assert client.post("/api/stock-movements/adjust", json={
        "product_id": prod["id"], "new_quantity": 20,
    }, headers=worker).status_code == 403


def test_worker_cannot_update_settings(auth_headers):
    worker = _register(auth_headers, "w_settings", "w_settings@example.com")
    assert client.put("/api/settings", json={"store_name": "Hacked"}, headers=worker).status_code == 403


def test_worker_can_create_receipt_but_cannot_update_lot(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, 
        "sku": "PERM-RCP", "name": "Rcp", "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    receipt = client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 2, "lot_number": "PERM-LOT"}],
    }, headers=auth_headers)
    assert receipt.status_code == 201
    lot_id = client.get("/api/lots", headers=auth_headers).json()["items"][0]["id"]

    worker = _register(auth_headers, "w_rcp", "w_rcp@example.com")
    resp = client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 1}],
    }, headers=worker)
    assert resp.status_code == 201
    assert client.put(f"/api/lots/{lot_id}", json={"status": "quarantined"}, headers=worker).status_code == 403


def test_worker_cannot_delete_order(auth_headers):
    prod = _make_product(auth_headers)
    order = client.post("/api/orders", json={
        "items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 5.0}],
    }, headers=auth_headers).json()
    worker = _register(auth_headers, "w_orddel", "w_orddel@example.com")
    assert client.delete(f"/api/orders/{order['id']}", headers=worker).status_code == 403


def test_worker_cannot_manage_users(auth_headers):
    worker = _register(auth_headers, "w_users", "w_users@example.com")
    assert client.get("/api/users", headers=worker).status_code == 403
    assert client.post("/api/users", json={
        "username": "nope", "email": "nope@example.com", "password": "nottoday1",
    }, headers=worker).status_code == 403


# --- Workers retain their job permissions --------------------------------

def test_worker_can_view_products_and_reports(auth_headers):
    worker = _register(auth_headers, "w_view", "w_view@example.com")
    assert client.get("/api/products", headers=worker).status_code == 200
    assert client.get("/api/reports/inventory-valuation", headers=worker).status_code == 200
    assert client.get("/api/dashboard/stats", headers=worker).status_code == 200
    assert client.get("/api/stock-movements", headers=worker).status_code == 200


def test_worker_can_create_sale(auth_headers):
    prod = _make_product(auth_headers)
    worker = _register(auth_headers, "w_sale", "w_sale@example.com")
    resp = client.post("/api/sales", json={
        "items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 10.0}],
    }, headers=worker)
    assert resp.status_code == 201


def test_worker_can_view_receipts_lots_and_serials(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, 
        "sku": "PERM-VIEW", "name": "View", "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 2, "lot_number": "VIEW-LOT"}],
    }, headers=auth_headers).status_code == 201

    worker = _register(auth_headers, "w_rview", "w_rview@example.com")
    assert client.get("/api/receipts", headers=worker).status_code == 200
    assert client.get("/api/lots", headers=worker).status_code == 200
    assert client.get("/api/serial-numbers", headers=worker).status_code == 200


def test_worker_can_create_and_update_order(auth_headers):
    prod = _make_product(auth_headers)
    worker = _register(auth_headers, "w_order", "w_order@example.com")
    order = client.post("/api/orders", json={
        "items": [{"product_id": prod["id"], "quantity": 2, "unit_price": 5.0}],
    }, headers=worker)
    assert order.status_code == 201
    resp = client.put(f"/api/orders/{order.json()['id']}", json={"status": "received"}, headers=worker)
    assert resp.status_code == 200


def test_worker_cannot_refund(auth_headers):
    prod = _make_product(auth_headers)
    sale = client.post("/api/sales", json={
        "items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 10.0}],
    }, headers=auth_headers).json()
    worker = _register(auth_headers, "w_refund", "w_refund@example.com")
    assert client.put(f"/api/sales/{sale['id']}/refund", headers=worker).status_code == 403


# --- Admins retain everything --------------------------------------------

def test_admin_can_manage_products_and_settings(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, "sku": "PERM-A1", "name": "A1", "unit_price": 1.0}, headers=auth_headers)
    assert prod.status_code == 201
    assert client.put("/api/settings", json={"store_name": "Updated"}, headers=auth_headers).status_code == 200
    assert client.get("/api/users", headers=auth_headers).status_code == 200


# --- Unknown roles are denied --------------------------------------------

def test_unknown_role_has_no_permissions():
    create_test_user("ghost", "ghost@example.com", "testpass123", "superuser")
    token = client.post("/api/auth/login", json={"username": "ghost", "password": "testpass123"}).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/products", headers=headers).status_code == 403
    assert client.post("/api/products", json={"location_id": 1, "sku": "GHOST-1", "name": "G", "unit_price": 1.0}, headers=headers).status_code == 403


# --- Per-user permission overrides ---------------------------------------

def test_custom_worker_permissions_replace_role_defaults(auth_headers):
    worker = _register_custom(auth_headers, "w_custom", "w_custom@example.com", ["products.view", "products.create"])
    resp = client.post("/api/products", json={"location_id": 1, "sku": "CUSTOM-1", "name": "C", "unit_price": 1.0}, headers=worker)
    assert resp.status_code == 201
    # Granting a custom allowlist drops the default worker permissions not listed
    assert client.get("/api/dashboard/stats", headers=worker).status_code == 403
    assert client.post("/api/sales", json={"items": [{"product_id": resp.json()["id"], "quantity": 1, "unit_price": 10.0}]}, headers=worker).status_code == 403


def test_worker_with_empty_permissions_falls_back_to_defaults(auth_headers):
    worker = _register_custom(auth_headers, "w_defaults", "w_defaults@example.com", [])
    assert client.get("/api/products", headers=worker).status_code == 200


def test_admin_can_restrict_worker_access_and_reset(auth_headers):
    created = client.post("/api/users", json={
        "username": "w_restrict", "email": "w_restrict@example.com", "password": "testpass123", "role": "worker",
    }, headers=auth_headers)
    assert created.status_code == 201
    uid = created.json()["id"]
    restricted = client.put(f"/api/users/{uid}", json={
        "permissions": ["dashboard.view", "locations.view"],
    }, headers=auth_headers)
    assert restricted.status_code == 200
    assert restricted.json()["permissions"] == ["dashboard.view", "locations.view"]

    token = client.post("/api/auth/login", json={"username": "w_restrict", "password": "testpass123"}).json()["access_token"]
    worker = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/products", headers=worker).status_code == 403
    assert client.get("/api/locations", headers=worker).status_code == 200

    reset = client.put(f"/api/users/{uid}", json={"permissions": []}, headers=auth_headers)
    assert reset.status_code == 200
    assert reset.json()["permissions"] is None
    assert client.get("/api/products", headers=worker).status_code == 200


def test_admin_cannot_set_unknown_permission(auth_headers):
    created = client.post("/api/users", json={
        "username": "w_badperm", "email": "w_badperm@example.com", "password": "testpass123", "role": "worker",
    }, headers=auth_headers)
    uid = created.json()["id"]
    resp = client.put(f"/api/users/{uid}", json={"permissions": ["nonsense.none"]}, headers=auth_headers)
    assert resp.status_code == 400


# --- Manager role ----------------------------------------------------------

def _register_manager(auth_headers, username, email, password="testpass123"):
    client.post("/api/users", json={
        "username": username, "email": email, "password": password, "role": "manager",
    }, headers=auth_headers)
    token = client.post("/api/auth/login", json={"username": username, "password": password}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_manager_can_view_products_and_reports(auth_headers):
    mgr = _register_manager(auth_headers, "mgr_view", "mgr_view@example.com")
    assert client.get("/api/products", headers=mgr).status_code == 200
    assert client.get("/api/reports/inventory-valuation", headers=mgr).status_code == 200
    assert client.get("/api/dashboard/stats", headers=mgr).status_code == 200


def test_manager_can_update_settings(auth_headers):
    mgr = _register_manager(auth_headers, "mgr_settings", "mgr_settings@example.com")
    assert client.put("/api/settings", json={"store_name": "Mgr Updated"}, headers=mgr).status_code == 200


def test_manager_can_create_sale(auth_headers):
    prod = _make_product(auth_headers, sku="MGR-SALE")
    mgr = _register_manager(auth_headers, "mgr_sale", "mgr_sale@example.com")
    resp = client.post("/api/sales", json={
        "items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 10.0}],
    }, headers=mgr)
    assert resp.status_code == 201


def test_manager_can_refund_sale(auth_headers):
    prod = _make_product(auth_headers, sku="MGR-REFUND")
    sale = client.post("/api/sales", json={
        "items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 10.0}],
    }, headers=auth_headers).json()
    mgr = _register_manager(auth_headers, "mgr_refund", "mgr_refund@example.com")
    assert client.put(f"/api/sales/{sale['id']}/refund", headers=mgr).status_code == 200


def test_manager_can_manage_users(auth_headers):
    mgr = _register_manager(auth_headers, "mgr_users", "mgr_users@example.com")
    assert client.get("/api/users", headers=mgr).status_code == 200
    created = client.post("/api/users", json={
        "username": "mgr_created", "email": "mgr_created@example.com", "password": "testpass123", "role": "worker",
    }, headers=mgr)
    assert created.status_code == 201


def test_manager_can_approve_and_reject_users(auth_headers):
    user = create_test_user("mgr_approvee", "mgr_ap@example.com", "pass123", "worker", approved=False)
    mgr = _register_manager(auth_headers, "mgr_approve", "mgr_approve@example.com")
    resp = client.post(f"/api/users/{user.id}/approve", json={"role": "worker"}, headers=mgr)
    assert resp.status_code == 200
    assert resp.json()["is_approved"] is True

    user2 = create_test_user("mgr_rejectee", "mgr_rj@example.com", "pass123", "worker", approved=False)
    resp = client.post(f"/api/users/{user2.id}/reject", headers=mgr)
    assert resp.status_code == 200
    assert resp.json()["is_active"] is False


def test_manager_cannot_delete_users(auth_headers):
    resp = client.post("/api/users", json={
        "username": "mgr_deltarget", "email": "mgr_del@example.com", "password": "testpass123", "role": "worker",
    }, headers=auth_headers)
    worker_id = resp.json()["id"]
    mgr = _register_manager(auth_headers, "mgr_del", "mgr_del2@example.com")
    assert client.delete(f"/api/users/{worker_id}", headers=mgr).status_code == 403


def test_manager_cannot_assign_admin_role_on_create(auth_headers):
    mgr = _register_manager(auth_headers, "mgr_nocreateadmin", "mgr_nocreateadmin@example.com")
    resp = client.post("/api/users", json={
        "username": "forced_admin", "email": "forced_admin@example.com", "password": "testpass123", "role": "admin",
    }, headers=mgr)
    assert resp.status_code == 403


def test_manager_cannot_assign_admin_role_on_update(auth_headers):
    worker = client.post("/api/users", json={
        "username": "mgr_updtarget", "email": "mgr_upd@example.com", "password": "testpass123", "role": "worker",
    }, headers=auth_headers).json()
    mgr = _register_manager(auth_headers, "mgr_upd", "mgr_upd2@example.com")
    resp = client.put(f"/api/users/{worker['id']}", json={"role": "admin"}, headers=mgr)
    assert resp.status_code == 403


def test_manager_cannot_assign_admin_role_on_approve(auth_headers):
    user = create_test_user("mgr_apadmin", "mgr_apadm@example.com", "pass123", "worker", approved=False)
    mgr = _register_manager(auth_headers, "mgr_apadm", "mgr_apadm2@example.com")
    resp = client.post(f"/api/users/{user.id}/approve", json={"role": "admin"}, headers=mgr)
    assert resp.status_code == 403


def test_manager_can_create_manager_user(auth_headers):
    mgr = _register_manager(auth_headers, "mgr_createmgr", "mgr_createmgr@example.com")
    resp = client.post("/api/users", json={
        "username": "mgr_created_mgr", "email": "mgr_created_mgr@example.com", "password": "testpass123", "role": "manager",
    }, headers=mgr)
    assert resp.status_code == 201


def test_manager_can_update_user_to_manager_role(auth_headers):
    worker = client.post("/api/users", json={
        "username": "mgr_promote", "email": "mgr_promote@example.com", "password": "testpass123", "role": "worker",
    }, headers=auth_headers).json()
    mgr = _register_manager(auth_headers, "mgr_promoter", "mgr_promoter@example.com")
    resp = client.put(f"/api/users/{worker['id']}", json={"role": "manager"}, headers=mgr)
    assert resp.status_code == 200
