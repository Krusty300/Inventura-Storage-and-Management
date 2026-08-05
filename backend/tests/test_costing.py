from tests.conftest import client


def _make_location(auth_headers, code):
    return client.post("/api/locations", json={
        "code": code, "name": code, "location_type": "bin",
    }, headers=auth_headers).json()


def _make_product(auth_headers, sku, cost=4.0):
    return client.post("/api/products", json={"location_id": 1, 
        "sku": sku, "name": sku, "unit_price": 10.0, "cost_price": cost, "quantity": 0,
    }, headers=auth_headers).json()


def _receive(auth_headers, product_id, quantity, location_id, lot_number=""):
    return client.post("/api/receipts", json={
        "items": [{"product_id": product_id, "quantity": quantity,
                   "location_id": location_id, "lot_number": lot_number}],
    }, headers=auth_headers)


def _create_bom(auth_headers, product_id, components):
    return client.post("/api/boms", json={
        "product_id": product_id,
        "items": [{"product_id": pid, "quantity": qty} for pid, qty in components],
    }, headers=auth_headers)


def _create_wo(auth_headers, product_id, quantity, bom_id):
    return client.post("/api/work-orders", json={
        "product_id": product_id, "quantity": quantity, "bom_id": bom_id,
    }, headers=auth_headers)


def test_product_cost_rolled_up_single_level(auth_headers):
    fg = _make_product(auth_headers, "COST-FG", cost=0.0)
    c1 = _make_product(auth_headers, "COST-C1", cost=3.0)
    c2 = _make_product(auth_headers, "COST-C2", cost=5.0)
    _create_bom(auth_headers, fg["id"], [(c1["id"], 2), (c2["id"], 1)])

    body = client.get(f"/api/costing/products/{fg['id']}", headers=auth_headers).json()
    assert body["unit_cost"] == 11.0
    assert body["has_bom"] is True
    assert len(body["items"]) == 2
    by_id = {it["product_id"]: it for it in body["items"]}
    assert by_id[c1["id"]]["extended_cost"] == 6.0
    assert by_id[c2["id"]]["extended_cost"] == 5.0


def test_product_cost_rolled_up_multi_level(auth_headers):
    fg = _make_product(auth_headers, "COST-FG2", cost=0.0)
    sub = _make_product(auth_headers, "COST-SUB", cost=2.0)
    raw = _make_product(auth_headers, "COST-RAW", cost=4.0)
    _create_bom(auth_headers, sub["id"], [(raw["id"], 3)])
    _create_bom(auth_headers, fg["id"], [(sub["id"], 2)])

    body = client.get(f"/api/costing/products/{fg['id']}", headers=auth_headers).json()
    # sub costs 3*4 = 12; fg needs 2 => 24
    assert body["unit_cost"] == 24.0
    sub_item = body["items"][0]
    assert sub_item["product_id"] == sub["id"]
    assert sub_item["component_unit_cost"] == 12.0
    assert sub_item["has_bom"] is True


def test_work_order_cost_actual_vs_standard(auth_headers):
    fg = _make_product(auth_headers, "COST-FG3", cost=0.0)
    comp = _make_product(auth_headers, "COST-COMP", cost=4.0)
    loc = _make_location(auth_headers, "COST-LOC")
    assert _receive(auth_headers, comp["id"], 50, loc["id"]).status_code == 201
    bom = _create_bom(auth_headers, fg["id"], [(comp["id"], 2)]).json()
    wo = _create_wo(auth_headers, fg["id"], 5, bom["id"]).json()
    client.post(f"/api/work-orders/{wo['id']}/release", headers=auth_headers)

    body = client.get(f"/api/costing/work-orders/{wo['id']}", headers=auth_headers).json()
    assert body["material_cost"] == 40.0  # 10 comps issued * 4
    assert body["standard_unit_cost"] == 8.0
    assert body["actual_unit_cost"] == 8.0
    assert body["variance"] == 0.0
    assert body["rows"][0]["quantity_issued"] == 10


def test_cost_report_aggregates_completed_orders(auth_headers):
    fg = _make_product(auth_headers, "COST-FG4", cost=0.0)
    comp = _make_product(auth_headers, "COST-COMP4", cost=4.0)
    loc = _make_location(auth_headers, "COST-LOC4")
    assert _receive(auth_headers, comp["id"], 50, loc["id"]).status_code == 201
    bom = _create_bom(auth_headers, fg["id"], [(comp["id"], 2)]).json()
    wo = _create_wo(auth_headers, fg["id"], 5, bom["id"]).json()
    client.post(f"/api/work-orders/{wo['id']}/release", headers=auth_headers)
    assert client.post(f"/api/work-orders/{wo['id']}/complete", json={
        "receive_location_id": loc["id"], "received_qty": 5,
    }, headers=auth_headers).status_code == 200

    body = client.get("/api/costing/report", headers=auth_headers).json()
    assert body["completed_orders"] == 1
    row = body["items"][0]
    assert row["wo_number"] == wo["wo_number"]
    assert row["material_cost"] == 40.0
    assert row["standard_cost"] == 40.0
    assert row["variance"] == 0.0
