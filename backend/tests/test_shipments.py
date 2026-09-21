from tests.conftest import client


def _make_location(auth_headers, code, location_type="bin"):
    return client.post("/api/locations", json={
        "code": code, "name": code, "location_type": location_type,
    }, headers=auth_headers).json()


def _make_product(auth_headers, sku, serialized=False, cost=4.0):
    return client.post("/api/products", json={"location_id": 1, 
        "sku": sku, "name": sku, "unit_price": 10.0, "cost_price": cost, "quantity": 0,
        "is_serialized": serialized,
    }, headers=auth_headers).json()


def _receive(auth_headers, product_id, quantity, location_id, lot_number=""):
    return client.post("/api/receipts", json={
        "items": [{"product_id": product_id, "quantity": quantity,
                   "location_id": location_id, "lot_number": lot_number}],
    }, headers=auth_headers)


def _receive_serials(auth_headers, product_id, location_id, serials):
    return client.post("/api/receipts", json={
        "items": [{
            "product_id": product_id,
            "quantity": len(serials),
            "location_id": location_id,
            "serial_numbers": serials,
        }],
    }, headers=auth_headers)


def _create_shipment(auth_headers, items, customer_id=None, sale_id=None):
    payload = {"items": [{"product_id": pid, "quantity": qty} for pid, qty in items]}
    if customer_id is not None:
        payload["customer_id"] = customer_id
    if sale_id is not None:
        payload["sale_id"] = sale_id
    return client.post("/api/shipments", json=payload, headers=auth_headers)


def test_shipment_create_rejects_insufficient_stock(auth_headers):
    p = _make_product(auth_headers, "SHP-P")
    resp = _create_shipment(auth_headers, [(p["id"], 5)])
    assert resp.status_code == 400
    assert "insufficient" in resp.json()["detail"].lower()


def test_shipment_create_rejects_quarantined_stock(auth_headers):
    p = _make_product(auth_headers, "SHP-QLOC")
    loc = _make_location(auth_headers, "SHP-QLOC")
    assert _receive(auth_headers, p["id"], 5, loc["id"], lot_number="Q-LOT").status_code == 201
    lots = client.get("/api/lots", params={"product_id": p["id"]}, headers=auth_headers).json()
    lot_id = lots["items"][0]["id"]
    assert client.put(f"/api/lots/{lot_id}", json={"status": "quarantined"}, headers=auth_headers).status_code == 200

    resp = _create_shipment(auth_headers, [(p["id"], 2)])
    assert resp.status_code == 400
    assert "insufficient" in resp.json()["detail"].lower()


def test_shipment_full_flow(auth_headers):
    p1 = _make_product(auth_headers, "SHP-P1")
    p2 = _make_product(auth_headers, "SHP-P2")
    loc = _make_location(auth_headers, "SHP-LOC")
    assert _receive(auth_headers, p1["id"], 10, loc["id"], lot_number="LOT-A").status_code == 201
    assert _receive(auth_headers, p2["id"], 5, loc["id"], lot_number="LOT-B").status_code == 201

    created = _create_shipment(auth_headers, [(p1["id"], 4), (p2["id"], 3)])
    assert created.status_code == 201
    shipment = created.json()
    assert shipment["shipment_number"].startswith("SHP-")
    assert shipment["status"] == "draft"
    assert shipment["total_quantity"] == 7

    picked = client.post(f"/api/shipments/{shipment['id']}/pick", headers=auth_headers)
    assert picked.status_code == 200
    picked = picked.json()
    assert picked["status"] == "picking"
    assert picked["total_picked"] == 7
    assert picked["staging_location_id"] is not None
    assert all(i["quantity_picked"] == i["quantity_ordered"] for i in picked["items"])
    # picked stock now lives in the shipping staging location
    staging = picked["staging_location_id"]
    assert client.get(f"/api/locations/{staging}", headers=auth_headers).json()["location_type"] == "shipping"

    packed = client.post(f"/api/shipments/{shipment['id']}/pack", headers=auth_headers).json()
    assert packed["status"] == "packed"
    assert all(i["quantity_packed"] == i["quantity_ordered"] for i in packed["items"])

    shipped = client.post(f"/api/shipments/{shipment['id']}/ship?carrier=UPS&tracking_number=1Z999", headers=auth_headers)
    assert shipped.status_code == 200
    shipped = shipped.json()
    assert shipped["status"] == "shipped"
    assert shipped["carrier"] == "UPS"
    assert shipped["tracking_number"] == "1Z999"
    assert all(i["quantity_shipped"] == i["quantity_ordered"] for i in shipped["items"])

    # stock fully decremented from staging
    assert client.get(f"/api/products/{p1['id']}", headers=auth_headers).json()["quantity"] == 6
    assert client.get(f"/api/products/{p2['id']}", headers=auth_headers).json()["quantity"] == 2


def test_shipment_serialized_flow(auth_headers):
    p = _make_product(auth_headers, "SHP-SER", serialized=True)
    loc = _make_location(auth_headers, "SHP-SER-LOC")
    assert _receive_serials(auth_headers, p["id"], loc["id"], ["S01", "S02", "S03"]).status_code == 201

    created = _create_shipment(auth_headers, [(p["id"], 2)]).json()
    picked = client.post(f"/api/shipments/{created['id']}/pick", headers=auth_headers).json()
    assert picked["total_picked"] == 2
    assert picked["items"][0]["is_serialized"] is True

    shipped = client.post(f"/api/shipments/{created['id']}/ship", headers=auth_headers)
    assert shipped.status_code == 200
    assert shipped.json()["status"] == "shipped"
    assert client.get(f"/api/products/{p['id']}", headers=auth_headers).json()["quantity"] == 1
    serials = client.get(f"/api/serial-numbers?product_id={p['id']}&limit=10", headers=auth_headers).json()["items"]
    sold = [s for s in serials if s["status"] == "sold"]
    assert len(sold) == 2
    in_stock = [s for s in serials if s["status"] == "in_stock"]
    assert len(in_stock) == 1


