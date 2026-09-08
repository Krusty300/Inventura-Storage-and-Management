from tests.conftest import client


def _register(auth_headers, username, email, password="testpass123"):
    client.post("/api/users", json={
        "username": username, "email": email, "password": password, "role": "worker",
    }, headers=auth_headers)
    token = client.post("/api/auth/login", json={"username": username, "password": password}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_list_users_includes_registered(auth_headers):
    res = client.get("/api/users", headers=auth_headers)
    assert res.status_code == 200
    assert any(u["username"] == "testuser" for u in res.json()["items"])


def test_list_users_paginated_and_sorted(auth_headers):
    for i in range(3):
        client.post("/api/users", json={
            "username": f"bulk{i}", "email": f"bulk{i}@example.com", "password": "testpass123", "role": "worker",
        }, headers=auth_headers)
    res = client.get("/api/users?page=1&page_size=2", headers=auth_headers).json()
    assert res["total"] == 4
    assert res["pages"] == 2
    assert len(res["items"]) == 2
    sorted_res = client.get("/api/users?sort_by=username&sort_dir=desc", headers=auth_headers).json()["items"]
    names = [u["username"] for u in sorted_res]
    assert names == sorted(names, reverse=True)
    invalid = client.get("/api/users?sort_by=password_hash", headers=auth_headers).json()["items"]
    assert all("password_hash" not in u for u in invalid)


def test_get_user(auth_headers):
    res = client.get("/api/users", headers=auth_headers).json()
    uid = res["items"][0]["id"]
    resp = client.get(f"/api/users/{uid}", headers=auth_headers)
    assert resp.status_code == 200
    assert client.get("/api/users/999999", headers=auth_headers).status_code == 404


def test_worker_cannot_list_users(auth_headers):
    worker = _register(auth_headers, "worker2", "worker2@example.com")
    assert client.get("/api/users", headers=worker).status_code == 403


def test_admin_updates_user(auth_headers):
    res = client.get("/api/users", headers=auth_headers).json()
    uid = res["items"][0]["id"]
    resp = client.put(f"/api/users/{uid}", json={"email": "new@example.com"}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["email"] == "new@example.com"


def test_change_password(auth_headers):
    resp = client.put("/api/users/password/change", json={
        "current_password": "testpass123", "new_password": "newpass456",
    }, headers=auth_headers)
    assert resp.status_code == 200
    # All sessions are revoked, so the old token no longer works
    assert client.get("/api/auth/me", headers=auth_headers).status_code == 401
    # Log in with the new password
    fresh_token = client.post("/api/auth/login", json={"username": "testuser", "password": "newpass456"}).json()["access_token"]
    fresh = {"Authorization": f"Bearer {fresh_token}"}
    # Wrong current password is still rejected
    resp = client.put("/api/users/password/change", json={
        "current_password": "wrong", "new_password": "other789",
    }, headers=fresh)
    assert resp.status_code == 400
    login = client.post("/api/auth/login", json={"username": "testuser", "password": "newpass456"})
    assert login.status_code == 200


def test_change_password_revokes_all_sessions(auth_headers):
    # testuser is logged in on this device (auth_headers) plus a second device
    other_token = client.post("/api/auth/login", json={"username": "testuser", "password": "testpass123"}).json()["access_token"]
    other_headers = {"Authorization": f"Bearer {other_token}"}
    assert client.get("/api/auth/me", headers=auth_headers).status_code == 200
    assert client.get("/api/auth/me", headers=other_headers).status_code == 200

    resp = client.put("/api/users/password/change", json={
        "current_password": "testpass123", "new_password": "newpass456",
    }, headers=auth_headers)
    assert resp.status_code == 200

    # Both this device and the other device are signed out
    assert client.get("/api/auth/me", headers=auth_headers).status_code == 401
    assert client.get("/api/auth/me", headers=other_headers).status_code == 401

    # After logging back in, the old sessions are shown as revoked
    fresh = client.post("/api/auth/login", json={"username": "testuser", "password": "newpass456"}).json()["access_token"]
    sessions = client.get("/api/auth/sessions", headers={"Authorization": f"Bearer {fresh}"}).json()
    active = [s for s in sessions if s["revoked_at"] is None]
    assert len(active) == 1
    assert all(s["revoked_at"] is not None for s in sessions if not s["is_current"])


def test_reset_password_revokes_user_sessions(auth_headers):
    created = client.post("/api/users", json={
        "username": "revoketarget", "email": "rt@example.com", "password": "testpass123", "role": "worker",
    }, headers=auth_headers).json()
    target_token = client.post("/api/auth/login", json={"username": "revoketarget", "password": "testpass123"}).json()["access_token"]
    target_headers = {"Authorization": f"Bearer {target_token}"}
    assert client.get("/api/auth/me", headers=target_headers).status_code == 200

    resp = client.post(f"/api/users/{created['id']}/reset-password", json={"new_password": "resetpass123"}, headers=auth_headers)
    assert resp.status_code == 200

    # The target user's existing sessions are invalidated, but the admin's own session still works
    assert client.get("/api/auth/me", headers=target_headers).status_code == 401
    assert client.get("/api/auth/me", headers=auth_headers).status_code == 200
    # Old password no longer works, the new one does
    assert client.post("/api/auth/login", json={"username": "revoketarget", "password": "testpass123"}).status_code == 401
    assert client.post("/api/auth/login", json={"username": "revoketarget", "password": "resetpass123"}).status_code == 200


def test_update_own_profile(auth_headers):
    me = client.get("/api/auth/me", headers=auth_headers)
    assert me.status_code == 200
    uid = me.json()["id"]

    resp = client.put("/api/auth/me", json={"email": "ownprofile@example.com"}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["email"] == "ownprofile@example.com"

    resp = client.put("/api/auth/me", json={"username": "ownprofile"}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["username"] == "ownprofile"

    # conflict with another user is rejected
    other = client.post("/api/users", json={
        "username": "conflictuser", "email": "conflict@example.com", "password": "testpass123", "role": "worker",
    }, headers=auth_headers)
    assert other.status_code == 201
    assert client.put("/api/auth/me", json={"email": "conflict@example.com"}, headers=auth_headers).status_code == 400
    assert client.put("/api/auth/me", json={"username": "conflictuser"}, headers=auth_headers).status_code == 400

    # empty update rejected
    assert client.put("/api/auth/me", json={}, headers=auth_headers).status_code == 400
    assert client.put("/api/auth/me", json={"username": "  "}, headers=auth_headers).status_code == 400

    # still works after rename (token survives, based on id)
    token = client.post("/api/auth/login", json={"username": "ownprofile", "password": "testpass123"}).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/auth/me", headers=headers).json()["id"] == uid


def test_admin_actions_logged_to_activity(auth_headers):
    created = client.post("/api/users", json={
        "username": "managed", "email": "managed@example.com", "password": "testpass123", "role": "worker",
    }, headers=auth_headers)
    assert created.status_code == 201
    uid = created.json()["id"]

    assert client.put(f"/api/users/{uid}", json={"email": "managed2@example.com"}, headers=auth_headers).status_code == 200
    assert client.post(f"/api/users/{uid}/reset-password", json={"new_password": "resetpass123"}, headers=auth_headers).status_code == 200
    assert client.delete(f"/api/users/{uid}", headers=auth_headers).status_code == 200

    logs = client.get("/api/activity-logs?entity_type=user", headers=auth_headers).json()["items"]
    actions = [(l["action"], l["entity_type"]) for l in logs]
    assert ("create", "user") in actions
    assert ("update", "user") in actions
    assert ("reset_password", "user") in actions
    assert ("delete", "user") in actions
    assert any("managed" in l["description"] for l in logs)


def test_deactivated_user_can_be_reactivated(auth_headers):
    created = client.post("/api/users", json={
        "username": "revive", "email": "revive@example.com", "password": "testpass123", "role": "worker",
    }, headers=auth_headers)
    assert created.status_code == 201
    uid = created.json()["id"]

    # Deactivate via delete -> leaves the active list, moves to Trash
    assert client.delete(f"/api/users/{uid}", headers=auth_headers).status_code == 200
    active_ids = [u["id"] for u in client.get("/api/users", headers=auth_headers).json()["items"]]
    assert uid not in active_ids

    # Soft-deleted (trashed) users no longer appear with include_inactive.
    incl = client.get("/api/users?include_inactive=true", headers=auth_headers).json()["items"]
    assert all(u["id"] != uid for u in incl)
    trash = client.get("/api/trash", headers=auth_headers).json()
    assert any(i["entity_type"] == "user" and i["id"] == uid for i in trash["items"])

    # Restore through the Trash endpoint -> back in the active list and can sign in
    assert client.post(f"/api/trash/user/{uid}/restore", headers=auth_headers).status_code == 200
    resp = client.get(f"/api/users/{uid}", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["is_active"] is True
    active_ids = [u["id"] for u in client.get("/api/users", headers=auth_headers).json()["items"]]
    assert uid in active_ids
    assert client.post("/api/auth/login", json={"username": "revive", "password": "testpass123"}).status_code == 200


def test_update_can_deactivate_but_not_self_or_last_admin(auth_headers):
    me = client.get("/api/auth/me", headers=auth_headers).json()
    # Cannot deactivate your own account via update
    assert client.put(f"/api/users/{me['id']}", json={"is_active": False}, headers=auth_headers).status_code == 400

    created = client.post("/api/users", json={
        "username": "vanish", "email": "vanish@example.com", "password": "testpass123", "role": "worker",
    }, headers=auth_headers).json()
    resp = client.put(f"/api/users/{created['id']}", json={"is_active": False}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["is_active"] is False
    # Deactivated user can no longer log in
    assert client.post("/api/auth/login", json={"username": "vanish", "password": "testpass123"}).status_code == 401
