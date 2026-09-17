# --- Notes CRUD ---


class TestNotesCRUD:
    def test_create_note(self, test_client, auth_headers):
        resp = test_client.post("/api/notes", json={"title": "Test note", "body": "body text"}, headers=auth_headers)
        assert resp.status_code == 201
        data = resp.json()
        assert data["title"] == "Test note"
        assert data["body"] == "body text"
        assert data["category"] == "note"
        assert data["priority"] == "normal"
        assert data["is_pinned"] is False
        assert data["is_completed"] is False

    def test_create_note_with_defaults(self, test_client, auth_headers):
        resp = test_client.post("/api/notes", json={"title": "Minimal"}, headers=auth_headers)
        assert resp.status_code == 201
        data = resp.json()
        assert data["category"] == "note"
        assert data["priority"] == "normal"
        assert data["recurrence"] == "none"
        assert data["tags"] == []
        assert data["links"] == []

    def test_create_reminder(self, test_client, auth_headers):
        resp = test_client.post("/api/notes", json={"title": "Reminder", "category": "reminder"}, headers=auth_headers)
        assert resp.status_code == 201
        assert resp.json()["category"] == "reminder"

    def test_create_todo(self, test_client, auth_headers):
        resp = test_client.post("/api/notes", json={"title": "Todo item", "category": "todo"}, headers=auth_headers)
        assert resp.status_code == 201
        assert resp.json()["category"] == "todo"

    def test_create_note_invalid_category(self, test_client, auth_headers):
        resp = test_client.post("/api/notes", json={"title": "Bad", "category": "invalid"}, headers=auth_headers)
        assert resp.status_code == 400

    def test_create_note_invalid_priority(self, test_client, auth_headers):
        resp = test_client.post("/api/notes", json={"title": "Bad", "priority": "mega"}, headers=auth_headers)
        assert resp.status_code == 400

    def test_create_note_invalid_recurrence(self, test_client, auth_headers):
        resp = test_client.post("/api/notes", json={"title": "Bad", "recurrence": "hourly"}, headers=auth_headers)
        assert resp.status_code == 400

    def test_create_note_requires_title(self, test_client, auth_headers):
        resp = test_client.post("/api/notes", json={"body": "no title"}, headers=auth_headers)
        assert resp.status_code in (400, 422)

    def test_list_notes(self, test_client, auth_headers):
        test_client.post("/api/notes", json={"title": "Note A"}, headers=auth_headers)
        test_client.post("/api/notes", json={"title": "Note B"}, headers=auth_headers)
        resp = test_client.get("/api/notes", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2
        assert len(data["items"]) == 2

    def test_get_note(self, test_client, auth_headers):
        create = test_client.post("/api/notes", json={"title": "Fetch me"}, headers=auth_headers)
        note_id = create.json()["id"]
        resp = test_client.get(f"/api/notes/{note_id}", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["title"] == "Fetch me"

    def test_get_note_not_found(self, test_client, auth_headers):
        resp = test_client.get("/api/notes/99999", headers=auth_headers)
        assert resp.status_code == 404

    def test_update_note(self, test_client, auth_headers):
        create = test_client.post("/api/notes", json={"title": "Original"}, headers=auth_headers)
        note_id = create.json()["id"]
        resp = test_client.put(f"/api/notes/{note_id}", json={"title": "Updated", "priority": "high"}, headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["title"] == "Updated"
        assert resp.json()["priority"] == "high"

    def test_delete_note(self, test_client, auth_headers):
        create = test_client.post("/api/notes", json={"title": "Delete me"}, headers=auth_headers)
        note_id = create.json()["id"]
        resp = test_client.delete(f"/api/notes/{note_id}", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["ok"] is True
        assert test_client.get(f"/api/notes/{note_id}", headers=auth_headers).status_code == 404

    def test_delete_note_not_found(self, test_client, auth_headers):
        resp = test_client.delete("/api/notes/99999", headers=auth_headers)
        assert resp.status_code == 404


# --- Pin / Complete ---


class TestPinComplete:
    def test_toggle_complete(self, test_client, auth_headers):
        create = test_client.post("/api/notes", json={"title": "Complete me"}, headers=auth_headers)
        note_id = create.json()["id"]
        assert create.json()["is_completed"] is False

        resp = test_client.patch(f"/api/notes/{note_id}/complete", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["is_completed"] is True

        resp = test_client.patch(f"/api/notes/{note_id}/complete", headers=auth_headers)
        assert resp.json()["is_completed"] is False

    def test_toggle_pin(self, test_client, auth_headers):
        create = test_client.post("/api/notes", json={"title": "Pin me"}, headers=auth_headers)
        note_id = create.json()["id"]
        assert create.json()["is_pinned"] is False

        resp = test_client.patch(f"/api/notes/{note_id}/pin", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["is_pinned"] is True

        resp = test_client.patch(f"/api/notes/{note_id}/pin", headers=auth_headers)
        assert resp.json()["is_pinned"] is False


# --- Assign ---


class TestAssign:
    def test_assign_note(self, test_client, auth_headers):
        from tests.conftest import TestingSessionLocal
        from app.models.user import User
        db = TestingSessionLocal()
        user2 = User(username="assignee", email="a@b.com", password_hash="x", role="worker")
        db.add(user2)
        db.commit()
        db.refresh(user2)
        uid = user2.id
        db.close()

        create = test_client.post("/api/notes", json={"title": "Assign test"}, headers=auth_headers)
        note_id = create.json()["id"]

        resp = test_client.post(f"/api/notes/{note_id}/assign", json={"assigned_to_id": uid}, headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["assigned_to_id"] == uid
        assert resp.json()["assigned_to_name"] == "assignee"

    def test_unassign_note(self, test_client, auth_headers):
        create = test_client.post("/api/notes", json={"title": "Unassign"}, headers=auth_headers)
        note_id = create.json()["id"]
        resp = test_client.post(f"/api/notes/{note_id}/assign", json={"assigned_to_id": None}, headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["assigned_to_id"] is None

    def test_assign_nonexistent_user(self, test_client, auth_headers):
        create = test_client.post("/api/notes", json={"title": "Bad assign"}, headers=auth_headers)
        note_id = create.json()["id"]
        resp = test_client.post(f"/api/notes/{note_id}/assign", json={"assigned_to_id": 99999}, headers=auth_headers)
        assert resp.status_code == 404

    def test_cannot_assign_note_to_supplier(self, test_client, auth_headers):
        from tests.conftest import TestingSessionLocal
        from app.models.supplier import Supplier
        from app.models.user import User
        db = TestingSessionLocal()
        supplier = Supplier(name="Acme Supplies")
        db.add(supplier)
        db.commit()
        db.refresh(supplier)
        su = User(username="acme-portal", email="portal@acme.com", password_hash="x",
                  role="supplier", supplier_id=supplier.id)
        db.add(su)
        db.commit()
        db.refresh(su)
        su_id = su.id
        db.close()

        create = test_client.post("/api/notes", json={"title": "Assign to supplier"}, headers=auth_headers)
        note_id = create.json()["id"]
        resp = test_client.post(f"/api/notes/{note_id}/assign", json={"assigned_to_id": su_id}, headers=auth_headers)
        assert resp.status_code == 404

    def test_create_note_rejects_supplier_assignee(self, test_client, auth_headers):
        from tests.conftest import TestingSessionLocal
        from app.models.supplier import Supplier
        from app.models.user import User
        db = TestingSessionLocal()
        supplier = Supplier(name="Acme Supplies 2")
        db.add(supplier)
        db.commit()
        db.refresh(supplier)
        su = User(username="acme-portal-2", email="portal2@acme.com", password_hash="x",
                  role="supplier", supplier_id=supplier.id)
        db.add(su)
        db.commit()
        db.refresh(su)
        su_id = su.id
        db.close()

        resp = test_client.post(
            "/api/notes",
            json={"title": "Bad assignee", "assigned_to_id": su_id},
            headers=auth_headers,
        )
        assert resp.status_code == 400

    def test_assignable_users_excludes_suppliers(self, test_client, auth_headers):
        from tests.conftest import TestingSessionLocal
        from app.models.supplier import Supplier
        from app.models.user import User
        db = TestingSessionLocal()
        worker = User(username="worker-assign", email="wa@b.com", password_hash="x", role="worker")
        db.add(worker)
        supplier = Supplier(name="Acme Supplies 3")
        db.add(supplier)
        db.commit()
        db.refresh(supplier)
        su = User(username="supplier-assign", email="sa@b.com", password_hash="x",
                  role="supplier", supplier_id=supplier.id)
        db.add(su)
        db.commit()
        db.close()

        resp = test_client.get("/api/notes/assignable-users", headers=auth_headers)
        assert resp.status_code == 200
        names = {u["username"] for u in resp.json()}
        assert "worker-assign" in names
        assert "supplier-assign" not in names


# --- Tags ---


class TestTags:
    def test_create_tag(self, test_client, auth_headers):
        resp = test_client.post("/api/notes/tags", json={"name": "urgent-tag", "color": "#ff0000"}, headers=auth_headers)
        assert resp.status_code == 201
        assert resp.json()["name"] == "urgent-tag"
        assert resp.json()["color"] == "#ff0000"

    def test_create_tag_duplicate(self, test_client, auth_headers):
        test_client.post("/api/notes/tags", json={"name": "dup"}, headers=auth_headers)
        resp = test_client.post("/api/notes/tags", json={"name": "dup"}, headers=auth_headers)
        assert resp.status_code == 400

    def test_list_tags(self, test_client, auth_headers):
        test_client.post("/api/notes/tags", json={"name": "tag-a"}, headers=auth_headers)
        test_client.post("/api/notes/tags", json={"name": "tag-b"}, headers=auth_headers)
        resp = test_client.get("/api/notes/tags", headers=auth_headers)
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    def test_delete_tag(self, test_client, auth_headers):
        tag = test_client.post("/api/notes/tags", json={"name": "del-me"}, headers=auth_headers).json()
        resp = test_client.delete(f"/api/notes/tags/{tag['id']}", headers=auth_headers)
        assert resp.status_code == 200
        assert test_client.get("/api/notes/tags", headers=auth_headers).json() == []

    def test_add_tag_to_note(self, test_client, auth_headers):
        tag = test_client.post("/api/notes/tags", json={"name": "mytag"}, headers=auth_headers).json()
        note = test_client.post("/api/notes", json={"title": "Tagged note"}, headers=auth_headers).json()
        resp = test_client.post(f"/api/notes/{note['id']}/tags", json=[tag["id"]], headers=auth_headers)
        assert resp.status_code == 200

        detail = test_client.get(f"/api/notes/{note['id']}", headers=auth_headers).json()
        assert len(detail["tags"]) == 1
        assert detail["tags"][0]["name"] == "mytag"

    def test_remove_tag_from_note(self, test_client, auth_headers):
        tag = test_client.post("/api/notes/tags", json={"name": "rm-tag"}, headers=auth_headers).json()
        note = test_client.post("/api/notes", json={"title": "Remove tag"}, headers=auth_headers).json()
        test_client.post(f"/api/notes/{note['id']}/tags", json=[tag["id"]], headers=auth_headers)
        resp = test_client.delete(f"/api/notes/{note['id']}/tags/{tag['id']}", headers=auth_headers)
        assert resp.status_code == 200

        detail = test_client.get(f"/api/notes/{note['id']}", headers=auth_headers).json()
        assert detail["tags"] == []

    def test_add_nonexistent_tag(self, test_client, auth_headers):
        note = test_client.post("/api/notes", json={"title": "x"}, headers=auth_headers).json()
        resp = test_client.post(f"/api/notes/{note['id']}/tags", json=[99999], headers=auth_headers)
        assert resp.status_code == 404


# --- Links ---


class TestLinks:
    def test_add_link(self, test_client, auth_headers):
        note = test_client.post("/api/notes", json={"title": "Linked"}, headers=auth_headers).json()
        resp = test_client.post(f"/api/notes/{note['id']}/links", json={"entity_type": "product", "entity_id": 1}, headers=auth_headers)
        assert resp.status_code == 201
        assert resp.json()["entity_type"] == "product"

    def test_add_duplicate_link(self, test_client, auth_headers):
        note = test_client.post("/api/notes", json={"title": "Dup link"}, headers=auth_headers).json()
        test_client.post(f"/api/notes/{note['id']}/links", json={"entity_type": "product", "entity_id": 1}, headers=auth_headers)
        resp = test_client.post(f"/api/notes/{note['id']}/links", json={"entity_type": "product", "entity_id": 1}, headers=auth_headers)
        assert resp.status_code == 400

    def test_remove_link(self, test_client, auth_headers):
        note = test_client.post("/api/notes", json={"title": "Rm link"}, headers=auth_headers).json()
        link = test_client.post(f"/api/notes/{note['id']}/links", json={"entity_type": "order", "entity_id": 5}, headers=auth_headers).json()
        resp = test_client.delete(f"/api/notes/{note['id']}/links/{link['id']}", headers=auth_headers)
        assert resp.status_code == 200

    def test_remove_nonexistent_link(self, test_client, auth_headers):
        note = test_client.post("/api/notes", json={"title": "No link"}, headers=auth_headers).json()
        resp = test_client.delete(f"/api/notes/{note['id']}/links/99999", headers=auth_headers)
        assert resp.status_code == 404


# --- Filtering ---


class TestFiltering:
    def test_filter_by_category(self, test_client, auth_headers):
        test_client.post("/api/notes", json={"title": "N", "category": "note"}, headers=auth_headers)
        test_client.post("/api/notes", json={"title": "R", "category": "reminder"}, headers=auth_headers)
        test_client.post("/api/notes", json={"title": "T", "category": "todo"}, headers=auth_headers)

        resp = test_client.get("/api/notes?category=reminder", headers=auth_headers)
        assert resp.json()["total"] == 1
        assert resp.json()["items"][0]["category"] == "reminder"

    def test_filter_by_priority(self, test_client, auth_headers):
        test_client.post("/api/notes", json={"title": "Low", "priority": "low"}, headers=auth_headers)
        test_client.post("/api/notes", json={"title": "Urgent", "priority": "urgent"}, headers=auth_headers)

        resp = test_client.get("/api/notes?priority=urgent", headers=auth_headers)
        assert resp.json()["total"] == 1
        assert resp.json()["items"][0]["priority"] == "urgent"

    def test_filter_by_search(self, test_client, auth_headers):
        test_client.post("/api/notes", json={"title": "Inventory check"}, headers=auth_headers)
        test_client.post("/api/notes", json={"title": "Order followup"}, headers=auth_headers)

        resp = test_client.get("/api/notes?search=Inventory", headers=auth_headers)
        assert resp.json()["total"] == 1

    def test_filter_completed(self, test_client, auth_headers):
        n1 = test_client.post("/api/notes", json={"title": "Done"}, headers=auth_headers).json()
        test_client.post("/api/notes", json={"title": "Active"}, headers=auth_headers)
        test_client.patch(f"/api/notes/{n1['id']}/complete", headers=auth_headers)

        resp = test_client.get("/api/notes?is_completed=true", headers=auth_headers)
        assert resp.json()["total"] == 1

    def test_filter_pinned(self, test_client, auth_headers):
        n1 = test_client.post("/api/notes", json={"title": "Pinned"}, headers=auth_headers).json()
        test_client.patch(f"/api/notes/{n1['id']}/pin", headers=auth_headers)

        resp = test_client.get("/api/notes?is_pinned=true", headers=auth_headers)
        assert resp.json()["total"] == 1

        resp = test_client.get("/api/notes?is_pinned=false", headers=auth_headers)
        assert resp.json()["total"] == 0

    def test_filter_by_tag(self, test_client, auth_headers):
        tag = test_client.post("/api/notes/tags", json={"name": "filter-tag"}, headers=auth_headers).json()
        n1 = test_client.post("/api/notes", json={"title": "Tagged"}, headers=auth_headers).json()
        test_client.post("/api/notes", json={"title": "Untagged"}, headers=auth_headers)
        test_client.post(f"/api/notes/{n1['id']}/tags", json=[tag["id"]], headers=auth_headers)

        resp = test_client.get(f"/api/notes?tag_id={tag['id']}", headers=auth_headers)
        assert resp.json()["total"] == 1

    def test_filter_by_assigned_to(self, test_client, auth_headers):
        from tests.conftest import TestingSessionLocal
        from app.models.user import User
        db = TestingSessionLocal()
        u = User(username="worker1", email="w@b.com", password_hash="x", role="worker")
        db.add(u)
        db.commit()
        db.refresh(u)
        uid = u.id
        db.close()

        n1 = test_client.post("/api/notes", json={"title": "Assigned"}, headers=auth_headers).json()
        test_client.post("/api/notes", json={"title": "Unassigned"}, headers=auth_headers)
        test_client.post(f"/api/notes/{n1['id']}/assign", json={"assigned_to_id": uid}, headers=auth_headers)

        resp = test_client.get(f"/api/notes?assigned_to={uid}", headers=auth_headers)
        assert resp.json()["total"] == 1


# --- Permissions ---


class TestPermissions:
    def test_worker_can_view_notes(self, test_client):
        from tests.conftest import create_test_user
        create_test_user("worker_view", "wv@b.com", "workerpass1", "worker")
        resp = test_client.post("/api/auth/login", json={"username": "worker_view", "password": "workerpass1"})
        worker_headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

        resp = test_client.get("/api/notes", headers=worker_headers)
        assert resp.status_code == 200

    def test_worker_can_create_notes(self, test_client):
        from tests.conftest import create_test_user
        create_test_user("worker_create", "wc@b.com", "workerpass2", "worker")
        resp = test_client.post("/api/auth/login", json={"username": "worker_create", "password": "workerpass2"})
        worker_headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

        resp = test_client.post("/api/notes", json={"title": "Worker note"}, headers=worker_headers)
        assert resp.status_code == 201

    def test_unauthenticated_cannot_access(self, test_client):
        resp = test_client.get("/api/notes")
        assert resp.status_code in (401, 403)


# --- Overdue ---


class TestOverdue:
    def test_overdue_count(self, test_client, auth_headers):
        from datetime import datetime, timezone, timedelta
        past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        test_client.post("/api/notes", json={"title": "Overdue", "due_date": past}, headers=auth_headers)
        test_client.post("/api/notes", json={"title": "No due"}, headers=auth_headers)

        resp = test_client.get("/api/notes/overdue-count", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json() == 1