def test_shipment_serialized_lot_marked_sold_when_depleted(auth_headers):
    p = _make_product(auth_headers, "SHP-SER-LOT", serialized=True)
    loc = _make_location(auth_headers, "SHP-SER-LOT-LOC")
    resp = client.post("/api/receipts", json={
        "items": [{
            "product_id": p["id"], "quantity": 3, "location_id": loc["id"],
            "lot_number": "LOT-SER-1", "serial_numbers": ["SL1", "SL2", "SL3"],
        }],
    }, headers=auth_headers)
    assert resp.status_code == 201

    def _lot():
        return client.get("/api/lots", params={"product_id": p["id"]}, headers=auth_headers).json()["items"][0]

    assert _lot()["status"] == "in_stock"
    assert _lot()["serial_count"] == 3

    # partial shipment keeps the lot in stock
    created = _create_shipment(auth_headers, [(p["id"], 2)]).json()
    assert client.post(f"/api/shipments/{created['id']}/pick", headers=auth_headers).status_code == 200
    assert client.post(f"/api/shipments/{created['id']}/ship", headers=auth_headers).status_code == 200
    assert _lot()["status"] == "in_stock"
    assert _lot()["serial_count"] == 1

    # shipping the last serial flips the lot to sold
    created = _create_shipment(auth_headers, [(p["id"], 1)]).json()
    assert client.post(f"/api/shipments/{created['id']}/pick", headers=auth_headers).status_code == 200
    assert client.post(f"/api/shipments/{created['id']}/ship", headers=auth_headers).status_code == 200
    lot = _lot()
    assert lot["status"] == "sold"
    assert lot["serial_count"] == 0
    assert client.get(f"/api/products/{p['id']}", headers=auth_headers).json()["quantity"] == 0

    # sold lots have no manual transitions
    assert client.put(f"/api/lots/{lot['id']}", json={"status": "in_stock"}, headers=auth_headers).status_code == 400


def test_shipment_auto_allocate_reserves_stock_on_create(auth_headers):
    client.put("/api/settings", json={"auto_allocate_stock": True}, headers=auth_headers)
    p = _make_product(auth_headers, "SHP-AUTO")
    loc = _make_location(auth_headers, "SHP-AUTO-LOC")
    assert _receive(auth_headers, p["id"], 10, loc["id"], lot_number="LOT-AUTO").status_code == 201

    created = _create_shipment(auth_headers, [(p["id"], 4)])
    assert created.status_code == 201
    shipment = created.json()
    assert shipment["status"] == "picking"
    assert shipment["total_picked"] == 4
    assert shipment["staging_location_id"] is not None
    assert all(i["quantity_picked"] == i["quantity_ordered"] for i in shipment["items"])

    # stock is reserved immediately: moved out of the source location to staging
    assert client.get(f"/api/locations/{loc['id']}", headers=auth_headers).json()["total_quantity"] == 6

    # re-picking is a no-op (nothing outstanding)
    picked = client.post(f"/api/shipments/{shipment['id']}/pick", headers=auth_headers)
    assert picked.status_code == 200
    assert picked.json()["total_picked"] == 4

    # shipping decrements on-hand as usual
    shipped = client.post(f"/api/shipments/{shipment['id']}/ship", headers=auth_headers)
    assert shipped.status_code == 200
    assert client.get(f"/api/products/{p['id']}", headers=auth_headers).json()["quantity"] == 6


def test_shipment_auto_allocate_returns_stock_on_cancel(auth_headers):
    client.put("/api/settings", json={"auto_allocate_stock": True}, headers=auth_headers)
    p = _make_product(auth_headers, "SHP-AUTO-RET")
    loc = _make_location(auth_headers, "SHP-AUTO-RET-LOC")
    assert _receive(auth_headers, p["id"], 10, loc["id"]).status_code == 201
    created = _create_shipment(auth_headers, [(p["id"], 4)]).json()

    cancelled = client.post(f"/api/shipments/{created['id']}/cancel", headers=auth_headers)
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"
    assert cancelled.json()["staging_location_id"] is None
    assert all(i["quantity_picked"] == 0 for i in cancelled.json()["items"])
    assert client.get(f"/api/locations/{loc['id']}", headers=auth_headers).json()["total_quantity"] == 10


def test_shipment_auto_allocate_disabled_keeps_draft(auth_headers):
    client.put("/api/settings", json={"auto_allocate_stock": False}, headers=auth_headers)
    p = _make_product(auth_headers, "SHP-NOAU")
    loc = _make_location(auth_headers, "SHP-NOAU-LOC")
    assert _receive(auth_headers, p["id"], 10, loc["id"]).status_code == 201
    created = _create_shipment(auth_headers, [(p["id"], 4)])
    assert created.status_code == 201
    shipment = created.json()
    assert shipment["status"] == "draft"
    assert shipment["total_picked"] == 0
    assert shipment["staging_location_id"] is None
    assert client.get(f"/api/locations/{loc['id']}", headers=auth_headers).json()["total_quantity"] == 10


