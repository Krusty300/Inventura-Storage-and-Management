from tests.conftest import client


def _make_location(auth_headers, code, location_type="bin"):
    return client.post("/api/locations", json={
        "code": code, "name": code, "location_type": location_type,
    }, headers=auth_headers).json()


def _make_product(auth_headers, sku, serialized=False, cost=4.0):
    return client.post("/api/products", json={
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
    variant = client.post("/api/products", json={
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


def test_shipment_create_sale_invoice(auth_headers):
    p = _make_product(auth_headers, "SHP-INV")
    loc = _make_location(auth_headers, "SHP-INV-LOC")
    assert _receive(auth_headers, p["id"], 6, loc["id"]).status_code == 201

    created = _create_shipment(auth_headers, [(p["id"], 3)]).json()
    sid = created["id"]
    client.post(f"/api/shipments/{sid}/pick", headers=auth_headers)
    client.post(f"/api/shipments/{sid}/pack", headers=auth_headers)
    client.post(f"/api/shipments/{sid}/ship", headers=auth_headers)

    sale = client.post(f"/api/shipments/{sid}/create-sale", headers=auth_headers)
    assert sale.status_code == 201
    sale = sale.json()
    assert sale["invoice_number"].startswith("INV-")
    assert sale["status"] == "completed"
    assert len(sale["items"]) == 1
    assert sale["items"][0]["quantity"] == 3
    assert float(sale["items"][0]["unit_price"]) == 10.0
    assert float(sale["subtotal"]) == 30.0
    assert float(sale["total_amount"]) == 30.0
    assert "SHP-" in sale["notes"]

    shipment = client.get(f"/api/shipments/{sid}", headers=auth_headers).json()
    assert shipment["sale_id"] == sale["id"]
    assert shipment["invoice_number"] == sale["invoice_number"]
    assert float(shipment["total_amount"]) == 30.0

    # double invoicing rejected
    assert client.post(f"/api/shipments/{sid}/create-sale", headers=auth_headers).status_code == 400

    # creating the invoice does not re-decrement stock
    assert client.get(f"/api/products/{p['id']}", headers=auth_headers).json()["quantity"] == 3


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
