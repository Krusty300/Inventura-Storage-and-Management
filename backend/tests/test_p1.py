from tests.conftest import client


def _register(auth_headers, username, email, password="testpass123", role="worker"):
    client.post("/api/users", json={
        "username": username, "email": email, "password": password, "role": role,
    }, headers=auth_headers)
    token = client.post("/api/auth/login", json={"username": username, "password": password}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _make_product(auth_headers, sku="P1-PROD", quantity=10):
    return client.post("/api/products", json={"location_id": 1, 
        "sku": sku, "name": sku, "unit_price": 20.00, "cost_price": 10.00, "quantity": quantity,
    }, headers=auth_headers).json()


# --- Login rate limiting -------------------------------------------------

def test_login_locks_out_after_five_failures():
    for _ in range(5):
        resp = client.post("/api/auth/login", json={"username": "lockuser", "password": "wrongpass"})
        assert resp.status_code == 401
    resp = client.post("/api/auth/login", json={"username": "lockuser", "password": "correctpass"})
    assert resp.status_code == 429


def test_successful_login_resets_failure_counter():
    for _ in range(4):
        assert client.post("/api/auth/login", json={"username": "resetuser", "password": "wrongpass"}).status_code == 401
    client.post("/api/auth/register", json={"username": "resetuser", "email": "reset@example.com", "password": "resetpass1"})
    assert client.post("/api/auth/login", json={"username": "resetuser", "password": "resetpass1"}).status_code == 200
    for _ in range(5):
        assert client.post("/api/auth/login", json={"username": "resetuser", "password": "wrongpass"}).status_code == 401
    assert client.post("/api/auth/login", json={"username": "resetuser", "password": "resetpass1"}).status_code == 429


# --- Password policy -----------------------------------------------------

def test_register_rejects_short_password():
    resp = client.post("/api/auth/register", json={
        "username": "shortpw", "email": "short@example.com", "password": "short12",
    })
    assert resp.status_code == 400


def test_admin_create_user_rejects_short_password(auth_headers):
    resp = client.post("/api/users", json={
        "username": "newbie", "email": "newbie@example.com", "password": "tiny",
    }, headers=auth_headers)
    assert resp.status_code == 400


def test_reset_password_rejects_short_password(auth_headers):
    new = client.post("/api/users", json={
        "username": "resettarget", "email": "rt@example.com", "password": "goodpass1",
    }, headers=auth_headers).json()
    resp = client.post(f"/api/users/{new['id']}/reset-password", json={"new_password": "short"}, headers=auth_headers)
    assert resp.status_code == 400


def test_change_password_rejects_short_password(auth_headers):
    resp = client.put("/api/users/password/change", json={
        "current_password": "testpass123", "new_password": "short",
    }, headers=auth_headers)
    assert resp.status_code == 400


def test_register_rejects_password_over_72_bytes(auth_headers):
    resp = client.post("/api/auth/register", json={
        "username": "longpw", "email": "long@example.com", "password": "x" * 73,
    })
    assert resp.status_code == 400


# --- Admin user management ----------------------------------------------

def test_admin_creates_and_deletes_user(auth_headers):
    created = client.post("/api/users", json={
        "username": "disposable", "email": "discard@example.com", "password": "tempPass1",
    }, headers=auth_headers)
    assert created.status_code == 201
    uid = created.json()["id"]
    assert client.get(f"/api/users/{uid}", headers=auth_headers).json()["username"] == "disposable"
    assert client.delete(f"/api/users/{uid}", headers=auth_headers).status_code == 200
    assert client.get(f"/api/users/{uid}", headers=auth_headers).status_code == 404
    assert client.get("/api/users", headers=auth_headers).status_code == 200


def test_deleted_user_cannot_login(auth_headers):
    created = client.post("/api/users", json={
        "username": "gone", "email": "gone@example.com", "password": "deleteme1",
    }, headers=auth_headers).json()
    assert client.post("/api/auth/login", json={"username": "gone", "password": "deleteme1"}).status_code == 200
    client.delete(f"/api/users/{created['id']}", headers=auth_headers)
    assert client.post("/api/auth/login", json={"username": "gone", "password": "deleteme1"}).status_code == 401


def test_cannot_delete_own_account(auth_headers):
    res = client.get("/api/users", headers=auth_headers).json()
    me = next(u for u in res["items"] if u["username"] == "testuser")
    resp = client.delete(f"/api/users/{me['id']}", headers=auth_headers)
    assert resp.status_code == 400


def test_cannot_demote_last_admin(auth_headers):
    res = client.get("/api/users", headers=auth_headers).json()
    me = next(u for u in res["items"] if u["username"] == "testuser")
    resp = client.put(f"/api/users/{me['id']}", json={"role": "worker"}, headers=auth_headers)
    assert resp.status_code == 400


def test_cannot_change_own_role(auth_headers):
    res = client.get("/api/users", headers=auth_headers).json()
    me = next(u for u in res["items"] if u["username"] == "testuser")
    resp = client.put(f"/api/users/{me['id']}", json={"role": "worker"}, headers=auth_headers)
    assert resp.status_code == 400


def test_worker_cannot_create_users(auth_headers):
    worker = _register(auth_headers, "workerp1", "workerp1@example.com")
    resp = client.post("/api/users", json={
        "username": "nope", "email": "nope@example.com", "password": "nottoday1",
    }, headers=worker)
    assert resp.status_code == 403


# --- Admin-only refunds --------------------------------------------------

def test_worker_cannot_refund(auth_headers):
    prod = _make_product(auth_headers)
    sale = client.post("/api/sales", json={
        "items": [{"product_id": prod["id"], "quantity": 2, "unit_price": 20.00}],
    }, headers=auth_headers).json()
    worker = _register(auth_headers, "workerrefund", "workerrefund@example.com")
    resp = client.put(f"/api/sales/{sale['id']}/refund", headers=worker)
    assert resp.status_code == 403


def test_admin_can_refund(auth_headers):
    prod = _make_product(auth_headers)
    sale = client.post("/api/sales", json={
        "items": [{"product_id": prod["id"], "quantity": 2, "unit_price": 20.00}],
    }, headers=auth_headers).json()
    resp = client.put(f"/api/sales/{sale['id']}/refund", headers=auth_headers)
    assert resp.status_code == 200


# --- Reports date parsing -------------------------------------------------

def test_sales_summary_rejects_bad_dates(auth_headers):
    resp = client.get("/api/reports/sales-summary", params={"start_date": "not-a-date"}, headers=auth_headers)
    assert resp.status_code == 400
    resp = client.get("/api/reports/sales-summary", params={"end_date": "2026-13-99"}, headers=auth_headers)
    assert resp.status_code == 400


# --- Invoice / PO numbering ----------------------------------------------

def test_invoice_numbers_are_sequential(auth_headers):
    prod = _make_product(auth_headers, quantity=20)
    first = client.post("/api/sales", json={
        "items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 20.00}],
    }, headers=auth_headers).json()
    second = client.post("/api/sales", json={
        "items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 20.00}],
    }, headers=auth_headers).json()
    assert first["invoice_number"] == "INV-0001"
    assert second["invoice_number"] == "INV-0002"


def test_po_numbers_are_sequential(auth_headers):
    prod = _make_product(auth_headers)
    first = client.post("/api/orders", json={
        "items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 10.00}],
    }, headers=auth_headers).json()
    second = client.post("/api/orders", json={
        "items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 10.00}],
    }, headers=auth_headers).json()
    assert first["order_number"] == "PO-0001"
    assert second["order_number"] == "PO-0002"