def test_shipment_auto_allocate_skips_serialized_units(auth_headers):
    client.put("/api/settings", json={"auto_allocate_stock": True}, headers=auth_headers)
    p = _make_product(auth_headers, "SHP-AUTOSER", serialized=True)
    loc = _make_location(auth_headers, "SHP-AUTOSER-LOC")
    assert _receive_serials(auth_headers, p["id"], loc["id"], ["AS1", "AS2"]).status_code == 201

    created = _create_shipment(auth_headers, [(p["id"], 2)])
    assert created.status_code == 201
    shipment = created.json()
    # serialized lines are left for manual serial selection, not FEFO auto-picked
    assert shipment["status"] == "draft"
    assert shipment["total_picked"] == 0
    assert shipment["staging_location_id"] is None
    assert client.get(f"/api/locations/{loc['id']}", headers=auth_headers).json()["total_quantity"] == 2

    # the manual pick flow picks the exact serials
    serials = client.get(f"/api/serial-numbers?product_id={p['id']}&limit=10", headers=auth_headers).json()["items"]
    ids = [s["id"] for s in serials]
    picked = client.post(f"/api/shipments/{shipment['id']}/pick", json={
        "items": [{"product_id": p["id"], "serial_ids": ids}],
    }, headers=auth_headers)
    assert picked.status_code == 200
    assert picked.json()["status"] == "picking"
    assert picked.json()["total_picked"] == 2


def test_pick_duplicate_product_lines_by_item_id(auth_headers):
    p = _make_product(auth_headers, "SHP-DUPI", serialized=True)
    loc_a = _make_location(auth_headers, "SHP-DUPI-A")
    loc_b = _make_location(auth_headers, "SHP-DUPI-B")
    assert _receive_serials(auth_headers, p["id"], loc_a["id"], ["DA1", "DA2"]).status_code == 201
    assert _receive_serials(auth_headers, p["id"], loc_b["id"], ["DB1", "DB2"]).status_code == 201

    created = client.post("/api/shipments", json={
        "items": [
            {"product_id": p["id"], "quantity": 2, "location_id": loc_a["id"]},
            {"product_id": p["id"], "quantity": 2, "location_id": loc_b["id"]},
        ],
    }, headers=auth_headers)
    assert created.status_code == 201
    shipment = created.json()
    assert len(shipment["items"]) == 2

    sa = [s["id"] for s in client.get(
        f"/api/serial-numbers?product_id={p['id']}&location_id={loc_a['id']}&limit=10", headers=auth_headers).json()["items"]]
    sb = [s["id"] for s in client.get(
        f"/api/serial-numbers?product_id={p['id']}&location_id={loc_b['id']}&limit=10", headers=auth_headers).json()["items"]]

    picked = client.post(f"/api/shipments/{shipment['id']}/pick", json={
        "items": [
            {"product_id": p["id"], "item_id": shipment["items"][0]["id"], "serial_ids": sa},
            {"product_id": p["id"], "item_id": shipment["items"][1]["id"], "serial_ids": sb},
        ],
    }, headers=auth_headers)
    assert picked.status_code == 200
    body = picked.json()
    assert body["status"] == "picking"
    assert all(i["quantity_picked"] == i["quantity_ordered"] for i in body["items"])


def test_pick_rejects_deactivated_serialized_product(auth_headers):
    p = _make_product(auth_headers, "SHP-DEACT", serialized=True)
    loc = _make_location(auth_headers, "SHP-DEACT-LOC")
    assert _receive_serials(auth_headers, p["id"], loc["id"], ["D1", "D2"]).status_code == 201
    created = _create_shipment(auth_headers, [(p["id"], 2)]).json()
    assert client.put(f"/api/products/{p['id']}", json={"is_active": False}, headers=auth_headers).status_code == 200

    picked = client.post(f"/api/shipments/{created['id']}/pick", headers=auth_headers)
    assert picked.status_code == 400
    assert "inactive" in picked.json()["detail"]


def test_shipment_cancel_draft(auth_headers):
    p = _make_product(auth_headers, "SHP-C")
    loc = _make_location(auth_headers, "SHP-C-LOC")
    assert _receive(auth_headers, p["id"], 5, loc["id"]).status_code == 201
    created = _create_shipment(auth_headers, [(p["id"], 2)]).json()

    cancelled = client.post(f"/api/shipments/{created['id']}/cancel", headers=auth_headers)
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"
    assert client.get(f"/api/products/{p['id']}", headers=auth_headers).json()["quantity"] == 5

    # cannot ship a cancelled shipment
    assert client.post(f"/api/shipments/{created['id']}/ship", headers=auth_headers).status_code == 400


def test_cancel_picked_shipment_returns_stock(auth_headers):
    p = _make_product(auth_headers, "SHP-RET")
    loc = _make_location(auth_headers, "SHP-RET-LOC")
    assert _receive(auth_headers, p["id"], 6, loc["id"], lot_number="LOT-RET").status_code == 201
    created = _create_shipment(auth_headers, [(p["id"], 4)]).json()
    sid = created["id"]
    assert client.post(f"/api/shipments/{sid}/pick", headers=auth_headers).status_code == 200
    assert client.get(f"/api/locations/{loc['id']}", headers=auth_headers).json()["total_quantity"] == 2

    cancelled = client.post(f"/api/shipments/{sid}/cancel", headers=auth_headers)
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"
    assert cancelled.json()["staging_location_id"] is None
    assert all(i["quantity_picked"] == 0 for i in cancelled.json()["items"])
    assert client.get(f"/api/locations/{loc['id']}", headers=auth_headers).json()["total_quantity"] == 6


