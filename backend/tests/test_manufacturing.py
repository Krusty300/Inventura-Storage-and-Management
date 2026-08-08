from tests.conftest import client


def _make_location(auth_headers, code, location_type="bin"):
    return client.post("/api/locations", json={
        "code": code, "name": code, "location_type": location_type,
    }, headers=auth_headers).json()


def _make_product(auth_headers, sku, serialized=False):
    return client.post("/api/products", json={"location_id": 1, 
        "sku": sku, "name": sku, "unit_price": 10.0, "cost_price": 4.0, "quantity": 0,
        "is_serialized": serialized,
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


def _create_wo(auth_headers, product_id, quantity, bom_id=None, items=None):
    payload = {"product_id": product_id, "quantity": quantity}
    if bom_id is not None:
        payload["bom_id"] = bom_id
    if items:
        payload["items"] = items
    return client.post("/api/work-orders", json=payload, headers=auth_headers)


# ---------------------------------------------------------------- BOM

def test_bom_create_and_cycle_detection_direct(auth_headers):
    a = _make_product(auth_headers, "BOM-A")
    ok = _create_bom(auth_headers, a["id"], [(a["id"], 1)])
    assert ok.status_code == 400
    assert "cycle" in ok.json()["detail"].lower()


def test_bom_create_and_cycle_detection_multi_level(auth_headers):
    a = _make_product(auth_headers, "BOM-MA")
    b = _make_product(auth_headers, "BOM-MB")
    c = _make_product(auth_headers, "BOM-MC")
    assert _create_bom(auth_headers, a["id"], [(b["id"], 2)]).status_code == 201
    assert _create_bom(auth_headers, b["id"], [(c["id"], 1)]).status_code == 201
    resp = _create_bom(auth_headers, c["id"], [(a["id"], 1)])
    assert resp.status_code == 400
    assert "cycle" in resp.json()["detail"].lower()


def test_bom_update_rejects_introduced_cycle(auth_headers):
    a = _make_product(auth_headers, "BOM-UA")
    b = _make_product(auth_headers, "BOM-UB")
    c = _make_product(auth_headers, "BOM-UC")
    _create_bom(auth_headers, a["id"], [(b["id"], 1)]).json()
    bom_b = _create_bom(auth_headers, b["id"], [(c["id"], 1)]).json()
    # Rewiring B to depend on A creates B -> A -> B.
    resp = client.put(f"/api/boms/{bom_b['id']}", json={
        "items": [{"product_id": a["id"], "quantity": 1}],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "cycle" in resp.json()["detail"].lower()


def test_bom_accepts_serialized_components(auth_headers):
    fg = _make_product(auth_headers, "BOM-FG")
    ser = _make_product(auth_headers, "BOM-SER", serialized=True)
    resp = _create_bom(auth_headers, fg["id"], [(ser["id"], 1)])
    assert resp.status_code == 201


def test_bom_crud_and_cost(auth_headers):
    fg = _make_product(auth_headers, "BOM-CR")
    c1 = _make_product(auth_headers, "BOM-C1")
    c2 = _make_product(auth_headers, "BOM-C2")
    bom = _create_bom(auth_headers, fg["id"], [(c1["id"], 2), (c2["id"], 3)]).json()
    assert bom["item_count"] == 2
    assert bom["product_name"] == fg["name"]
    assert bom["total_cost"] == 2 * 4.0 + 3 * 4.0
    assert client.put(f"/api/boms/{bom['id']}", json={"is_active": False}, headers=auth_headers).json()["is_active"] is False
    assert client.delete(f"/api/boms/{bom['id']}", headers=auth_headers).status_code == 204
    assert client.get(f"/api/boms/{bom['id']}", headers=auth_headers).status_code == 404


# ---------------------------------------------------------------- Work orders

def test_work_order_create_snapshots_bom_components(auth_headers):
    fg = _make_product(auth_headers, "WO-FG")
    comp = _make_product(auth_headers, "WO-COMP")
    loc = _make_location(auth_headers, "WO-LOC")
    assert _receive(auth_headers, comp["id"], 10, loc["id"]).status_code == 201
    bom = _create_bom(auth_headers, fg["id"], [(comp["id"], 2)]).json()

    wo = _create_wo(auth_headers, fg["id"], 3, bom_id=bom["id"]).json()
    assert wo["status"] == "planned"
    assert wo["wo_number"].startswith("WO-")
    assert wo["quantity"] == 3
    assert wo["total_required"] == 6
    assert wo["items"][0]["quantity_required"] == 6
    assert wo["items"][0]["quantity_issued"] == 0
    assert wo["bom_name"] == bom["name"]


def test_work_order_release_issues_components_to_wip(auth_headers):
    fg = _make_product(auth_headers, "WO-FG2")
    comp = _make_product(auth_headers, "WO-COMP2")
    loc = _make_location(auth_headers, "WO-LOC2")
    assert _receive(auth_headers, comp["id"], 10, loc["id"]).status_code == 201
    bom = _create_bom(auth_headers, fg["id"], [(comp["id"], 2)]).json()
    wo = _create_wo(auth_headers, fg["id"], 3, bom_id=bom["id"]).json()

    released = client.post(f"/api/work-orders/{wo['id']}/release", headers=auth_headers).json()
    assert released["status"] == "released"
    assert released["wip_location_id"] is not None
    assert released["items"][0]["quantity_issued"] == 6
    assert released["fully_issued"] is True
    assert client.get(f"/api/products/{comp['id']}", headers=auth_headers).json()["quantity"] == 4

    wip = client.get(f"/api/locations/{released['wip_location_id']}", headers=auth_headers).json()
    assert wip["location_type"] == "wip"


def test_work_order_release_insufficient_stock(auth_headers):
    fg = _make_product(auth_headers, "WO-FG3")
    comp = _make_product(auth_headers, "WO-COMP3")
    loc = _make_location(auth_headers, "WO-LOC3")
    assert _receive(auth_headers, comp["id"], 2, loc["id"]).status_code == 201
    bom = _create_bom(auth_headers, fg["id"], [(comp["id"], 2)]).json()
    wo = _create_wo(auth_headers, fg["id"], 3, bom_id=bom["id"]).json()

    resp = client.post(f"/api/work-orders/{wo['id']}/release", headers=auth_headers)
    assert resp.status_code == 400
    assert "insufficient" in resp.json()["detail"].lower()


def test_work_order_release_refuses_quarantined_component(auth_headers):
    fg = _make_product(auth_headers, "WO-FG4")
    comp = _make_product(auth_headers, "WO-COMP4")
    loc = _make_location(auth_headers, "WO-LOC4")
    assert _receive(auth_headers, comp["id"], 5, loc["id"], lot_number="QC-LOT").status_code == 201
    lots = client.get("/api/lots", params={"product_id": comp["id"]}, headers=auth_headers).json()
    lot_id = lots["items"][0]["id"]
    assert client.put(f"/api/lots/{lot_id}", json={"status": "quarantined"}, headers=auth_headers).status_code == 200

    bom = _create_bom(auth_headers, fg["id"], [(comp["id"], 1)]).json()
    wo = _create_wo(auth_headers, fg["id"], 3, bom_id=bom["id"]).json()
    resp = client.post(f"/api/work-orders/{wo['id']}/release", headers=auth_headers)
    assert resp.status_code == 400
    assert "insufficient" in resp.json()["detail"].lower()


def test_work_order_complete_receives_finished_good(auth_headers):
    fg = _make_product(auth_headers, "WO-FG5")
    comp = _make_product(auth_headers, "WO-COMP5")
    loc = _make_location(auth_headers, "WO-LOC5")
    out = _make_location(auth_headers, "WO-OUT5")
    assert _receive(auth_headers, comp["id"], 10, loc["id"]).status_code == 201
    bom = _create_bom(auth_headers, fg["id"], [(comp["id"], 2)]).json()
    wo = _create_wo(auth_headers, fg["id"], 3, bom_id=bom["id"]).json()
    client.post(f"/api/work-orders/{wo['id']}/release", headers=auth_headers)
    client.post(f"/api/work-orders/{wo['id']}/start", headers=auth_headers)

    done = client.post(f"/api/work-orders/{wo['id']}/complete", json={
        "receive_location_id": out["id"], "lot_number": "FG-99", "backflush": True,
    }, headers=auth_headers).json()
    assert done["status"] == "completed"
    assert done["completed_at"] is not None
    assert client.get(f"/api/products/{fg['id']}", headers=auth_headers).json()["quantity"] == 3

    fg_lots = client.get("/api/lots", params={"product_id": fg["id"]}, headers=auth_headers).json()
    assert any(l["lot_number"] == "FG-99" for l in fg_lots["items"])


def test_work_order_cancel_only_planned(auth_headers):
    fg = _make_product(auth_headers, "WO-FG6")
    wo = _create_wo(auth_headers, fg["id"], 1).json()
    assert client.post(f"/api/work-orders/{wo['id']}/cancel", headers=auth_headers).json()["status"] == "cancelled"
    resp = client.post(f"/api/work-orders/{wo['id']}/cancel", headers=auth_headers)
    assert resp.status_code == 400


def test_work_order_edit_only_when_planned(auth_headers):
    fg = _make_product(auth_headers, "WO-FG7")
    comp = _make_product(auth_headers, "WO-COMP7")
    loc = _make_location(auth_headers, "WO-LOC7")
    assert _receive(auth_headers, comp["id"], 10, loc["id"]).status_code == 201
    bom = _create_bom(auth_headers, fg["id"], [(comp["id"], 1)]).json()
    wo = _create_wo(auth_headers, fg["id"], 2, bom_id=bom["id"]).json()
    client.post(f"/api/work-orders/{wo['id']}/release", headers=auth_headers)
    resp = client.put(f"/api/work-orders/{wo['id']}", json={"notes": "nope"}, headers=auth_headers)
    assert resp.status_code == 400
    assert "planned" in resp.json()["detail"].lower()


# ---------------------------------------------------------------- Quality checks

def test_qc_fail_quarantines_lot(auth_headers):
    prod = _make_product(auth_headers, "QC-PROD")
    loc = _make_location(auth_headers, "QC-LOC")
    assert _receive(auth_headers, prod["id"], 5, loc["id"], lot_number="LOT-1").status_code == 201
    lots = client.get("/api/lots", params={"product_id": prod["id"]}, headers=auth_headers).json()
    lot_id = lots["items"][0]["id"]
    assert lots["items"][0]["status"] == "in_stock"

    qc = client.post("/api/quality-checks", json={
        "product_id": prod["id"], "lot_id": lot_id, "result": "fail",
        "notes": "off spec",
    }, headers=auth_headers).json()
    assert qc["qc_number"].startswith("QC-")
    assert client.get(f"/api/lots/{lot_id}", headers=auth_headers).json()["status"] == "quarantined"


def test_qc_pass_keeps_lot_sellable(auth_headers):
    prod = _make_product(auth_headers, "QC-PROD2")
    loc = _make_location(auth_headers, "QC-LOC2")
    assert _receive(auth_headers, prod["id"], 5, loc["id"], lot_number="LOT-2").status_code == 201
    lots = client.get("/api/lots", params={"product_id": prod["id"]}, headers=auth_headers).json()
    lot_id = lots["items"][0]["id"]
    qc = client.post("/api/quality-checks", json={
        "product_id": prod["id"], "lot_id": lot_id, "result": "pass",
    }, headers=auth_headers).json()
    assert qc["result"] == "pass"
    assert client.get(f"/api/lots/{lot_id}", headers=auth_headers).json()["status"] == "in_stock"

    sale = client.post("/api/sales", json={
        "items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 9.0}],
    }, headers=auth_headers)
    assert sale.status_code == 201


def test_qc_fail_blocks_sale(auth_headers):
    prod = _make_product(auth_headers, "QC-PROD3")
    loc = _make_location(auth_headers, "QC-LOC3")
    assert _receive(auth_headers, prod["id"], 5, loc["id"], lot_number="LOT-3").status_code == 201
    lots = client.get("/api/lots", params={"product_id": prod["id"]}, headers=auth_headers).json()
    lot_id = lots["items"][0]["id"]
    client.post("/api/quality-checks", json={
        "product_id": prod["id"], "lot_id": lot_id, "result": "fail",
    }, headers=auth_headers)

    sale = client.post("/api/sales", json={
        "items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 9.0}],
    }, headers=auth_headers)
    assert sale.status_code == 400


def test_lot_transition_validation(auth_headers):
    prod = _make_product(auth_headers, "QC-PROD4")
    loc = _make_location(auth_headers, "QC-LOC4")
    assert _receive(auth_headers, prod["id"], 5, loc["id"], lot_number="LOT-4").status_code == 201
    lots = client.get("/api/lots", params={"product_id": prod["id"]}, headers=auth_headers).json()
    lot_id = lots["items"][0]["id"]

    assert client.put(f"/api/lots/{lot_id}", json={"status": "quarantined"}, headers=auth_headers).status_code == 200
    assert client.put(f"/api/lots/{lot_id}", json={"status": "expired"}, headers=auth_headers).status_code == 200
    resp = client.put(f"/api/lots/{lot_id}", json={"status": "in_stock"}, headers=auth_headers)
    assert resp.status_code == 400
    assert "transition" in resp.json()["detail"].lower()


def test_qc_fail_on_expired_lot_rejected(auth_headers):
    prod = _make_product(auth_headers, "QC-EXPIRED")
    loc = _make_location(auth_headers, "QC-EXPIRED-LOC")
    assert _receive(auth_headers, prod["id"], 5, loc["id"], lot_number="LOT-EXP").status_code == 201
    lots = client.get("/api/lots", params={"product_id": prod["id"]}, headers=auth_headers).json()
    lot_id = lots["items"][0]["id"]
    assert client.put(f"/api/lots/{lot_id}", json={"status": "expired"}, headers=auth_headers).status_code == 200

    resp = client.post("/api/quality-checks", json={
        "product_id": prod["id"], "lot_id": lot_id, "result": "fail",
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert client.get(f"/api/lots/{lot_id}", headers=auth_headers).json()["status"] == "expired"


def test_delete_failing_qc_releases_lot_when_none_remain(auth_headers):
    prod = _make_product(auth_headers, "QC-DELETE")
    loc = _make_location(auth_headers, "QC-DELETE-LOC")
    assert _receive(auth_headers, prod["id"], 5, loc["id"], lot_number="LOT-DEL").status_code == 201
    lots = client.get("/api/lots", params={"product_id": prod["id"]}, headers=auth_headers).json()
    lot_id = lots["items"][0]["id"]

    qc1 = client.post("/api/quality-checks", json={
        "product_id": prod["id"], "lot_id": lot_id, "result": "fail",
    }, headers=auth_headers).json()
    qc2 = client.post("/api/quality-checks", json={
        "product_id": prod["id"], "lot_id": lot_id, "result": "fail",
    }, headers=auth_headers).json()
    assert client.get(f"/api/lots/{lot_id}", headers=auth_headers).json()["status"] == "quarantined"

    assert client.delete(f"/api/quality-checks/{qc1['id']}", headers=auth_headers).status_code == 204
    assert client.get(f"/api/lots/{lot_id}", headers=auth_headers).json()["status"] == "quarantined"

    assert client.delete(f"/api/quality-checks/{qc2['id']}", headers=auth_headers).status_code == 204
    assert client.get(f"/api/lots/{lot_id}", headers=auth_headers).json()["status"] == "in_stock"


def test_qc_fail_then_pass_releases_lot(auth_headers):
    prod = _make_product(auth_headers, "QC-RELEASE")
    loc = _make_location(auth_headers, "QC-RELEASE-LOC")
    assert _receive(auth_headers, prod["id"], 5, loc["id"], lot_number="LOT-REL").status_code == 201
    lots = client.get("/api/lots", params={"product_id": prod["id"]}, headers=auth_headers).json()
    lot_id = lots["items"][0]["id"]

    qc = client.post("/api/quality-checks", json={
        "product_id": prod["id"], "lot_id": lot_id, "result": "fail",
    }, headers=auth_headers).json()
    assert client.get(f"/api/lots/{lot_id}", headers=auth_headers).json()["status"] == "quarantined"

    assert client.put(f"/api/quality-checks/{qc['id']}", json={"result": "pass"}, headers=auth_headers).status_code == 200
    assert client.get(f"/api/lots/{lot_id}", headers=auth_headers).json()["status"] == "in_stock"


def test_qc_pass_keeps_quarantine_when_another_fail_exists(auth_headers):
    prod = _make_product(auth_headers, "QC-MULTI")
    loc = _make_location(auth_headers, "QC-MULTI-LOC")
    assert _receive(auth_headers, prod["id"], 5, loc["id"], lot_number="LOT-MULTI").status_code == 201
    lots = client.get("/api/lots", params={"product_id": prod["id"]}, headers=auth_headers).json()
    lot_id = lots["items"][0]["id"]

    qc1 = client.post("/api/quality-checks", json={
        "product_id": prod["id"], "lot_id": lot_id, "result": "fail",
    }, headers=auth_headers).json()
    qc2 = client.post("/api/quality-checks", json={
        "product_id": prod["id"], "lot_id": lot_id, "result": "fail",
    }, headers=auth_headers).json()

    assert client.put(f"/api/quality-checks/{qc1['id']}", json={"result": "pass"}, headers=auth_headers).status_code == 200
    assert client.get(f"/api/lots/{lot_id}", headers=auth_headers).json()["status"] == "quarantined"

    assert client.put(f"/api/quality-checks/{qc2['id']}", json={"result": "pass"}, headers=auth_headers).status_code == 200
    assert client.get(f"/api/lots/{lot_id}", headers=auth_headers).json()["status"] == "in_stock"


# ---------------------------------------------------------------- Trace

def test_trace_returns_movements_and_work_orders(auth_headers):
    fg = _make_product(auth_headers, "TR-FG")
    comp = _make_product(auth_headers, "TR-COMP")
    loc = _make_location(auth_headers, "TR-LOC")
    out = _make_location(auth_headers, "TR-OUT")
    assert _receive(auth_headers, comp["id"], 10, loc["id"], lot_number="TR-LOT").status_code == 201
    bom = _create_bom(auth_headers, fg["id"], [(comp["id"], 2)]).json()
    wo = _create_wo(auth_headers, fg["id"], 3, bom_id=bom["id"]).json()
    client.post(f"/api/work-orders/{wo['id']}/release", headers=auth_headers)
    client.post(f"/api/work-orders/{wo['id']}/complete", json={
        "receive_location_id": out["id"], "backflush": True,
    }, headers=auth_headers)

    fg_trace = client.get(f"/api/products/{fg['id']}/trace", headers=auth_headers).json()
    assert fg_trace["product_name"] == fg["name"]
    assert any(m["movement_type"] == "receive" and m["quantity_change"] == 3 for m in fg_trace["incoming"])
    assert any(wo_["role"] == "produced" for wo_ in fg_trace["work_orders"])

    comp_trace = client.get(f"/api/products/{comp['id']}/trace", headers=auth_headers).json()
    assert any(m["movement_type"] == "issue" and m["reference"] == wo["wo_number"] for m in comp_trace["outgoing"])
    assert any(wo_["role"] == "consumed" and wo_["wo_number"] == wo["wo_number"] for wo_ in comp_trace["work_orders"])


# ---------------------------------------------------------------- PDF

def test_work_order_pdf_generated(auth_headers):
    fg = _make_product(auth_headers, "WO-PDF-FG")
    comp = _make_product(auth_headers, "WO-PDF-COMP")
    loc = _make_location(auth_headers, "WO-PDF-LOC")
    assert _receive(auth_headers, comp["id"], 10, loc["id"]).status_code == 201
    wo = _create_wo(auth_headers, fg["id"], 2, items=[
        {"product_id": comp["id"], "quantity_required": 3},
    ]).json()
    resp = client.get(f"/api/work-orders/{wo['id']}/pdf", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert wo["wo_number"] in resp.headers["content-disposition"]


def test_work_order_pdf_not_found(auth_headers):
    assert client.get("/api/work-orders/99999/pdf", headers=auth_headers).status_code == 404
