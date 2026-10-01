from datetime import date, timedelta

from tests.conftest import client, create_test_user


def _make_product(auth_headers, sku):
    return client.post("/api/products", json={"location_id": 1,
        "sku": sku, "name": sku, "unit_price": 10.0, "cost_price": 4.0, "quantity": 0,
    }, headers=auth_headers).json()


def _make_center(auth_headers, code, **overrides):
    payload = {"code": code, "name": overrides.pop("name", code), "hours_per_day": 8.0}
    payload.update(overrides)
    return client.post("/api/work-centers", json=payload, headers=auth_headers).json()


def _set_routing(auth_headers, product_id, operations):
    return client.put(f"/api/routings/products/{product_id}", json={"operations": operations}, headers=auth_headers)


def test_empty_routing_for_product_without_one(auth_headers):
    product = _make_product(auth_headers, "RT-EMPTY")
    resp = client.get(f"/api/routings/products/{product['id']}", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["product_id"] == product["id"]
    assert body["product_name"] == product["name"]
    assert body["operation_count"] == 0
    assert body["operations"] == []
    # No steps means nothing is schedulable, so the route is not "complete".
    assert body["is_complete"] is False
    assert body["ideal_minutes_per_unit"] == 0.0


def test_routing_unknown_product_404(auth_headers):
    assert client.get("/api/routings/products/999999", headers=auth_headers).status_code == 404


def test_replace_routing_creates_steps_in_order(auth_headers):
    product = _make_product(auth_headers, "RT-1")
    cut = _make_center(auth_headers, "RT-CUT")
    weld = _make_center(auth_headers, "RT-WELD")
    resp = _set_routing(auth_headers, product["id"], [
        {"work_center_id": cut["id"], "position": 1, "name": "Cut blanks", "setup_minutes": 10, "run_minutes_per_unit": 2.5},
        {"work_center_id": weld["id"], "position": 0, "name": "Weld frame", "setup_minutes": 20, "run_minutes_per_unit": 5},
    ])
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["operation_count"] == 2
    assert [op["position"] for op in body["operations"]] == [0, 1]
    assert [op["work_center_code"] for op in body["operations"]] == ["RT-WELD", "RT-CUT"]
    assert body["operations"][0]["label"] == "Weld frame"
    assert body["total_setup_minutes"] == 30
    assert body["total_run_minutes_per_unit"] == 7.5
    assert body["unique_work_centers"] == 2
    assert body["is_complete"] is True


def test_ideal_minutes_per_unit_sums_setup_and_run(auth_headers):
    product = _make_product(auth_headers, "RT-2")
    wc = _make_center(auth_headers, "RT-MIN", efficiency=100.0)
    _set_routing(auth_headers, product["id"], [
        {"work_center_id": wc["id"], "position": 0, "setup_minutes": 30, "run_minutes_per_unit": 1.5},
    ])
    body = client.get(f"/api/routings/products/{product['id']}", headers=auth_headers).json()
    assert body["ideal_minutes_per_unit"] == 31.5
    # At full efficiency the adjusted time equals the ideal time.
    assert body["adjusted_minutes_per_unit"] == 31.5


def test_low_efficiency_extends_the_adjusted_time(auth_headers):
    """A center running at 50% needs twice the ideal minutes for the same job."""
    product = _make_product(auth_headers, "RT-3")
    wc = _make_center(auth_headers, "RT-SLOW", efficiency=50.0)
    _set_routing(auth_headers, product["id"], [
        {"work_center_id": wc["id"], "position": 0, "setup_minutes": 10, "run_minutes_per_unit": 2},
    ])
    body = client.get(f"/api/routings/products/{product['id']}", headers=auth_headers).json()
    assert body["ideal_minutes_per_unit"] == 12.0
    assert body["adjusted_minutes_per_unit"] == 24.0


def test_replace_routing_is_idempotent(auth_headers):
    product = _make_product(auth_headers, "RT-4")
    wc = _make_center(auth_headers, "RT-REPL")
    ops = [{"work_center_id": wc["id"], "position": 0, "setup_minutes": 5}]
    _set_routing(auth_headers, product["id"], ops)
    second = _set_routing(auth_headers, product["id"], ops)
    assert second.status_code == 200
    assert second.json()["operation_count"] == 1


def test_replace_routing_swaps_previous_steps(auth_headers):
    product = _make_product(auth_headers, "RT-5")
    old = _make_center(auth_headers, "RT-OLD")
    new = _make_center(auth_headers, "RT-NEW")
    _set_routing(auth_headers, product["id"], [
        {"work_center_id": old["id"], "position": 0, "setup_minutes": 5},
        {"work_center_id": old["id"], "position": 1, "setup_minutes": 7},
    ])
    body = _set_routing(auth_headers, product["id"], [
        {"work_center_id": new["id"], "position": 0, "setup_minutes": 3},
    ]).json()
    assert body["operation_count"] == 1
    assert body["operations"][0]["work_center_code"] == "RT-NEW"

    # The old center is no longer referenced, so it can be hard-deleted.
    assert client.delete(f"/api/trash/work_center/{old['id']}", headers=auth_headers).status_code == 404
    old_id = old["id"]
    client.delete(f"/api/work-centers/{old_id}", headers=auth_headers)
    resp = client.delete(f"/api/trash/work_center/{old_id}", headers=auth_headers)
    assert resp.status_code == 200, resp.text


def test_replace_routing_with_no_steps_clears_the_route(auth_headers):
    product = _make_product(auth_headers, "RT-6")
    wc = _make_center(auth_headers, "RT-CLEAR")
    _set_routing(auth_headers, product["id"], [{"work_center_id": wc["id"], "position": 0}])
    body = _set_routing(auth_headers, product["id"], []).json()
    assert body["operation_count"] == 0
    assert body["is_complete"] is False


def test_duplicate_positions_rejected(auth_headers):
    product = _make_product(auth_headers, "RT-7")
    wc = _make_center(auth_headers, "RT-DUP")
    resp = _set_routing(auth_headers, product["id"], [
        {"work_center_id": wc["id"], "position": 0},
        {"work_center_id": wc["id"], "position": 0},
    ])
    assert resp.status_code == 400
    assert "position" in resp.json()["detail"]


def test_gap_in_positions_is_incomplete(auth_headers):
    product = _make_product(auth_headers, "RT-8")
    a = _make_center(auth_headers, "RT-GAP1")
    b = _make_center(auth_headers, "RT-GAP2")
    body = _set_routing(auth_headers, product["id"], [
        {"work_center_id": a["id"], "position": 0},
        {"work_center_id": b["id"], "position": 5},
    ]).json()
    assert body["operation_count"] == 2
    assert body["is_complete"] is False


def test_unknown_work_center_rejected(auth_headers):
    product = _make_product(auth_headers, "RT-9")
    resp = _set_routing(auth_headers, product["id"], [{"work_center_id": 999999, "position": 0}])
    assert resp.status_code == 404
    assert "Work center not found" in resp.json()["detail"]


def test_inactive_work_center_rejected(auth_headers):
    product = _make_product(auth_headers, "RT-10")
    wc = _make_center(auth_headers, "RT-OFF", is_active=False)
    resp = _set_routing(auth_headers, product["id"], [{"work_center_id": wc["id"], "position": 0}])
    assert resp.status_code == 400
    assert "inactive" in resp.json()["detail"]


def test_zero_capacity_work_center_rejected(auth_headers):
    """A center with no hours cannot carry work, so it cannot be routed to."""
    product = _make_product(auth_headers, "RT-11")
    wc = _make_center(auth_headers, "RT-0CAP", hours_per_day=0.001)
    resp = _set_routing(auth_headers, product["id"], [{"work_center_id": wc["id"], "position": 0}])
    assert resp.status_code == 400


def test_negative_times_rejected(auth_headers):
    product = _make_product(auth_headers, "RT-12")
    wc = _make_center(auth_headers, "RT-NEG")
    resp = _set_routing(auth_headers, product["id"], [
        {"work_center_id": wc["id"], "position": 0, "setup_minutes": -5},
    ])
    assert resp.status_code == 422
    resp = _set_routing(auth_headers, product["id"], [
        {"work_center_id": wc["id"], "position": 0, "run_minutes_per_unit": -1},
    ])
    assert resp.status_code == 422


def test_same_center_twice_at_different_positions(auth_headers):
    product = _make_product(auth_headers, "RT-13")
    wc = _make_center(auth_headers, "RT-TWICE")
    body = _set_routing(auth_headers, product["id"], [
        {"work_center_id": wc["id"], "position": 0, "name": "Rough cut"},
        {"work_center_id": wc["id"], "position": 1, "name": "Finish cut"},
    ]).json()
    assert body["operation_count"] == 2
    assert body["unique_work_centers"] == 1
    assert body["is_complete"] is True


def test_append_operation_adds_to_the_end(auth_headers):
    product = _make_product(auth_headers, "RT-14")
    a = _make_center(auth_headers, "RT-APP1")
    b = _make_center(auth_headers, "RT-APP2")
    _set_routing(auth_headers, product["id"], [{"work_center_id": a["id"], "position": 0}])
    resp = client.post(f"/api/routings/products/{product['id']}/operations",
                       json={"work_center_id": b["id"], "name": "Paint", "setup_minutes": 15}, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["operation_count"] == 2
    assert body["operations"][1]["work_center_code"] == "RT-APP2"
    assert body["operations"][1]["position"] == 1
    assert body["is_complete"] is True


def test_append_to_empty_routing_starts_at_zero(auth_headers):
    product = _make_product(auth_headers, "RT-15")
    wc = _make_center(auth_headers, "RT-SOLO")
    body = client.post(f"/api/routings/products/{product['id']}/operations",
                       json={"work_center_id": wc["id"]}, headers=auth_headers).json()
    assert body["operations"][0]["position"] == 0
    assert body["is_complete"] is True


def test_delete_operation_closes_the_position_gap(auth_headers):
    product = _make_product(auth_headers, "RT-16")
    a = _make_center(auth_headers, "RT-DEL1")
    b = _make_center(auth_headers, "RT-DEL2")
    c = _make_center(auth_headers, "RT-DEL3")
    body = _set_routing(auth_headers, product["id"], [
        {"work_center_id": a["id"], "position": 0, "name": "First"},
        {"work_center_id": b["id"], "position": 1, "name": "Second"},
        {"work_center_id": c["id"], "position": 2, "name": "Third"},
    ]).json()
    middle = body["operations"][1]["id"]
    resp = client.delete(f"/api/routings/products/{product['id']}/operations/{middle}", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    after = resp.json()
    assert after["operation_count"] == 2
    assert [op["position"] for op in after["operations"]] == [0, 1]
    assert [op["label"] for op in after["operations"]] == ["First", "Third"]
    assert after["is_complete"] is True


def test_delete_operation_from_the_front_renumbers(auth_headers):
    product = _make_product(auth_headers, "RT-17")
    a = _make_center(auth_headers, "RT-F1")
    b = _make_center(auth_headers, "RT-F2")
    body = _set_routing(auth_headers, product["id"], [
        {"work_center_id": a["id"], "position": 0, "name": "First"},
        {"work_center_id": b["id"], "position": 1, "name": "Second"},
    ]).json()
    resp = client.delete(f"/api/routings/products/{product['id']}/operations/{body['operations'][0]['id']}", headers=auth_headers)
    after = resp.json()
    assert [op["position"] for op in after["operations"]] == [0]
    assert after["operations"][0]["label"] == "Second"


def test_delete_operation_of_another_product_404(auth_headers):
    one = _make_product(auth_headers, "RT-18A")
    two = _make_product(auth_headers, "RT-18B")
    wc = _make_center(auth_headers, "RT-XPROD")
    body = _set_routing(auth_headers, one["id"], [{"work_center_id": wc["id"], "position": 0}]).json()
    resp = client.delete(f"/api/routings/products/{two['id']}/operations/{body['operations'][0]['id']}", headers=auth_headers)
    assert resp.status_code == 404


# --- Register --------------------------------------------------------------

def test_routing_register_lists_products(auth_headers):
    routed = _make_product(auth_headers, "REG-ROUTED")
    bare = _make_product(auth_headers, "REG-BARE")
    wc = _make_center(auth_headers, "REG-WC")
    _set_routing(auth_headers, routed["id"], [{"work_center_id": wc["id"], "position": 0}])

    rows = client.get("/api/routings/products", headers=auth_headers).json()
    by_id = {r["product_id"]: r for r in rows}
    assert by_id[routed["id"]]["operation_count"] == 1
    assert by_id[bare["id"]]["operation_count"] == 0


def test_routing_register_can_filter_to_complete_routes(auth_headers):
    routed = _make_product(auth_headers, "REG-C1")
    bare = _make_product(auth_headers, "REG-C2")
    wc = _make_center(auth_headers, "REG-WC2")
    _set_routing(auth_headers, routed["id"], [{"work_center_id": wc["id"], "position": 0}])

    rows = client.get("/api/routings/products?only_complete=true", headers=auth_headers).json()
    ids = [r["product_id"] for r in rows]
    assert routed["id"] in ids
    assert bare["id"] not in ids


def test_routing_register_puts_incomplete_routes_last(auth_headers):
    wc = _make_center(auth_headers, "REG-WC3")
    complete = _make_product(auth_headers, "REG-SORT-C")
    incomplete = _make_product(auth_headers, "REG-SORT-I")
    _set_routing(auth_headers, complete["id"], [{"work_center_id": wc["id"], "position": 0}])
    _set_routing(auth_headers, incomplete["id"], [{"work_center_id": wc["id"], "position": 3}])

    rows = client.get("/api/routings/products", headers=auth_headers).json()
    order = [r["product_id"] for r in rows]
    assert order.index(complete["id"]) < order.index(incomplete["id"])


def test_routing_register_searches_by_name_and_sku(auth_headers):
    wc = _make_center(auth_headers, "REG-WC4")
    p = _make_product(auth_headers, "REG-SEARCH")
    _set_routing(auth_headers, p["id"], [{"work_center_id": wc["id"], "position": 0}])
    assert len(client.get("/api/routings/products?search=REG-SEARCH", headers=auth_headers).json()) == 1
    assert client.get("/api/routings/products?search=nothing-here", headers=auth_headers).json() == []


# --- Work center usage -----------------------------------------------------

def test_work_center_operation_count_tracks_routings(auth_headers):
    wc = _make_center(auth_headers, "USE-COUNT")
    a = _make_product(auth_headers, "USE-A")
    b = _make_product(auth_headers, "USE-B")
    _set_routing(auth_headers, a["id"], [{"work_center_id": wc["id"], "position": 0}])
    body = client.get(f"/api/work-centers/{wc['id']}", headers=auth_headers).json()
    assert body["operation_count"] == 1

    _set_routing(auth_headers, b["id"], [{"work_center_id": wc["id"], "position": 0}])
    body = client.get(f"/api/work-centers/{wc['id']}", headers=auth_headers).json()
    assert body["operation_count"] == 2


# --- Permissions -----------------------------------------------------------

def test_worker_cannot_edit_routing(auth_headers):
    create_test_user("rtworker2", "rtworker2@example.com", "testpass123", "worker")
    token = client.post("/api/auth/login", json={"username": "rtworker2", "password": "testpass123"}).json()["access_token"]
    worker = {"Authorization": f"Bearer {token}"}
    product = _make_product(auth_headers, "RT-PERM")
    wc = _make_center(auth_headers, "RT-PERMWC")
    assert client.get(f"/api/routings/products/{product['id']}", headers=worker).status_code == 200
    assert client.get("/api/routings/products", headers=worker).status_code == 200
    assert client.put(f"/api/routings/products/{product['id']}", json={"operations": []}, headers=worker).status_code == 403
    resp = client.post(f"/api/routings/products/{product['id']}/operations",
                       json={"work_center_id": wc["id"]}, headers=worker)
    assert resp.status_code == 403
    body = client.get(f"/api/routings/products/{product['id']}", headers=auth_headers).json()
    assert body["operation_count"] == 0