def test_cancel_picked_serialized_shipment_returns_serials(auth_headers):
    p = _make_product(auth_headers, "SHP-RET-SER", serialized=True)
    loc = _make_location(auth_headers, "SHP-RET-SER-LOC")
    assert _receive_serials(auth_headers, p["id"], loc["id"], ["RS-1", "RS-2", "RS-3"]).status_code == 201
    created = _create_shipment(auth_headers, [(p["id"], 2)]).json()
    sid = created["id"]
    assert client.post(f"/api/shipments/{sid}/pick", headers=auth_headers).status_code == 200

    serials = client.get(f"/api/serial-numbers?product_id={p['id']}&limit=10", headers=auth_headers).json()["items"]
    staged = [s for s in serials if s["location_id"] != loc["id"]]
    assert len(staged) == 2

    cancelled = client.post(f"/api/shipments/{sid}/cancel", headers=auth_headers)
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"

    serials = client.get(f"/api/serial-numbers?product_id={p['id']}&limit=10", headers=auth_headers).json()["items"]
    assert all(s["status"] == "in_stock" for s in serials)
    assert all(s["location_id"] == loc["id"] for s in serials)


def test_shipment_stats(auth_headers):
    p = _make_product(auth_headers, "SHP-ST")
    loc = _make_location(auth_headers, "SHP-ST-LOC")
    assert _receive(auth_headers, p["id"], 10, loc["id"]).status_code == 201
    s1 = _create_shipment(auth_headers, [(p["id"], 2)]).json()
    _create_shipment(auth_headers, [(p["id"], 3)])
    client.post(f"/api/shipments/{s1['id']}/pick", headers=auth_headers)
    client.post(f"/api/shipments/{s1['id']}/pack", headers=auth_headers)
    client.post(f"/api/shipments/{s1['id']}/ship", headers=auth_headers)

    stats = client.get("/api/shipments/stats", headers=auth_headers).json()
    assert stats["counts"]["shipped"] == 1
    assert stats["counts"]["draft"] == 1
    assert stats["open"] == 1


def test_shipment_variant_products(auth_headers):
    parent = _make_product(auth_headers, "SHP-VAR-PARENT")
    variant = client.post("/api/products", json={"location_id": 1, 
        "sku": "SHP-VAR-RED", "name": parent["name"], "parent_id": parent["id"],
        "attributes": {"Color": "Red"}, "quantity": 0,
    }, headers=auth_headers).json()
    loc = _make_location(auth_headers, "SHP-VAR-LOC")
    assert _receive(auth_headers, variant["id"], 6, loc["id"]).status_code == 201

    # parent with active variants cannot be shipped - a specific variant is required
    assert _create_shipment(auth_headers, [(parent["id"], 2)]).status_code == 400

    # shipping the variant itself works and decrements its stock
    created = _create_shipment(auth_headers, [(variant["id"], 2)])
    assert created.status_code == 201
    assert created.json()["items"][0]["product_id"] == variant["id"]
    picked = client.post(f"/api/shipments/{created.json()['id']}/pick", headers=auth_headers).json()
    assert picked["items"][0]["quantity_picked"] == 2
    shipped = client.post(f"/api/shipments/{created.json()['id']}/ship", headers=auth_headers)
    assert shipped.status_code == 200
    assert client.get(f"/api/products/{variant['id']}", headers=auth_headers).json()["quantity"] == 4


def test_shipment_customer_linking(auth_headers):
    customer = client.post("/api/customers", json={
        "name": "Acme Corp", "phone": "555-0100", "email": "acme@example.com",
    }, headers=auth_headers).json()
    p = _make_product(auth_headers, "SHP-CUST")
    loc = _make_location(auth_headers, "SHP-CUST-LOC")
    assert _receive(auth_headers, p["id"], 5, loc["id"]).status_code == 201

    created = _create_shipment(auth_headers, [(p["id"], 2)], customer_id=customer["id"]).json()
    assert created["customer_id"] == customer["id"]
    assert created["customer_name"] == "Acme Corp"

    # unknown customer id is rejected
    assert _create_shipment(auth_headers, [(p["id"], 1)], customer_id=99999).status_code == 404

    # update can reassign / clear the customer
    updated = client.put(f"/api/shipments/{created['id']}", json={"customer_id": None}, headers=auth_headers)
    assert updated.status_code == 200
    assert updated.json()["customer_name"] == ""
    updated = client.put(f"/api/shipments/{created['id']}", json={"customer_id": customer["id"], "carrier": "FedEx"}, headers=auth_headers)
    assert updated.json()["customer_name"] == "Acme Corp"
    assert updated.json()["carrier"] == "FedEx"


def test_shipment_delete(auth_headers):
    p = _make_product(auth_headers, "SHP-DEL")
    loc = _make_location(auth_headers, "SHP-DEL-LOC")
    assert _receive(auth_headers, p["id"], 5, loc["id"]).status_code == 201
    created = _create_shipment(auth_headers, [(p["id"], 2)]).json()

    # a picking shipment cannot be deleted
    client.post(f"/api/shipments/{created['id']}/pick", headers=auth_headers)
    assert client.delete(f"/api/shipments/{created['id']}", headers=auth_headers).status_code == 400

    # a shipped shipment cannot be deleted
    s2 = _create_shipment(auth_headers, [(p["id"], 1)]).json()
    client.post(f"/api/shipments/{s2['id']}/pick", headers=auth_headers)
    client.post(f"/api/shipments/{s2['id']}/ship", headers=auth_headers)
    assert client.delete(f"/api/shipments/{s2['id']}", headers=auth_headers).status_code == 400

    # draft shipment deletes cleanly
    s3 = _create_shipment(auth_headers, [(p["id"], 2)]).json()
    assert client.delete(f"/api/shipments/{s3['id']}", headers=auth_headers).status_code == 204
    assert client.get(f"/api/shipments/{s3['id']}", headers=auth_headers).status_code == 404


