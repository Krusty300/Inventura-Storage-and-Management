from tests.conftest import client


def _make_product(auth_headers, sku, price=10.0, cost=4.0, serialized=False):
    return client.post("/api/products", json={
        "location_id": 1, "sku": sku, "name": sku, "unit_price": price,
        "cost_price": cost, "quantity": 0, "is_serialized": serialized,
    }, headers=auth_headers).json()


def _make_location(auth_headers, code, location_type="bin"):
    return client.post("/api/locations", json={
        "code": code, "name": code, "location_type": location_type,
    }, headers=auth_headers).json()


def _receive(auth_headers, product_id, quantity, location_id, lot_number=""):
    return client.post("/api/receipts", json={
        "items": [{"product_id": product_id, "quantity": quantity,
                   "location_id": location_id, "lot_number": lot_number}],
    }, headers=auth_headers)


def _create_kit(auth_headers, product_id, components, name="", discount_type="fixed", discount_value=0.0):
    payload = {
        "product_id": product_id,
        "name": name,
        "discount_type": discount_type,
        "discount_value": discount_value,
        "items": [{"product_id": pid, "quantity": qty} for pid, qty in components],
    }
    return client.post("/api/kits", json=payload, headers=auth_headers)


# ---------------------------------------------------------------- CRUD

def test_kit_create_and_cycle_detection_direct(auth_headers):
    a = _make_product(auth_headers, "KIT-A")
    resp = _create_kit(auth_headers, a["id"], [(a["id"], 1)])
    assert resp.status_code == 400
    assert "cycle" in resp.json()["detail"].lower()


def test_kit_create_and_cycle_detection_multi_level(auth_headers):
    a = _make_product(auth_headers, "KIT-MA")
    b = _make_product(auth_headers, "KIT-MB")
    c = _make_product(auth_headers, "KIT-MC")
    assert _create_kit(auth_headers, a["id"], [(b["id"], 2)]).status_code == 201
    assert _create_kit(auth_headers, b["id"], [(c["id"], 1)]).status_code == 201
    resp = _create_kit(auth_headers, c["id"], [(a["id"], 1)])
    assert resp.status_code == 400
    assert "cycle" in resp.json()["detail"].lower()


def test_kit_crud_and_pricing(auth_headers):
    out = _make_product(auth_headers, "KIT-OUT")
    c1 = _make_product(auth_headers, "KIT-C1", price=10.0, cost=4.0)
    c2 = _make_product(auth_headers, "KIT-C2", price=5.0, cost=2.0)
    kit = _create_kit(auth_headers, out["id"], [(c1["id"], 2), (c2["id"], 3)], name="Starter Kit").json()
    assert kit["item_count"] == 2
    assert kit["product_name"] == out["name"]
    assert kit["name"] == "Starter Kit"
    assert kit["total_cost"] == 2 * 4.0 + 3 * 2.0
    assert kit["retail_value"] == 2 * 10.0 + 3 * 5.0
    assert kit["bundle_price"] == kit["retail_value"]  # fixed discount 0

    pct = _create_kit(auth_headers, out["id"], [(c1["id"], 1)], name="Percent Kit",
                      discount_type="percentage", discount_value=20).json()
    assert pct["bundle_price"] == round(10.0 * 0.8, 2)
    assert pct["savings"] == round(10.0 - 8.0, 2)

    fixed = _create_kit(auth_headers, out["id"], [(c1["id"], 1)], name="Fixed Kit",
                        discount_type="fixed", discount_value=3).json()
    assert fixed["bundle_price"] == 7.0

    # Update, deactivate, delete
    assert client.put(f"/api/kits/{kit['id']}", json={"is_active": False}, headers=auth_headers).json()["is_active"] is False
    assert client.put(f"/api/kits/{kit['id']}", json={"discount_value": 5}, headers=auth_headers).json()["bundle_price"] == kit["retail_value"] - 5
    assert client.delete(f"/api/kits/{kit['id']}", headers=auth_headers).status_code == 204
    assert client.get(f"/api/kits/{kit['id']}", headers=auth_headers).status_code == 404


