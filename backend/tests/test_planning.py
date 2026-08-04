from tests.conftest import client


def _make_location(auth_headers, code):
    return client.post("/api/locations", json={
        "code": code, "name": code, "location_type": "bin",
    }, headers=auth_headers).json()


def _make_product(auth_headers, sku, cost=4.0):
    return client.post("/api/products", json={
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


def _create_wo(auth_headers, product_id, quantity, bom_id=None):
    payload = {"product_id": product_id, "quantity": quantity}
    if bom_id is not None:
        payload["bom_id"] = bom_id
    return client.post("/api/work-orders", json=payload, headers=auth_headers)


def _run_mrp(auth_headers, product_id, quantity):
    return client.get(f"/api/planning/mrp?product_id={product_id}&quantity={quantity}", headers=auth_headers)


def test_mrp_single_level_with_surplus(auth_headers):
    fg = _make_product(auth_headers, "MRP-FG")
    comp = _make_product(auth_headers, "MRP-COMP")
    loc = _make_location(auth_headers, "MRP-LOC")
    assert _receive(auth_headers, comp["id"], 50, loc["id"]).status_code == 201
    bom = _create_bom(auth_headers, fg["id"], [(comp["id"], 2)]).json()

    resp = _run_mrp(auth_headers, fg["id"], 10)
    assert resp.status_code == 200
    body = resp.json()
    assert body["demand_product_name"] == fg["name"]
    by_id = {it["product_id"]: it for it in body["items"]}

    fg_row = by_id[fg["id"]]
    assert fg_row["level"] == 1
    assert fg_row["gross_requirement"] == 10
    assert fg_row["action"] == "manufacture"
    assert fg_row["bom_id"] == bom["id"]
    assert fg_row["suggested_quantity"] == 10

    comp_row = by_id[comp["id"]]
    assert comp_row["level"] == 2
    assert comp_row["gross_requirement"] == 20
    assert comp_row["on_hand"] == 50
    assert comp_row["action"] == "none"
    assert comp_row["suggested_quantity"] == 0
    assert comp_row["component_of"] == fg["name"]


def test_mrp_purchase_suggestion_for_shortage(auth_headers):
    fg = _make_product(auth_headers, "MRP-FG2")
    comp = _make_product(auth_headers, "MRP-COMP2")
    loc = _make_location(auth_headers, "MRP-LOC2")
    assert _receive(auth_headers, comp["id"], 5, loc["id"]).status_code == 201
    _create_bom(auth_headers, fg["id"], [(comp["id"], 2)])

    body = _run_mrp(auth_headers, fg["id"], 10).json()
    comp_row = next(it for it in body["items"] if it["product_id"] == comp["id"])
    assert comp_row["gross_requirement"] == 20
    assert comp_row["on_hand"] == 5
    assert comp_row["net_requirement"] == 15
    assert comp_row["action"] == "purchase"
    assert comp_row["suggested_quantity"] == 15


def test_mrp_manufacture_suggestion_for_sub_assembly(auth_headers):
    fg = _make_product(auth_headers, "MRP-FG3")
    sub = _make_product(auth_headers, "MRP-SUB")
    raw = _make_product(auth_headers, "MRP-RAW")
    loc = _make_location(auth_headers, "MRP-LOC3")
    assert _receive(auth_headers, raw["id"], 100, loc["id"]).status_code == 201
    bom_sub = _create_bom(auth_headers, sub["id"], [(raw["id"], 1)]).json()
    _create_bom(auth_headers, fg["id"], [(sub["id"], 3)])

    body = _run_mrp(auth_headers, fg["id"], 4).json()
    by_id = {it["product_id"]: it for it in body["items"]}

    sub_row = by_id[sub["id"]]
    assert sub_row["level"] == 2
    assert sub_row["gross_requirement"] == 12
    assert sub_row["action"] == "manufacture"
    assert sub_row["bom_id"] == bom_sub["id"]
    assert sub_row["suggested_quantity"] == 12

    raw_row = by_id[raw["id"]]
    assert raw_row["level"] == 3
    assert raw_row["gross_requirement"] == 12
    assert raw_row["action"] == "none"


def test_mrp_netting_against_open_work_orders(auth_headers):
    fg = _make_product(auth_headers, "MRP-FG4")
    comp = _make_product(auth_headers, "MRP-COMP4")
    loc = _make_location(auth_headers, "MRP-LOC4")
    assert _receive(auth_headers, comp["id"], 100, loc["id"]).status_code == 201
    bom = _create_bom(auth_headers, fg["id"], [(comp["id"], 2)]).json()
    _create_wo(auth_headers, fg["id"], 7, bom_id=bom["id"])

    body = _run_mrp(auth_headers, fg["id"], 10).json()
    fg_row = next(it for it in body["items"] if it["product_id"] == fg["id"])
    assert fg_row["scheduled_receipts"] == 7
    assert fg_row["available"] == 7
    assert fg_row["net_requirement"] == 3
    assert fg_row["action"] == "manufacture"