def test_shipment_blocked_by_pending_qc(auth_headers):
    client.put("/api/settings", json={"require_qc_before_ship": True}, headers=auth_headers)
    p = _make_product(auth_headers, "SHP-QC")
    loc = _make_location(auth_headers, "SHP-QC-LOC")
    assert _receive(auth_headers, p["id"], 5, loc["id"]).status_code == 201

    qc = client.post("/api/quality-checks", json={
        "product_id": p["id"], "result": "pending",
    }, headers=auth_headers)
    assert qc.status_code == 201

    created = _create_shipment(auth_headers, [(p["id"], 2)]).json()
    blocked_pick = client.post(f"/api/shipments/{created['id']}/pick", headers=auth_headers)
    assert blocked_pick.status_code == 400
    assert "quality check" in blocked_pick.json()["detail"].lower()

    # resolve the pending QC, then pick and pack
    qc_id = qc.json()["id"]
    assert client.put(f"/api/quality-checks/{qc_id}", json={"result": "pass"}, headers=auth_headers).status_code == 200
    assert client.post(f"/api/shipments/{created['id']}/pick", headers=auth_headers).status_code == 200
    assert client.post(f"/api/shipments/{created['id']}/pack", headers=auth_headers).status_code == 200

    # a new pending QC blocks shipping
    qc2 = client.post("/api/quality-checks", json={
        "product_id": p["id"], "result": "pending",
    }, headers=auth_headers)
    blocked_ship = client.post(f"/api/shipments/{created['id']}/ship", headers=auth_headers)
    assert blocked_ship.status_code == 400
    assert "quality check" in blocked_ship.json()["detail"].lower()

    # pending QC on an unrelated product does not block this shipment
    assert client.put(f"/api/quality-checks/{qc2.json()['id']}", json={"result": "pass"}, headers=auth_headers).status_code == 200
    other = _make_product(auth_headers, "SHP-QC-OTHER")
    assert _receive(auth_headers, other["id"], 5, loc["id"]).status_code == 201
    client.post("/api/quality-checks", json={
        "product_id": other["id"], "result": "pending",
    }, headers=auth_headers)

    shipped = client.post(f"/api/shipments/{created['id']}/ship", headers=auth_headers)
    assert shipped.status_code == 200
    assert shipped.json()["status"] == "shipped"


def test_shipment_qc_setting_default_allows_shipping(auth_headers):
    p = _make_product(auth_headers, "SHP-NOQC")
    loc = _make_location(auth_headers, "SHP-NOQC-LOC")
    assert _receive(auth_headers, p["id"], 5, loc["id"]).status_code == 201
    created = _create_shipment(auth_headers, [(p["id"], 2)]).json()
    client.post(f"/api/shipments/{created['id']}/pick", headers=auth_headers)
    client.post(f"/api/shipments/{created['id']}/pack", headers=auth_headers)
    assert client.post(f"/api/shipments/{created['id']}/ship", headers=auth_headers).status_code == 200


def test_shipment_blocked_by_failed_qc_without_lot(auth_headers):
    # a failed QC with no lot linked quarantines nothing, but must still block shipping
    p = _make_product(auth_headers, "SHP-FAILQC")
    loc = _make_location(auth_headers, "SHP-FAILQC-LOC")
    assert _receive(auth_headers, p["id"], 5, loc["id"]).status_code == 201

    created = _create_shipment(auth_headers, [(p["id"], 2)]).json()
    assert client.post(f"/api/shipments/{created['id']}/pick", headers=auth_headers).status_code == 200
    assert client.post(f"/api/shipments/{created['id']}/pack", headers=auth_headers).status_code == 200

    qc = client.post("/api/quality-checks", json={
        "product_id": p["id"], "result": "fail",
    }, headers=auth_headers)
    assert qc.status_code == 201

    blocked = client.post(f"/api/shipments/{created['id']}/ship", headers=auth_headers)
    assert blocked.status_code == 400
    assert "quality check" in blocked.json()["detail"].lower()

    # a fresh shipment for the same product is blocked at picking
    created2 = _create_shipment(auth_headers, [(p["id"], 2)]).json()
    blocked_pick = client.post(f"/api/shipments/{created2['id']}/pick", headers=auth_headers)
    assert blocked_pick.status_code == 400
    assert "quality check" in blocked_pick.json()["detail"].lower()

    # once the QC passes, both shipments proceed
    assert client.put(f"/api/quality-checks/{qc.json()['id']}", json={"result": "pass"}, headers=auth_headers).status_code == 200
    assert client.post(f"/api/shipments/{created['id']}/ship", headers=auth_headers).status_code == 200
    assert client.post(f"/api/shipments/{created2['id']}/pick", headers=auth_headers).status_code == 200


def test_shipment_blocked_by_failed_qc_scoped_to_location_only(auth_headers):
    # a failed QC scoped to one location must block picking from that location
    # but not the same product at an unaffected location.
    p = _make_product(auth_headers, "SHP-FAILQC-LOCSCOPE")
    loc_a = _make_location(auth_headers, "SHP-FAILQC-A")
    loc_b = _make_location(auth_headers, "SHP-FAILQC-B")
    assert _receive(auth_headers, p["id"], 5, loc_a["id"], lot_number="SHP-FAILQC-LA").status_code == 201
    assert _receive(auth_headers, p["id"], 5, loc_b["id"], lot_number="SHP-FAILQC-LB").status_code == 201

    qc = client.post("/api/quality-checks", json={
        "product_id": p["id"], "location_id": loc_a["id"], "result": "fail",
    }, headers=auth_headers)
    assert qc.status_code == 201

    blocked = _create_shipment_with_location(auth_headers, [(p["id"], 2, loc_a["id"])]).json()
    resp = client.post(f"/api/shipments/{blocked['id']}/pick", headers=auth_headers)
    assert resp.status_code == 400
    assert "quality check" in resp.json()["detail"].lower()

    ok = _create_shipment_with_location(auth_headers, [(p["id"], 2, loc_b["id"])]).json()
    assert client.post(f"/api/shipments/{ok['id']}/pick", headers=auth_headers).status_code == 200


