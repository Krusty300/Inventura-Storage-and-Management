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


def _receive_serials(auth_headers, product_id, location_id, serials, lot_number=""):
    return client.post("/api/receipts", json={
        "items": [{
            "product_id": product_id,
            "quantity": len(serials),
            "location_id": location_id,
            "lot_number": lot_number,
            "serial_numbers": serials,
        }],
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


def _list_serials(auth_headers, product_id):
    return client.get(f"/api/serial-numbers?product_id={product_id}&limit=200", headers=auth_headers).json()["items"]


# ------------------------------------------------------- Serialized components

def test_serialized_component_issued_to_wip_on_release(auth_headers):
    fg = _make_product(auth_headers, "SC-FG")
    comp = _make_product(auth_headers, "SC-COMP", serialized=True)
    loc = _make_location(auth_headers, "SC-LOC")
    assert _receive_serials(auth_headers, comp["id"], loc["id"], ["C001", "C002"]).status_code == 201
    bom = _create_bom(auth_headers, fg["id"], [(comp["id"], 2)]).json()
    wo = _create_wo(auth_headers, fg["id"], 1, bom_id=bom["id"]).json()

    released = client.post(f"/api/work-orders/{wo['id']}/release", headers=auth_headers)
    assert released.status_code == 200
    released = released.json()
    assert released["items"][0]["quantity_issued"] == 2
    assert client.get(f"/api/products/{comp['id']}", headers=auth_headers).json()["quantity"] == 0
    serials = _list_serials(auth_headers, comp["id"])
    assert {s["serial_number"] for s in serials} == {"C001", "C002"}
    assert all(s["status"] == "reserved" for s in serials)


def test_serialized_component_insufficient_stock(auth_headers):
    fg = _make_product(auth_headers, "SC-FG2")
    comp = _make_product(auth_headers, "SC-COMP2", serialized=True)
    loc = _make_location(auth_headers, "SC-LOC2")
    assert _receive_serials(auth_headers, comp["id"], loc["id"], ["C003"]).status_code == 201
    bom = _create_bom(auth_headers, fg["id"], [(comp["id"], 2)]).json()
    wo = _create_wo(auth_headers, fg["id"], 1, bom_id=bom["id"]).json()

    released = client.post(f"/api/work-orders/{wo['id']}/release", headers=auth_headers)
    assert released.status_code == 400
    assert "insufficient" in released.json()["detail"].lower()


# ------------------------------------------------------- Serialized output

def test_serialized_output_completed_with_serials(auth_headers):
    fg = _make_product(auth_headers, "SO-FG", serialized=True)
    comp = _make_product(auth_headers, "SO-COMP")
    loc = _make_location(auth_headers, "SO-LOC")
    assert _receive(auth_headers, comp["id"], 10, loc["id"], lot_number="L-1").status_code == 201
    bom = _create_bom(auth_headers, fg["id"], [(comp["id"], 2)]).json()
    wo = _create_wo(auth_headers, fg["id"], 2, bom_id=bom["id"]).json()
    client.post(f"/api/work-orders/{wo['id']}/release", headers=auth_headers)

    completed = client.post(f"/api/work-orders/{wo['id']}/complete", json={
        "receive_location_id": loc["id"],
        "lot_number": "FG-LOT",
        "serial_numbers": ["FG001", "FG002"],
    }, headers=auth_headers)
    assert completed.status_code == 200
    assert completed.json()["status"] == "completed"
    assert client.get(f"/api/products/{fg['id']}", headers=auth_headers).json()["quantity"] == 2

    serials = _list_serials(auth_headers, fg["id"])
    assert {s["serial_number"] for s in serials} == {"FG001", "FG002"}
    assert all(s["status"] == "in_stock" for s in serials)
    assert all(s["lot_number"] == "FG-LOT" for s in serials)

    gene = client.get(f"/api/work-orders/{wo['id']}/genealogy", headers=auth_headers).json()
    assert gene["fg_lots"] and gene["fg_lots"][0]["lot_number"] == "FG-LOT"
    assert len(gene["links"]) == 1
    assert gene["links"][0]["parent_lot_number"] == "L-1"
    assert gene["links"][0]["child_lot_number"] == "FG-LOT"


def test_serialized_output_requires_serials(auth_headers):
    fg = _make_product(auth_headers, "SO-FG2", serialized=True)
    comp = _make_product(auth_headers, "SO-COMP2")
    loc = _make_location(auth_headers, "SO-LOC2")
    assert _receive(auth_headers, comp["id"], 10, loc["id"]).status_code == 201
    bom = _create_bom(auth_headers, fg["id"], [(comp["id"], 1)]).json()
    wo = _create_wo(auth_headers, fg["id"], 1, bom_id=bom["id"]).json()
    client.post(f"/api/work-orders/{wo['id']}/release", headers=auth_headers)

    completed = client.post(f"/api/work-orders/{wo['id']}/complete", json={
        "receive_location_id": loc["id"],
    }, headers=auth_headers)
    assert completed.status_code == 400
    assert "serialized" in completed.json()["detail"].lower()


def test_serialized_output_serial_count_mismatch(auth_headers):
    fg = _make_product(auth_headers, "SO-FG3", serialized=True)
    comp = _make_product(auth_headers, "SO-COMP3")
    loc = _make_location(auth_headers, "SO-LOC3")
    assert _receive(auth_headers, comp["id"], 10, loc["id"]).status_code == 201
    bom = _create_bom(auth_headers, fg["id"], [(comp["id"], 1)]).json()
    wo = _create_wo(auth_headers, fg["id"], 3, bom_id=bom["id"]).json()
    client.post(f"/api/work-orders/{wo['id']}/release", headers=auth_headers)

    completed = client.post(f"/api/work-orders/{wo['id']}/complete", json={
        "receive_location_id": loc["id"],
        "serial_numbers": ["FG001"],
    }, headers=auth_headers)
    assert completed.status_code == 400
    assert "match" in completed.json()["detail"].lower()


def test_serialized_output_rejects_duplicate_serial(auth_headers):
    fg = _make_product(auth_headers, "SO-FG4", serialized=True)
    comp = _make_product(auth_headers, "SO-COMP4")
    loc = _make_location(auth_headers, "SO-LOC4")
    assert _receive(auth_headers, comp["id"], 10, loc["id"]).status_code == 201
    bom = _create_bom(auth_headers, fg["id"], [(comp["id"], 1)]).json()
    wo = _create_wo(auth_headers, fg["id"], 2, bom_id=bom["id"]).json()
    client.post(f"/api/work-orders/{wo['id']}/release", headers=auth_headers)

    completed = client.post(f"/api/work-orders/{wo['id']}/complete", json={
        "receive_location_id": loc["id"],
        "serial_numbers": ["FG001", "FG001"],
    }, headers=auth_headers)
    assert completed.status_code == 400
    assert "duplicate" in completed.json()["detail"].lower()


def test_serialized_output_rejects_registered_serial(auth_headers):
    fg = _make_product(auth_headers, "SO-FG5", serialized=True)
    comp = _make_product(auth_headers, "SO-COMP5")
    loc = _make_location(auth_headers, "SO-LOC5")
    assert _receive_serials(auth_headers, fg["id"], loc["id"], ["USED-1"]).status_code == 201
    assert _receive(auth_headers, comp["id"], 10, loc["id"]).status_code == 201
    bom = _create_bom(auth_headers, fg["id"], [(comp["id"], 1)]).json()
    wo = _create_wo(auth_headers, fg["id"], 1, bom_id=bom["id"]).json()
    client.post(f"/api/work-orders/{wo['id']}/release", headers=auth_headers)

    completed = client.post(f"/api/work-orders/{wo['id']}/complete", json={
        "receive_location_id": loc["id"],
        "serial_numbers": ["USED-1"],
    }, headers=auth_headers)
    assert completed.status_code == 400
    assert "already registered" in completed.json()["detail"].lower()


# ------------------------------------------------------- Genealogy

def test_serialized_output_links_to_serialized_component_serial(auth_headers):
    fg = _make_product(auth_headers, "SG-FG", serialized=True)
    comp = _make_product(auth_headers, "SG-COMP", serialized=True)
    loc = _make_location(auth_headers, "SG-LOC")
    assert _receive_serials(auth_headers, comp["id"], loc["id"], ["S-01"], lot_number="SL-1").status_code == 201
    bom = _create_bom(auth_headers, fg["id"], [(comp["id"], 1)]).json()
    wo = _create_wo(auth_headers, fg["id"], 1, bom_id=bom["id"]).json()
    client.post(f"/api/work-orders/{wo['id']}/release", headers=auth_headers)

    completed = client.post(f"/api/work-orders/{wo['id']}/complete", json={
        "receive_location_id": loc["id"],
        "lot_number": "FG-SLOT",
        "serial_numbers": ["F-01"],
    }, headers=auth_headers)
    assert completed.status_code == 200

    comp_serials = _list_serials(auth_headers, comp["id"])
    assert comp_serials[0]["status"] == "reserved"

    gene = client.get(f"/api/work-orders/{wo['id']}/genealogy", headers=auth_headers).json()
    assert gene["component_lots"] and gene["component_lots"][0]["lot_number"] == "SL-1"
    assert gene["links"][0]["parent_lot_number"] == "SL-1"

    recall = client.get(f"/api/lots/{gene['fg_lots'][0]['lot_id']}/genealogy", headers=auth_headers).json()
    assert recall["lot_number"] == "FG-SLOT"
    assert recall["parents"][0]["lot_number"] == "SL-1"
