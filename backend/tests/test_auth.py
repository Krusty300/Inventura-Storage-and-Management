from tests.conftest import client


def test_register():
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


def test_register_disabled_after_first_user():
    client.post("/api/auth/register", json={
        "username": "firstuser",
        "email": "first@example.com",
        "password": "password123",
    })
    resp = client.post("/api/auth/register", json={
        "username": "seconduser",
        "email": "second@example.com",
        "password": "password123",
    })
    assert resp.status_code == 403
    assert "disabled" in resp.json()["detail"].lower()


def test_login_records_last_login_at():
    client.post("/api/auth/register", json={
        "username": "lluser",
        "email": "ll@example.com",
        "password": "password123",
    })
    resp = client.post("/api/auth/login", json={
        "username": "lluser",
        "password": "password123",
    })
    assert resp.status_code == 200
    assert resp.json()["user"]["last_login_at"] is not None


def test_register_duplicate_username():
    client.post("/api/auth/register", json={
        "username": "dupuser",
        "email": "dup1@example.com",
        "password": "password123",
    })
    resp = client.post("/api/auth/register", json={
        "username": "dupuser",
        "email": "dup2@example.com",
        "password": "password123",
    })
    assert resp.status_code == 400


def test_login():
    client.post("/api/auth/register", json={
        "username": "loginuser",
        "email": "login@example.com",
        "password": "password123",
    })
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
    client.post("/api/auth/register", json={
        "username": "remuser",
        "email": "rem@example.com",
        "password": "password123",
    })
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