def test_shipment_create_sale_invoice(auth_headers):
    p = _make_product(auth_headers, "SHP-INV")
    loc = _make_location(auth_headers, "SHP-INV-LOC")
    assert _receive(auth_headers, p["id"], 6, loc["id"]).status_code == 201

    created = _create_shipment(auth_headers, [(p["id"], 3)]).json()
    sid = created["id"]
    client.post(f"/api/shipments/{sid}/pick", headers=auth_headers)
    client.post(f"/api/shipments/{sid}/pack", headers=auth_headers)
    client.post(f"/api/shipments/{sid}/ship", headers=auth_headers)

    sale = client.post(f"/api/shipments/{sid}/create-sale", params={"payment_method": "card"}, headers=auth_headers)
    assert sale.status_code == 201
    sale = sale.json()
    assert sale["invoice_number"].startswith("INV-")
    assert sale["status"] == "completed"
    assert len(sale["items"]) == 1
    assert sale["items"][0]["quantity"] == 3
    assert float(sale["items"][0]["unit_price"]) == 10.0
    assert float(sale["subtotal"]) == 30.0
    assert float(sale["total_amount"]) == 30.0
    assert sale["payment_method"] == "card"
    assert "SHP-" in sale["notes"]

    shipment = client.get(f"/api/shipments/{sid}", headers=auth_headers).json()
    assert shipment["sale_id"] == sale["id"]
    assert shipment["invoice_number"] == sale["invoice_number"]
    assert float(shipment["total_amount"]) == 30.0
    assert shipment["payment_method"] == "card"

    # double invoicing rejected
    assert client.post(f"/api/shipments/{sid}/create-sale", headers=auth_headers).status_code == 400

    # creating the invoice does not re-decrement stock
    assert client.get(f"/api/products/{p['id']}", headers=auth_headers).json()["quantity"] == 3


