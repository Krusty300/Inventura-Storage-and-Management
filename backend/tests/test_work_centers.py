from datetime import date, datetime, time, timedelta, timezone

from app.models import WorkOrder
from tests.conftest import TestingSessionLocal, client, create_test_user


def _make_product(auth_headers, sku):
    return client.post("/api/products", json={"location_id": 1,
        "sku": sku, "name": sku, "unit_price": 10.0, "cost_price": 4.0, "quantity": 0,
    }, headers=auth_headers).json()


def _make_center(auth_headers, code, **overrides):
    payload = {"code": code, "name": overrides.pop("name", code), "hours_per_day": 8.0}
    payload.update(overrides)
    return client.post("/api/work-centers", json=payload, headers=auth_headers)


def _login(username):
    resp = client.post("/api/auth/login", json={"username": username, "password": "testpass123"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _monday(offset_weeks: int = 0) -> date:
    """A stable Monday, so capacity windows never depend on the day a test runs."""
    today = date.today()
    return today - timedelta(days=today.weekday()) + timedelta(weeks=offset_weeks)


def _stamp_schedule(work_order_id: int, work_center_id: int, start: datetime, end: datetime) -> None:
    """Assign a center and a scheduled window to a work order directly.

    Scheduling is the capacity scheduler's job, and it does not exist yet, so
    tests write the columns it will own rather than inventing an endpoint.
    """
    db = TestingSessionLocal()
    row = db.get(WorkOrder, work_order_id)
    row.work_center_id = work_center_id
    row.scheduled_start = start
    row.scheduled_end = end
    db.commit()
    db.close()


def _assign_center(work_order_id: int, work_center_id: int) -> None:
    db = TestingSessionLocal()
    db.get(WorkOrder, work_order_id).work_center_id = work_center_id
    db.commit()
    db.close()


def _scheduled_work_order(auth_headers, product_id, work_center_id, day: date, hours: float):
    wo = client.post("/api/work-orders", json={"product_id": product_id, "quantity": 1}, headers=auth_headers).json()
    start = datetime.combine(day, time(8, 0), tzinfo=timezone.utc)
    end = start + timedelta(hours=hours)
    _stamp_schedule(wo["id"], work_center_id, start, end)
    return wo


# --- CRUD ------------------------------------------------------------------

def test_create_work_center_defaults(auth_headers):
    resp = _make_center(auth_headers, "CNC-01", name="CNC Mill 1")
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["code"] == "CNC-01"
    assert body["name"] == "CNC Mill 1"
    assert body["work_center_type"] == "workstation"
    assert body["hours_per_day"] == 8.0
    assert body["efficiency"] == 100.0
    assert body["is_active"] is True
    # No working_days means the Mon-Fri default, not a seven-day week.
    assert body["working_day_list"] == [0, 1, 2, 3, 4]
    assert body["daily_minutes"] == 480
    assert body["operation_count"] == 0


def test_code_is_normalized_to_upper(auth_headers):
    resp = _make_center(auth_headers, "press-2", name="Press 2")
    assert resp.status_code == 201, resp.text
    assert resp.json()["code"] == "PRESS-2"


def test_duplicate_code_rejected(auth_headers):
    assert _make_center(auth_headers, "DUP-1").status_code == 201
    resp = _make_center(auth_headers, "DUP-1")
    assert resp.status_code == 400
    assert "already exists" in resp.json()["detail"]


def test_duplicate_code_rejected_on_update(auth_headers):
    first = _make_center(auth_headers, "WC-A").json()
    _make_center(auth_headers, "WC-B")
    resp = client.put(f"/api/work-centers/{first['id']}", json={"code": "WC-B"}, headers=auth_headers)
    assert resp.status_code == 400
    assert "already exists" in resp.json()["detail"]


def test_update_keeps_own_code(auth_headers):
    """Re-saving a center without changing its code must not trip the dup check."""
    wc = _make_center(auth_headers, "WC-SELF").json()
    resp = client.put(f"/api/work-centers/{wc['id']}", json={"name": "Renamed", "code": "WC-SELF"}, headers=auth_headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "Renamed"


def test_partial_update_leaves_other_fields_alone(auth_headers):
    wc = _make_center(auth_headers, "WC-PART", hours_per_day=6.0, hourly_rate=25.0, working_days=[0, 2]).json()
    resp = client.put(f"/api/work-centers/{wc['id']}", json={"name": "Half edited"}, headers=auth_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["name"] == "Half edited"
    assert body["hours_per_day"] == 6.0
    assert body["hourly_rate"] == 25.0
    assert body["working_day_list"] == [0, 2]


def test_invalid_work_center_type_rejected(auth_headers):
    assert _make_center(auth_headers, "WC-BAD", work_center_type="teleport").status_code == 422


def test_invalid_shift_start_rejected(auth_headers):
    assert _make_center(auth_headers, "WC-SHIFT", shift_start="25:99").status_code == 422
    assert _make_center(auth_headers, "WC-SHIFT2", shift_start="nine").status_code == 422


def test_shift_start_is_normalized(auth_headers):
    resp = _make_center(auth_headers, "WC-SHIFT3", shift_start="9:5")
    assert resp.status_code == 201, resp.text
    assert resp.json()["shift_start"] == "09:05"


def test_invalid_working_days_rejected(auth_headers):
    assert _make_center(auth_headers, "WC-DAYS", working_days=[0, 7]).status_code == 422


def test_working_days_are_deduped_and_sorted(auth_headers):
    resp = _make_center(auth_headers, "WC-DAYS2", working_days=[3, 0, 3])
    assert resp.status_code == 201, resp.text
    assert resp.json()["working_day_list"] == [0, 3]


def test_hours_per_day_bounds(auth_headers):
    assert _make_center(auth_headers, "WC-0H", hours_per_day=0).status_code == 422
    assert _make_center(auth_headers, "WC-25H", hours_per_day=25).status_code == 422


def test_unknown_location_rejected(auth_headers):
    assert _make_center(auth_headers, "WC-LOC", location_id=999999).status_code == 404


def test_list_and_search_work_centers(auth_headers):
    _make_center(auth_headers, "SAW-01", name="Saw station")
    _make_center(auth_headers, "WELD-01", name="Weld booth")
    body = client.get("/api/work-centers?search=saw", headers=auth_headers).json()
    assert body["total"] == 1
    assert body["items"][0]["code"] == "SAW-01"
    assert body["page"] == 1 and body["pages"] == 1

    all_rows = client.get("/api/work-centers", headers=auth_headers).json()
    assert all_rows["total"] == 2
    assert [w["code"] for w in all_rows["items"]] == ["SAW-01", "WELD-01"]


def test_filter_by_type_and_active(auth_headers):
    _make_center(auth_headers, "MC-1", work_center_type="machine")
    _make_center(auth_headers, "TEAM-A", work_center_type="labor")
    rows = client.get("/api/work-centers?work_center_type=machine", headers=auth_headers).json()
    assert rows["total"] == 1
    assert rows["items"][0]["code"] == "MC-1"

    labor = client.get("/api/work-centers?work_center_type=labor", headers=auth_headers).json()["items"][0]
    client.put(f"/api/work-centers/{labor['id']}", json={"is_active": False}, headers=auth_headers)
    assert client.get("/api/work-centers?is_active=true", headers=auth_headers).json()["total"] == 1
    assert client.get("/api/work-centers?is_active=false", headers=auth_headers).json()["total"] == 1


def test_types_endpoint(auth_headers):
    resp = client.get("/api/work-centers/types", headers=auth_headers)
    assert resp.status_code == 200
    assert set(resp.json()) == {"workstation", "machine", "labor", "outsourced"}


# --- Trash -----------------------------------------------------------------

def test_delete_sends_center_to_trash(auth_headers):
    wc = _make_center(auth_headers, "WC-TRASH").json()
    assert client.delete(f"/api/work-centers/{wc['id']}", headers=auth_headers).status_code == 204
    assert client.get(f"/api/work-centers/{wc['id']}", headers=auth_headers).status_code == 404
    assert client.get("/api/work-centers", headers=auth_headers).json()["total"] == 0

    trash = client.get("/api/trash?entity_type=work_center", headers=auth_headers).json()
    assert any(row["id"] == wc["id"] for row in trash["items"])
    assert trash["counts"]["work_center"] == 1


def test_trash_restore_returns_center(auth_headers):
    wc = _make_center(auth_headers, "WC-RESTORE").json()
    client.delete(f"/api/work-centers/{wc['id']}", headers=auth_headers)
    resp = client.post(f"/api/trash/work_center/{wc['id']}/restore", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    assert client.get(f"/api/work-centers/{wc['id']}", headers=auth_headers).status_code == 200


def test_purge_blocked_while_used_by_a_routing(auth_headers):
    wc = _make_center(auth_headers, "WC-USED").json()
    product = _make_product(auth_headers, "ROUTED-1")
    saved = client.put(f"/api/routings/products/{product['id']}", json={
        "operations": [{"work_center_id": wc["id"], "position": 0, "setup_minutes": 5}],
    }, headers=auth_headers)
    assert saved.status_code == 200, saved.text
    client.delete(f"/api/work-centers/{wc['id']}", headers=auth_headers)
    resp = client.delete(f"/api/trash/work_center/{wc['id']}", headers=auth_headers)
    assert resp.status_code == 400
    assert "routing" in resp.json()["detail"]


# --- Capacity reporting ----------------------------------------------------

def test_capacity_counts_only_working_days(auth_headers):
    wc = _make_center(auth_headers, "CAP-1", hours_per_day=6.0, working_days=[0, 1, 2, 3, 4]).json()
    monday = _monday()
    body = client.get(f"/api/work-centers/{wc['id']}/load?from_date={monday}&to_date={monday + timedelta(days=4)}", headers=auth_headers).json()
    assert body["working_days_available"] == 5
    assert body["capacity_minutes"] == 5 * 360
    assert body["load_minutes"] == 0
    assert body["free_minutes"] == 1800
    assert body["utilization_pct"] == 0.0
    assert body["is_bottleneck"] is False


def test_weekend_capacity_excluded_from_weekday_center(auth_headers):
    wc = _make_center(auth_headers, "CAP-WD", hours_per_day=8.0, working_days=[0, 1, 2, 3, 4]).json()
    monday = _monday()
    body = client.get(f"/api/work-centers/{wc['id']}/load?from_date={monday}&to_date={monday + timedelta(days=6)}", headers=auth_headers).json()
    assert body["working_days_available"] == 5


def test_seven_day_center_uses_every_day(auth_headers):
    wc = _make_center(auth_headers, "CAP-7", hours_per_day=24.0, working_days=[0, 1, 2, 3, 4, 5, 6]).json()
    monday = _monday()
    body = client.get(f"/api/work-centers/{wc['id']}/load?from_date={monday}&to_date={monday + timedelta(days=6)}", headers=auth_headers).json()
    assert body["working_days_available"] == 7
    assert body["capacity_minutes"] == 7 * 1440


def test_single_day_window_is_one_day_of_capacity(auth_headers):
    wc = _make_center(auth_headers, "CAP-1D", hours_per_day=8.0, working_days=[0, 1, 2, 3, 4, 5, 6]).json()
    monday = _monday()
    body = client.get(f"/api/work-centers/{wc['id']}/load?from_date={monday}&to_date={monday}", headers=auth_headers).json()
    assert body["working_days_available"] == 1
    assert body["capacity_minutes"] == 480


def test_inverted_window_rejected(auth_headers):
    wc = _make_center(auth_headers, "CAP-BAD").json()
    monday = _monday()
    resp = client.get(f"/api/work-centers/{wc['id']}/load?from_date={monday}&to_date={monday - timedelta(days=2)}", headers=auth_headers)
    assert resp.status_code == 400


def test_scheduled_work_order_counts_as_load(auth_headers):
    wc = _make_center(auth_headers, "LOAD-1", hours_per_day=8.0, working_days=[0, 1, 2, 3, 4, 5, 6]).json()
    product = _make_product(auth_headers, "LOADFG")
    monday = _monday()
    _scheduled_work_order(auth_headers, product["id"], wc["id"], monday, hours=5)

    body = client.get(f"/api/work-centers/{wc['id']}/load?from_date={monday}&to_date={monday + timedelta(days=6)}", headers=auth_headers).json()
    assert body["load_minutes"] == 300
    assert body["capacity_minutes"] == 7 * 480
    assert body["free_minutes"] == 7 * 480 - 300
    assert body["scheduled_work_orders"] == 1
    assert body["utilization_pct"] == round(300 / (7 * 480) * 100, 1)


def test_load_outside_window_is_ignored(auth_headers):
    wc = _make_center(auth_headers, "LOAD-2", hours_per_day=8.0, working_days=[0, 1, 2, 3, 4, 5, 6]).json()
    product = _make_product(auth_headers, "LOADFG2")
    _scheduled_work_order(auth_headers, product["id"], wc["id"], _monday(offset_weeks=8), hours=2)

    monday = _monday()
    body = client.get(f"/api/work-centers/{wc['id']}/load?from_date={monday}&to_date={monday + timedelta(days=6)}", headers=auth_headers).json()
    assert body["load_minutes"] == 0
    assert body["scheduled_work_orders"] == 0


def test_utilization_below_threshold_is_not_a_bottleneck(auth_headers):
    wc = _make_center(auth_headers, "BOT-1", hours_per_day=8.0, working_days=[0, 1, 2, 3, 4, 5, 6]).json()
    product = _make_product(auth_headers, "BOTFG")
    monday = _monday()
    _scheduled_work_order(auth_headers, product["id"], wc["id"], monday, hours=6.4)

    body = client.get(f"/api/work-centers/{wc['id']}/load?from_date={monday}&to_date={monday}", headers=auth_headers).json()
    assert body["capacity_minutes"] == 480
    assert body["load_minutes"] == 384
    assert body["utilization_pct"] == 80.0
    assert body["is_bottleneck"] is False


def test_utilization_at_threshold_is_a_bottleneck(auth_headers):
    wc = _make_center(auth_headers, "BOT-2", hours_per_day=8.0, working_days=[0, 1, 2, 3, 4, 5, 6]).json()
    product = _make_product(auth_headers, "BOTFG2")
    monday = _monday()
    _scheduled_work_order(auth_headers, product["id"], wc["id"], monday, hours=7.2)

    body = client.get(f"/api/work-centers/{wc['id']}/load?from_date={monday}&to_date={monday}", headers=auth_headers).json()
    assert body["utilization_pct"] == 90.0
    assert body["is_bottleneck"] is True


def test_overload_leaves_no_free_minutes(auth_headers):
    wc = _make_center(auth_headers, "BOT-3", hours_per_day=8.0, working_days=[0, 1, 2, 3, 4, 5, 6]).json()
    product = _make_product(auth_headers, "BOTFG3")
    monday = _monday()
    _scheduled_work_order(auth_headers, product["id"], wc["id"], monday, hours=10)

    body = client.get(f"/api/work-centers/{wc['id']}/load?from_date={monday}&to_date={monday}", headers=auth_headers).json()
    assert body["load_minutes"] == 600
    assert body["free_minutes"] == 0
    assert body["utilization_pct"] == 125.0
    assert body["is_bottleneck"] is True


def test_completed_work_order_releases_its_capacity(auth_headers):
    wc = _make_center(auth_headers, "DONE-1", hours_per_day=8.0, working_days=[0, 1, 2, 3, 4, 5, 6]).json()
    product = _make_product(auth_headers, "DONEFG")
    monday = _monday()
    wo = _scheduled_work_order(auth_headers, product["id"], wc["id"], monday, hours=4)

    db = TestingSessionLocal()
    db.get(WorkOrder, wo["id"]).status = "completed"
    db.commit()
    db.close()

    body = client.get(f"/api/work-centers/{wc['id']}/load?from_date={monday}&to_date={monday}", headers=auth_headers).json()
    assert body["load_minutes"] == 0
    assert body["scheduled_work_orders"] == 0


def test_load_endpoint_orders_by_utilization(auth_headers):
    busy = _make_center(auth_headers, "L-BUSY", hours_per_day=8.0, working_days=[0, 1, 2, 3, 4, 5, 6]).json()
    _make_center(auth_headers, "L-IDLE", hours_per_day=8.0, working_days=[0, 1, 2, 3, 4, 5, 6])
    product = _make_product(auth_headers, "LOADFG3")
    monday = _monday()
    _scheduled_work_order(auth_headers, product["id"], busy["id"], monday, hours=4)

    rows = client.get(f"/api/work-centers/load?from_date={monday}&to_date={monday}", headers=auth_headers).json()
    assert [r["work_center_code"] for r in rows] == ["L-BUSY", "L-IDLE"]
    assert rows[0]["utilization_pct"] == 50.0
    assert rows[1]["utilization_pct"] == 0.0


def test_load_endpoint_can_exclude_inactive(auth_headers):
    _make_center(auth_headers, "OFF-1", is_active=False)
    assert client.get("/api/work-centers/load?include_inactive=false", headers=auth_headers).json() == []
    assert len(client.get("/api/work-centers/load?include_inactive=true", headers=auth_headers).json()) == 1


def test_unscheduled_and_overdue_counts(auth_headers):
    wc = _make_center(auth_headers, "CNT-1", hours_per_day=8.0, working_days=[0, 1, 2, 3, 4, 5, 6]).json()
    product = _make_product(auth_headers, "CNTFG")
    monday = _monday()
    # Scheduled, then assigned but with no slot yet, then scheduled and past due.
    _scheduled_work_order(auth_headers, product["id"], wc["id"], monday, hours=1)
    queued = client.post("/api/work-orders", json={"product_id": product["id"], "quantity": 1}, headers=auth_headers).json()
    _assign_center(queued["id"], wc["id"])
    yesterday = date.today() - timedelta(days=1)
    overdue = client.post("/api/work-orders", json={
        "product_id": product["id"], "quantity": 1, "due_date": yesterday.isoformat(),
    }, headers=auth_headers).json()
    _stamp_schedule(overdue["id"], wc["id"],
                    datetime.combine(monday, time(9, 0), tzinfo=timezone.utc),
                    datetime.combine(monday, time(10, 0), tzinfo=timezone.utc))

    body = client.get(f"/api/work-centers/{wc['id']}/load?from_date={monday}&to_date={monday}", headers=auth_headers).json()
    assert body["open_work_orders"] == 3
    assert body["scheduled_work_orders"] == 2
    assert body["overdue_work_orders"] == 1


def test_unassigned_work_order_is_not_counted_at_any_center(auth_headers):
    """An order with no center yet is nobody's load until the scheduler places it."""
    wc = _make_center(auth_headers, "CNT-2", hours_per_day=8.0, working_days=[0, 1, 2, 3, 4, 5, 6]).json()
    product = _make_product(auth_headers, "CNTFG2")
    client.post("/api/work-orders", json={"product_id": product["id"], "quantity": 1}, headers=auth_headers)
    monday = _monday()
    body = client.get(f"/api/work-centers/{wc['id']}/load?from_date={monday}&to_date={monday}", headers=auth_headers).json()
    assert body["open_work_orders"] == 0


# --- Work order scheduling fields -----------------------------------------

def test_work_order_accepts_due_date(auth_headers):
    product = _make_product(auth_headers, "DUEDATE")
    due = date.today() + timedelta(days=3)
    resp = client.post("/api/work-orders", json={
        "product_id": product["id"], "quantity": 1, "due_date": due.isoformat(),
    }, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["due_date"] == due.isoformat()
    assert body["is_overdue"] is False
    assert body["is_scheduled"] is False
    assert body["work_center_id"] is None


def test_work_order_overdue_flag(auth_headers):
    product = _make_product(auth_headers, "OVERDUE")
    past = date.today() - timedelta(days=1)
    resp = client.post("/api/work-orders", json={
        "product_id": product["id"], "quantity": 1, "due_date": past.isoformat(),
    }, headers=auth_headers).json()
    assert resp["is_overdue"] is True


def test_work_order_can_be_rescheduled_by_a_planner(auth_headers):
    product = _make_product(auth_headers, "RESCHED")
    wo = client.post("/api/work-orders", json={"product_id": product["id"], "quantity": 1}, headers=auth_headers).json()
    new_due = date.today() + timedelta(days=9)
    resp = client.put(f"/api/work-orders/{wo['id']}", json={"due_date": new_due.isoformat()}, headers=auth_headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["due_date"] == new_due.isoformat()


# --- Permissions -----------------------------------------------------------

def test_worker_can_view_but_not_create_work_center(auth_headers):
    create_test_user("wcworker", "wcworker@example.com", "testpass123", "worker")
    worker = _login("wcworker")
    assert client.get("/api/work-centers", headers=worker).status_code == 200
    assert client.get("/api/work-centers/types", headers=worker).status_code == 200
    assert client.post("/api/work-centers", json={"code": "WC-NOPE", "name": "Nope"}, headers=worker).status_code == 403
    _make_center(auth_headers, "WC-EXIST")
    wc = client.get("/api/work-centers", headers=worker).json()["items"][0]
    assert client.put(f"/api/work-centers/{wc['id']}", json={"name": "Nope"}, headers=worker).status_code == 403
    assert client.delete(f"/api/work-centers/{wc['id']}", headers=worker).status_code == 403


def test_worker_can_view_routings_but_not_edit(auth_headers):
    create_test_user("rtworker", "rtworker@example.com", "testpass123", "worker")
    worker = _login("rtworker")
    product = _make_product(auth_headers, "RTPERM")
    assert client.get(f"/api/routings/products/{product['id']}", headers=worker).status_code == 200
    resp = client.put(f"/api/routings/products/{product['id']}", json={"operations": []}, headers=worker)
    assert resp.status_code == 403