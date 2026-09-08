from tests.conftest import client, create_test_user


def test_register_first_user_auto_approved():
    resp = client.post("/api/auth/register", json={
        "username": "newuser",
        "email": "new@example.com",
        "password": "password123",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert data["user"]["username"] == "newuser"
    assert data["user"]["role"] == "admin"
    assert data["user"]["is_approved"] is True


def test_register_second_user_pending():
    client.post("/api/auth/register", json={
        "username": "firstuser",
        "email": "first@example.com",
        "password": "password123",
    })
    resp = client.post("/api/auth/register", json={
        "username": "seconduser",
        "email": "second@example.com",
        "password": "password123",
        "role": "worker",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["message"] == "Registration successful. Your account is pending admin approval."
    assert data["user"]["is_approved"] is False


def test_pending_user_cannot_login():
    client.post("/api/auth/register", json={
        "username": "firstuser2",
        "email": "first2@example.com",
        "password": "password123",
    })
    client.post("/api/auth/register", json={
        "username": "pendinguser",
        "email": "pending@example.com",
        "password": "password123",
    })
    resp = client.post("/api/auth/login", json={
        "username": "pendinguser",
        "password": "password123",
    })
    assert resp.status_code == 403
    assert "pending" in resp.json()["detail"].lower()


def test_login_records_last_login_at():
    create_test_user("lluser", "ll@example.com", "password123")
    resp = client.post("/api/auth/login", json={
        "username": "lluser",
        "password": "password123",
    })
    assert resp.status_code == 200
    assert resp.json()["user"]["last_login_at"] is not None


def test_register_duplicate_username():
    create_test_user("dupuser", "dup1@example.com", "password123")
    resp = client.post("/api/auth/register", json={
        "username": "dupuser",
        "email": "dup2@example.com",
        "password": "password123",
    })
    assert resp.status_code == 400


def test_login():
    create_test_user("loginuser", "login@example.com", "password123")
    resp = client.post("/api/auth/login", json={
        "username": "loginuser",
        "password": "password123",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert data["user"]["username"] == "loginuser"


def test_login_invalid():
    resp = client.post("/api/auth/login", json={
        "username": "nobody",
        "password": "wrong",
    })
    assert resp.status_code == 401


def test_login_remember_token_lasts_longer():
    from jose import jwt
    from app.config import settings
    create_test_user("remuser", "rem@example.com", "password123")
    normal = client.post("/api/auth/login", json={"username": "remuser", "password": "password123"}).json()
    remembered = client.post("/api/auth/login", json={"username": "remuser", "password": "password123", "remember": True}).json()
    exp_normal = jwt.decode(normal["access_token"], settings.secret_key, algorithms=[settings.algorithm])["exp"]
    exp_remembered = jwt.decode(remembered["access_token"], settings.secret_key, algorithms=[settings.algorithm])["exp"]
    assert exp_remembered > exp_normal
    assert exp_remembered - exp_normal >= (settings.remember_token_expire_minutes - settings.access_token_expire_minutes) * 60 - 10


def test_me(auth_headers):
    resp = client.get("/api/auth/me", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["username"] == "testuser"


def test_me_unauthorized():
    resp = client.get("/api/auth/me")
    assert resp.status_code in (401, 403)


def test_approve_user():
    from tests.conftest import create_test_user
    user = create_test_user("approvee", "approve@example.com", "pass123", "worker", approved=False)
    admin_user = create_test_user("admin_approve", "admin_a@example.com", "adminpass", "admin")
    resp = client.post("/api/auth/login", json={"username": "admin_approve", "password": "adminpass"})
    admin_headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

    resp = client.post(f"/api/users/{user.id}/approve", json={"role": "admin"}, headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json()["is_approved"] is True
    assert resp.json()["role"] == "admin"

    resp = client.post("/api/auth/login", json={"username": "approvee", "password": "pass123"})
    assert resp.status_code == 200


def test_reject_user():
    from tests.conftest import create_test_user
    user = create_test_user("rejectee", "reject@example.com", "pass123", "worker", approved=False)
    admin_user = create_test_user("admin_reject", "admin_r@example.com", "adminpass", "admin")
    resp = client.post("/api/auth/login", json={"username": "admin_reject", "password": "adminpass"})
    admin_headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

    resp = client.post(f"/api/users/{user.id}/reject", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json()["is_active"] is False


def test_pending_list():
    from tests.conftest import create_test_user
    create_test_user("pending1", "p1@example.com", "pass123", "worker", approved=False)
    create_test_user("pending2", "p2@example.com", "pass123", "worker", approved=False)
    admin_user = create_test_user("admin_list", "admin_l@example.com", "adminpass", "admin")
    resp = client.post("/api/auth/login", json={"username": "admin_list", "password": "adminpass"})
    admin_headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

    resp = client.get("/api/users/pending", headers=admin_headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 2


def test_rejected_user_can_rereregister():
    user = create_test_user("rejected1", "rejected1@example.com", "pass123", "worker", approved=False)
    admin_user = create_test_user("admin_rr", "admin_rr@example.com", "adminpass", "admin")
    resp = client.post("/api/auth/login", json={"username": "admin_rr", "password": "adminpass"})
    admin_headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

    # Admin rejects the pending registration -> account is deactivated & unapproved.
    resp = client.post(f"/api/users/{user.id}/reject", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json()["is_active"] is False

    # The same identity can now register again; the account is reclaimed and
    # reappears as a new pending registration (role/email updated).
    resp = client.post("/api/auth/register", json={
        "username": "rejected1",
        "email": "rejected1@example.com",
        "password": "newpass456",
        "role": "manager",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["user"]["is_active"] is True
    assert data["user"]["is_approved"] is False
    assert data["user"]["role"] == "manager"
    assert "pending" in data["message"].lower()

    # And it shows up in the pending list again for review.
    resp = client.get("/api/users/pending", headers=admin_headers)
    assert resp.status_code == 200
    assert any(u["username"] == "rejected1" and u["role"] == "manager" for u in resp.json())