def test_shipment_create_sale_mobile_money(auth_headers):
    p = _make_product(auth_headers, "SHP-MM")
    loc = _make_location(auth_headers, "SHP-MM-LOC")
    assert _receive(auth_headers, p["id"], 4, loc["id"]).status_code == 201
    sid = _create_shipment(auth_headers, [(p["id"], 2)]).json()["id"]
    client.post(f"/api/shipments/{sid}/pick", headers=auth_headers)
    client.post(f"/api/shipments/{sid}/pack", headers=auth_headers)
    client.post(f"/api/shipments/{sid}/ship", headers=auth_headers)

    resp = client.post(
        f"/api/shipments/{sid}/create-sale",
        params={"payment_method": "mobile_money", "payment_provider": "t-kash"},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    sale = resp.json()
    assert sale["payment_method"] == "mobile_money"
    assert sale["payment_provider"] == "t-kash"

    shipment = client.get(f"/api/shipments/{sid}", headers=auth_headers).json()
    assert shipment["payment_method"] == "mobile_money"
    assert shipment["payment_provider"] == "t-kash"


def test_shipment_create_sale_payment_reference_and_phone(auth_headers):
    p = _make_product(auth_headers, "SHP-MM-REF")
    loc = _make_location(auth_headers, "SHP-MM-REF-LOC")
    assert _receive(auth_headers, p["id"], 4, loc["id"]).status_code == 201
    sid = _create_shipment(auth_headers, [(p["id"], 2)]).json()["id"]
    client.post(f"/api/shipments/{sid}/pick", headers=auth_headers)
    client.post(f"/api/shipments/{sid}/pack", headers=auth_headers)
    client.post(f"/api/shipments/{sid}/ship", headers=auth_headers)

    resp = client.post(
        f"/api/shipments/{sid}/create-sale",
        params={
            "payment_method": "mobile_money",
            "payment_provider": "t-kash",
            "payment_reference": "SHPMNT-REF-1",
            "payment_phone": "0711 000 000",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 201
    sale = resp.json()
    assert sale["payment_reference"] == "SHPMNT-REF-1"
    assert sale["payment_phone"] == "0711 000 000"


def test_shipment_create_sale_mobile_money_requires_provider(auth_headers):
    p = _make_product(auth_headers, "SHP-MM-REQ")
    loc = _make_location(auth_headers, "SHP-MM-REQ-LOC")
    assert _receive(auth_headers, p["id"], 4, loc["id"]).status_code == 201
    sid = _create_shipment(auth_headers, [(p["id"], 2)]).json()["id"]
    client.post(f"/api/shipments/{sid}/pick", headers=auth_headers)
    client.post(f"/api/shipments/{sid}/pack", headers=auth_headers)
    client.post(f"/api/shipments/{sid}/ship", headers=auth_headers)

    resp = client.post(
        f"/api/shipments/{sid}/create-sale",
        params={"payment_method": "mobile_money"},
        headers=auth_headers,
    )
    assert resp.status_code == 400
    assert "payment_provider is required" in resp.json()["detail"]


def test_create_sale_requires_shipped(auth_headers):
    p = _make_product(auth_headers, "SHP-INV-DRAFT")
    loc = _make_location(auth_headers, "SHP-INV-DRAFT-LOC")
    assert _receive(auth_headers, p["id"], 5, loc["id"]).status_code == 201
    created = _create_shipment(auth_headers, [(p["id"], 2)]).json()
    assert client.post(f"/api/shipments/{created['id']}/create-sale", headers=auth_headers).status_code == 400


def test_shipment_sale_id_linking(auth_headers):
    p = _make_product(auth_headers, "SHP-SALEID")
    loc = _make_location(auth_headers, "SHP-SALEID-LOC")
    assert _receive(auth_headers, p["id"], 10, loc["id"]).status_code == 201
    sale = client.post("/api/sales", json={
        "items": [{"product_id": p["id"], "quantity": 2, "unit_price": 12.0}],
    }, headers=auth_headers)
    assert sale.status_code == 201
    sale = sale.json()

    # unknown sale id rejected
    assert _create_shipment(auth_headers, [(p["id"], 1)], sale_id=99999).status_code == 404

    # attach existing invoice at creation
    created = _create_shipment(auth_headers, [(p["id"], 1)], sale_id=sale["id"]).json()
    assert created["sale_id"] == sale["id"]
    assert created["invoice_number"] == sale["invoice_number"]

    # a sale can only belong to one shipment
    assert _create_shipment(auth_headers, [(p["id"], 1)], sale_id=sale["id"]).status_code == 400

    # attaching an already-linked invoice via PUT also rejected
    s2 = _create_shipment(auth_headers, [(p["id"], 1)]).json()
    assert client.put(f"/api/shipments/{s2['id']}", json={"sale_id": sale["id"]}, headers=auth_headers).status_code == 400


def test_shipment_pick_manual_serials_selects_exact_units(auth_headers):
    p = _make_product(auth_headers, "SHP-MAN", serialized=True)
    loc_a = _make_location(auth_headers, "SHP-MAN-A")
    loc_b = _make_location(auth_headers, "SHP-MAN-B")
    assert _receive_serials(auth_headers, p["id"], loc_a["id"], ["MA1", "MA2", "MA3"]).status_code == 201
    assert _receive_serials(auth_headers, p["id"], loc_b["id"], ["MB1"]).status_code == 201

    created = _create_shipment(auth_headers, [(p["id"], 2)]).json()
    serials = client.get(f"/api/serial-numbers?product_id={p['id']}&limit=10", headers=auth_headers).json()["items"]
    ma1 = next(s for s in serials if s["serial_number"] == "MA1")
    mb1 = next(s for s in serials if s["serial_number"] == "MB1")

    picked = client.post(f"/api/shipments/{created['id']}/pick", json={
        "items": [{"product_id": p["id"], "serial_ids": [ma1["id"], mb1["id"]]}],
    }, headers=auth_headers)
    assert picked.status_code == 200
    picked = picked.json()
    assert picked["total_picked"] == 2

    staged = picked["staging_location_id"]
    serials = client.get(f"/api/serial-numbers?product_id={p['id']}&limit=10", headers=auth_headers).json()["items"]
    assert {s["serial_number"] for s in serials if s["location_id"] == staged} == {"MA1", "MB1"}
    assert {s["serial_number"] for s in serials if s["location_id"] == loc_a["id"]} == {"MA2", "MA3"}
    assert {s["serial_number"] for s in serials if s["location_id"] == loc_b["id"]} == set()


def test_shipment_pick_manual_serials_rejects_wrong_product(auth_headers):
    p1 = _make_product(auth_headers, "SHP-MAN-W1", serialized=True)
    p2 = _make_product(auth_headers, "SHP-MAN-W2", serialized=True)
    loc = _make_location(auth_headers, "SHP-MAN-W-LOC")
    assert _receive_serials(auth_headers, p1["id"], loc["id"], ["W1A"]).status_code == 201
    assert _receive_serials(auth_headers, p2["id"], loc["id"], ["W2A"]).status_code == 201
    w2a = client.get(f"/api/serial-numbers?product_id={p2['id']}&limit=10", headers=auth_headers).json()["items"][0]

    created = _create_shipment(auth_headers, [(p1["id"], 1)]).json()
    resp = client.post(f"/api/shipments/{created['id']}/pick", json={
        "items": [{"product_id": p1["id"], "serial_ids": [w2a["id"]]}],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "does not belong" in resp.json()["detail"]


def test_shipment_pick_manual_serials_requires_exact_count(auth_headers):
    p = _make_product(auth_headers, "SHP-MAN-CNT", serialized=True)
    loc = _make_location(auth_headers, "SHP-MAN-CNT-LOC")
    assert _receive_serials(auth_headers, p["id"], loc["id"], ["CNT1", "CNT2"]).status_code == 201
    cnt1 = client.get(f"/api/serial-numbers?product_id={p['id']}&limit=10", headers=auth_headers).json()["items"][0]

    created = _create_shipment(auth_headers, [(p["id"], 2)]).json()
    resp = client.post(f"/api/shipments/{created['id']}/pick", json={
        "items": [{"product_id": p["id"], "serial_ids": [cnt1["id"]]}],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "exactly 2" in resp.json()["detail"]


def test_shipment_pick_manual_serials_rejects_non_stock_serial(auth_headers):
    p = _make_product(auth_headers, "SHP-MAN-OOS", serialized=True)
    loc = _make_location(auth_headers, "SHP-MAN-OOS-LOC")
    assert _receive_serials(auth_headers, p["id"], loc["id"], ["OOS1", "OOS2"]).status_code == 201
    created = _create_shipment(auth_headers, [(p["id"], 2)]).json()

    serials = client.get(f"/api/serial-numbers?product_id={p['id']}&limit=10", headers=auth_headers).json()["items"]
    oos1 = next(s for s in serials if s["serial_number"] == "OOS1")
    oos2 = next(s for s in serials if s["serial_number"] == "OOS2")
    assert client.put(f"/api/serial-numbers/{oos1['id']}/status", json={"status": "inactive"}, headers=auth_headers).status_code == 200

    resp = client.post(f"/api/shipments/{created['id']}/pick", json={
        "items": [{"product_id": p["id"], "serial_ids": [oos1["id"], oos2["id"]]}],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "not in stock" in resp.json()["detail"]


def test_shipment_pick_manual_serials_rejects_quarantined_lot(auth_headers):
    p = _make_product(auth_headers, "SHP-MAN-QL", serialized=True)
    loc = _make_location(auth_headers, "SHP-MAN-QL-LOC")
    assert client.post("/api/receipts", json={
        "items": [{
            "product_id": p["id"], "quantity": 2, "location_id": loc["id"],
            "serial_numbers": ["QL1", "QL2"], "lot_number": "LOT-QL",
        }],
    }, headers=auth_headers).status_code == 201
    lot = client.get(f"/api/lots?product_id={p['id']}&limit=10", headers=auth_headers).json()["items"][0]
    created = _create_shipment(auth_headers, [(p["id"], 2)]).json()
    assert client.put(f"/api/lots/{lot['id']}", json={"status": "quarantined"}, headers=auth_headers).status_code == 200

    serials = client.get(f"/api/serial-numbers?product_id={p['id']}&limit=10", headers=auth_headers).json()["items"]
    resp = client.post(f"/api/shipments/{created['id']}/pick", json={
        "items": [{"product_id": p["id"], "serial_ids": [s["id"] for s in serials]}],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "quarantined" in resp.json()["detail"]


def _create_shipment_with_location(auth_headers, items):
    return client.post("/api/shipments", json={
        "items": [
            {"product_id": pid, "quantity": qty, "location_id": loc_id}
            for pid, qty, loc_id in items
        ],
    }, headers=auth_headers)


def test_shipment_location_picker_picks_from_specified_location(auth_headers):
    p = _make_product(auth_headers, "SHP-LOCPICK")
    loc_a = _make_location(auth_headers, "SHP-LOCPICK-A")
    loc_b = _make_location(auth_headers, "SHP-LOCPICK-B")
    assert _receive(auth_headers, p["id"], 5, loc_a["id"], lot_number="LOT-A").status_code == 201
    assert _receive(auth_headers, p["id"], 5, loc_b["id"], lot_number="LOT-B").status_code == 201

    created = _create_shipment_with_location(auth_headers, [(p["id"], 3, loc_a["id"])])
    assert created.status_code == 201
    item = created.json()["items"][0]
    assert item["location_id"] == loc_a["id"]
    assert item["location_name"] == loc_a["name"]

    picked = client.post(f"/api/shipments/{created.json()['id']}/pick", headers=auth_headers)
    assert picked.status_code == 200
    # only location A was consumed
    assert client.get(f"/api/locations/{loc_a['id']}", headers=auth_headers).json()["total_quantity"] == 2
    assert client.get(f"/api/locations/{loc_b['id']}", headers=auth_headers).json()["total_quantity"] == 5

    shipped = client.post(f"/api/shipments/{created.json()['id']}/ship", headers=auth_headers)
    assert shipped.status_code == 200
    assert client.get(f"/api/products/{p['id']}", headers=auth_headers).json()["quantity"] == 7


def test_shipment_location_picker_rejects_insufficient_stock_at_location(auth_headers):
    p = _make_product(auth_headers, "SHP-LOCINSUF")
    loc_a = _make_location(auth_headers, "SHP-LOCINSUF-A")
    loc_b = _make_location(auth_headers, "SHP-LOCINSUF-B")
    assert _receive(auth_headers, p["id"], 5, loc_a["id"]).status_code == 201

    # enough stock exists globally but not at the requested location
    resp = _create_shipment_with_location(auth_headers, [(p["id"], 6, loc_a["id"])])
    assert resp.status_code == 400
    assert "insufficient" in resp.json()["detail"].lower()

    # location with no stock at all
    resp = _create_shipment_with_location(auth_headers, [(p["id"], 1, loc_b["id"])])
    assert resp.status_code == 400
    assert "insufficient" in resp.json()["detail"].lower()

    # an unknown location id is rejected
    resp = _create_shipment_with_location(auth_headers, [(p["id"], 1, 99999)])
    assert resp.status_code == 404


def test_shipment_location_picker_serialized(auth_headers):
    p = _make_product(auth_headers, "SHP-LOCSER", serialized=True)
    loc_a = _make_location(auth_headers, "SHP-LOCSER-A")
    loc_b = _make_location(auth_headers, "SHP-LOCSER-B")
    assert _receive_serials(auth_headers, p["id"], loc_a["id"], ["SA1", "SA2"]).status_code == 201
    assert _receive_serials(auth_headers, p["id"], loc_b["id"], ["SB1", "SB2"]).status_code == 201

    created = _create_shipment_with_location(auth_headers, [(p["id"], 2, loc_a["id"])])
    assert created.status_code == 201
    assert created.json()["items"][0]["location_id"] == loc_a["id"]

    picked = client.post(f"/api/shipments/{created.json()['id']}/pick", headers=auth_headers)
    assert picked.status_code == 200

    serials = client.get(f"/api/serial-numbers?product_id={p['id']}&limit=10", headers=auth_headers).json()["items"]
    at_a = {s["serial_number"] for s in serials if s["location_id"] == loc_a["id"]}
    at_b = {s["serial_number"] for s in serials if s["location_id"] == loc_b["id"]}
    assert at_a == set()
    assert at_b == {"SB1", "SB2"}
