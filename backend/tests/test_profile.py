from tests.conftest import client

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\x00\x00\x00\x00\x00"
JPG = b"\xff\xd8\xff\xe0" + b"\x00" * 16


def _login(username, password="testpass123"):
    resp = client.post("/api/auth/login", json={"username": username, "password": password})
    assert resp.status_code == 200
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def test_avatar_upload_and_remove(auth_headers):
    resp = client.post("/api/auth/me/avatar", files={"file": ("avatar.png", PNG, "image/png")}, headers=auth_headers)
    assert resp.status_code == 200
    avatar_url = resp.json()["avatar_url"]
    assert avatar_url.startswith("/uploads/avatar_")

    me = client.get("/api/auth/me", headers=auth_headers).json()
    assert me["avatar_url"] == avatar_url

    removed = client.delete("/api/auth/me/avatar", headers=auth_headers)
    assert removed.status_code == 200
    assert removed.json()["avatar_url"] == ""


def test_avatar_accepts_jpg(auth_headers):
    resp = client.post("/api/auth/me/avatar", files={"file": ("avatar.jpg", JPG, "image/jpeg")}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["avatar_url"].endswith(".jpg")

    resp = client.post("/api/auth/me/avatar", files={"file": ("photo.jpeg", JPG, "image/jpeg")}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["avatar_url"].endswith(".jpg")


def test_avatar_rejects_renamed_non_jpg(auth_headers):
    resp = client.post("/api/auth/me/avatar", files={"file": ("fake.jpg", PNG, "image/jpeg")}, headers=auth_headers)
    assert resp.status_code == 400


def test_avatar_rejects_non_image(auth_headers):
    resp = client.post("/api/auth/me/avatar", files={"file": ("evil.png", b"not an image", "image/png")}, headers=auth_headers)
    assert resp.status_code == 400
    resp = client.post("/api/auth/me/avatar", files={"file": ("evil.txt", b"hello", "text/plain")}, headers=auth_headers)
    assert resp.status_code == 400


def test_sessions_listed_and_current(auth_headers):
    token1 = _login("testuser")
    sessions = client.get("/api/auth/sessions", headers=token1).json()
    assert len(sessions) >= 2
    assert sum(1 for s in sessions if s["is_current"]) == 1
    current = next(s for s in sessions if s["is_current"])
    assert current["ip_address"] != ""


def test_revoke_all_other_sessions(auth_headers):
    token1 = _login("testuser")
    token2 = _login("testuser")
    resp = client.delete("/api/auth/sessions", headers=token1)
    assert resp.status_code == 200
    assert resp.json()["revoked"] >= 1

    assert client.get("/api/auth/me", headers=token2).status_code == 401
    assert client.get("/api/auth/me", headers=token1).status_code == 200


def test_revoke_single_session(auth_headers):
    token1 = _login("testuser")
    token2 = _login("testuser")
    sessions = client.get("/api/auth/sessions", headers=token1).json()
    target = next(s for s in sessions if not s["is_current"])

    resp = client.delete(f"/api/auth/sessions/{target['id']}", headers=token1)
    assert resp.status_code == 200
    assert client.get("/api/auth/me", headers=token2).status_code == 401
    assert client.get("/api/auth/me", headers=token1).status_code == 200


def test_cannot_revoke_current_session(auth_headers):
    sessions = client.get("/api/auth/sessions", headers=auth_headers).json()
    current = next(s for s in sessions if s["is_current"])
    resp = client.delete(f"/api/auth/sessions/{current['id']}", headers=auth_headers)
    assert resp.status_code == 400


def test_logout_revokes_token(auth_headers):
    token = _login("testuser")
    assert client.post("/api/auth/logout", headers=token).status_code == 200
    assert client.get("/api/auth/me", headers=token).status_code == 401
    assert client.get("/api/auth/me", headers=auth_headers).status_code == 200


def test_export_my_data(auth_headers):
    resp = client.get("/api/auth/me/export", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["profile"]["username"] == "testuser"
    for key in ("activity_logs", "notifications", "orders", "sales", "receipts",
                "stock_movements", "shipments", "quality_checks", "asns",
                "cycle_counts", "work_orders"):
        assert key in data