def test_kit_invalid_discount(auth_headers):
    out = _make_product(auth_headers, "KIT-DISC-OUT")
    comp = _make_product(auth_headers, "KIT-DISC-COMP")
    resp = _create_kit(auth_headers, out["id"], [(comp["id"], 1)],
                       discount_type="percentage", discount_value=150).json()
    resp = client.post("/api/kits", json={
        "product_id": out["id"],
        "discount_type": "percentage",
        "discount_value": 150,
        "items": [{"product_id": comp["id"], "quantity": 1}],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "0 and 100" in resp.json()["detail"]


def test_kit_rejects_duplicate_components(auth_headers):
    out = _make_product(auth_headers, "KIT-DUP-OUT")
    comp = _make_product(auth_headers, "KIT-DUP-COMP")
    resp = client.post("/api/kits", json={
        "product_id": out["id"],
        "items": [{"product_id": comp["id"], "quantity": 1}, {"product_id": comp["id"], "quantity": 2}],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "once" in resp.json()["detail"].lower()


# ---------------------------------------------------------------- Assembly

def test_kit_assembly_consumes_components_and_receives_output(auth_headers):
    loc = _make_location(auth_headers, "KIT-LOC")
    out = _make_product(auth_headers, "KIT-ASM-OUT")
    c1 = _make_product(auth_headers, "KIT-ASM-C1")
    c2 = _make_product(auth_headers, "KIT-ASM-C2")
    assert _receive(auth_headers, c1["id"], 10, loc["id"]).status_code == 201
    assert _receive(auth_headers, c2["id"], 15, loc["id"]).status_code == 201
    kit = _create_kit(auth_headers, out["id"], [(c1["id"], 2), (c2["id"], 3)]).json()

    resp = client.post(f"/api/kits/{kit['id']}/assemble", json={
        "quantity": 3, "location_id": loc["id"],
    }, headers=auth_headers)
    assert resp.status_code == 200
    assert client.get(f"/api/products/{out['id']}", headers=auth_headers).json()["quantity"] == 3
    assert client.get(f"/api/products/{c1['id']}", headers=auth_headers).json()["quantity"] == 4
    assert client.get(f"/api/products/{c2['id']}", headers=auth_headers).json()["quantity"] == 6


def test_kit_assembly_insufficient_stock(auth_headers):
    loc = _make_location(auth_headers, "KIT-LOC2")
    out = _make_product(auth_headers, "KIT-ASM2-OUT")
    comp = _make_product(auth_headers, "KIT-ASM2-COMP")
    assert _receive(auth_headers, comp["id"], 3, loc["id"]).status_code == 201
    kit = _create_kit(auth_headers, out["id"], [(comp["id"], 2)]).json()

    resp = client.post(f"/api/kits/{kit['id']}/assemble", json={"quantity": 2}, headers=auth_headers)
    assert resp.status_code == 400
    assert "insufficient" in resp.json()["detail"].lower()
    # No partial output should exist.
    assert client.get(f"/api/products/{out['id']}", headers=auth_headers).json()["quantity"] == 0


def test_kit_disassembly_restores_components(auth_headers):
    loc = _make_location(auth_headers, "KIT-LOC3")
    out = _make_product(auth_headers, "KIT-DIS-OUT")
    comp = _make_product(auth_headers, "KIT-DIS-COMP")
    assert _receive(auth_headers, comp["id"], 10, loc["id"]).status_code == 201
    kit = _create_kit(auth_headers, out["id"], [(comp["id"], 2)]).json()
    client.post(f"/api/kits/{kit['id']}/assemble", json={"quantity": 3, "location_id": loc["id"]}, headers=auth_headers)

    resp = client.post(f"/api/kits/{kit['id']}/disassemble", json={"quantity": 1, "location_id": loc["id"]}, headers=auth_headers)
    assert resp.status_code == 200
    assert client.get(f"/api/products/{out['id']}", headers=auth_headers).json()["quantity"] == 2
    assert client.get(f"/api/products/{comp['id']}", headers=auth_headers).json()["quantity"] == 6


def test_kit_disassembly_insufficient_output(auth_headers):
    loc = _make_location(auth_headers, "KIT-LOC4")
    out = _make_product(auth_headers, "KIT-DIS2-OUT")
    comp = _make_product(auth_headers, "KIT-DIS2-COMP")
    assert _receive(auth_headers, comp["id"], 10, loc["id"]).status_code == 201
    kit = _create_kit(auth_headers, out["id"], [(comp["id"], 2)]).json()

    resp = client.post(f"/api/kits/{kit['id']}/disassemble", json={"quantity": 1}, headers=auth_headers)
    assert resp.status_code == 400
    assert "insufficient" in resp.json()["detail"].lower()


def test_kit_inactive_cannot_assemble(auth_headers):
    out = _make_product(auth_headers, "KIT-INACTIVE-OUT")
    comp = _make_product(auth_headers, "KIT-INACTIVE-COMP")
    assert _receive(auth_headers, comp["id"], 10, 1).status_code == 201
    kit = _create_kit(auth_headers, out["id"], [(comp["id"], 1)]).json()
    client.put(f"/api/kits/{kit['id']}", json={"is_active": False}, headers=auth_headers)
    resp = client.post(f"/api/kits/{kit['id']}/assemble", json={"quantity": 1}, headers=auth_headers)
    assert resp.status_code == 400
    assert "inactive" in resp.json()["detail"].lower()


def test_kit_serialized_output_rejected(auth_headers):
    out = _make_product(auth_headers, "KIT-SER-OUT", serialized=True)
    comp = _make_product(auth_headers, "KIT-SER-COMP")
    assert _receive(auth_headers, comp["id"], 10, 1).status_code == 201
    kit = _create_kit(auth_headers, out["id"], [(comp["id"], 1)]).json()
    resp = client.post(f"/api/kits/{kit['id']}/assemble", json={"quantity": 1}, headers=auth_headers)
    assert resp.status_code == 400
    assert "serialized" in resp.json()["detail"].lower()


def test_kit_list_search_and_filter(auth_headers):
    out1 = _make_product(auth_headers, "KIT-LIST-OUT1")
    out2 = _make_product(auth_headers, "KIT-LIST-OUT2")
    comp = _make_product(auth_headers, "KIT-LIST-COMP")
    _create_kit(auth_headers, out1["id"], [(comp["id"], 1)], name="Alpha Kit")
    _create_kit(auth_headers, out2["id"], [(comp["id"], 1)], name="Beta Kit")
    client.put(f"/api/kits/{client.get('/api/kits', headers=auth_headers).json()['items'][1]['id']}",
               json={"is_active": False}, headers=auth_headers)

    all_kits = client.get("/api/kits", headers=auth_headers).json()
    assert all_kits["total"] == 2
    active = client.get("/api/kits", params={"is_active": "true"}, headers=auth_headers).json()
    assert active["total"] == 1
    searched = client.get("/api/kits", params={"search": "beta"}, headers=auth_headers).json()
    assert searched["total"] == 1
    assert searched["items"][0]["name"] == "Beta Kit"