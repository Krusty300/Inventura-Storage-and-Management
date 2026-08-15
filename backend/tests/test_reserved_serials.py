from app.models import SerialNumber, User
from app.services import inventory
from tests.conftest import TestingSessionLocal, client


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


def test_serialized_issue_moves_serial_to_wip_location(auth_headers):
    fg = _make_product(auth_headers, "RW-FG", serialized=True)
    comp = _make_product(auth_headers, "RW-COMP", serialized=True)
    loc = _make_location(auth_headers, "RW-LOC")
    assert _receive_serials(auth_headers, comp["id"], loc["id"], ["RW-1"]).status_code == 201
    bom = _create_bom(auth_headers, fg["id"], [(comp["id"], 1)]).json()
    wo = _create_wo(auth_headers, fg["id"], 1, bom_id=bom["id"]).json()

    released = client.post(f"/api/work-orders/{wo['id']}/release", headers=auth_headers).json()
    assert released["status"] == "released"

    serial = _list_serials(auth_headers, comp["id"])[0]
    assert serial["status"] == "reserved"
    assert serial["location_id"] == released["wip_location_id"]
    assert client.get(f"/api/products/{comp['id']}", headers=auth_headers).json()["quantity"] == 0


def test_release_reserved_serial_via_endpoint(auth_headers):
    fg = _make_product(auth_headers, "RR-FG", serialized=True)
    comp = _make_product(auth_headers, "RR-COMP", serialized=True)
    loc = _make_location(auth_headers, "RR-LOC")
    assert _receive_serials(auth_headers, comp["id"], loc["id"], ["RR-1"], lot_number="RR-LOT").status_code == 201
    bom = _create_bom(auth_headers, fg["id"], [(comp["id"], 1)]).json()
    wo = _create_wo(auth_headers, fg["id"], 1, bom_id=bom["id"]).json()
    client.post(f"/api/work-orders/{wo['id']}/release", headers=auth_headers)

    serial = _list_serials(auth_headers, comp["id"])[0]
    assert serial["status"] == "reserved"

    released = client.post(f"/api/serial-numbers/{serial['id']}/release", headers=auth_headers)
    assert released.status_code == 200
    body = released.json()
    assert body["status"] == "in_stock"
    assert body["location_id"] == loc["id"]
    assert client.get(f"/api/products/{comp['id']}", headers=auth_headers).json()["quantity"] == 1
    assert any(m["movement_type"] == "release" for m in
               client.get(f"/api/serial-numbers/{serial['id']}/movements", headers=auth_headers).json())


def test_release_endpoint_rejects_sold_and_in_stock(auth_headers):
    prod = _make_product(auth_headers, "RS-PROD", serialized=True)
    assert _receive_serials(auth_headers, prod["id"], 1, ["RS-1"]).status_code == 201
    serial = _list_serials(auth_headers, prod["id"])[0]
    assert client.post(f"/api/serial-numbers/{serial['id']}/release", headers=auth_headers).status_code == 400


def test_cancel_released_work_order_returns_reserved_serial(auth_headers):
    fg = _make_product(auth_headers, "CR-FG", serialized=True)
    comp = _make_product(auth_headers, "CR-COMP", serialized=True)
    loc = _make_location(auth_headers, "CR-LOC")
    assert _receive_serials(auth_headers, comp["id"], loc["id"], ["CR-1", "CR-2"]).status_code == 201
    bom = _create_bom(auth_headers, fg["id"], [(comp["id"], 2)]).json()
    wo = _create_wo(auth_headers, fg["id"], 1, bom_id=bom["id"]).json()
    client.post(f"/api/work-orders/{wo['id']}/release", headers=auth_headers)

    cancelled = client.post(f"/api/work-orders/{wo['id']}/cancel", headers=auth_headers)
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"

    serials = _list_serials(auth_headers, comp["id"])
    assert {s["serial_number"] for s in serials} == {"CR-1", "CR-2"}
    assert all(s["status"] == "in_stock" for s in serials)
    assert all(s["location_id"] == loc["id"] for s in serials)
    assert client.get(f"/api/products/{comp['id']}", headers=auth_headers).json()["quantity"] == 2


def test_cancel_released_work_order_returns_bulk_component(auth_headers):
    fg = _make_product(auth_headers, "CB-FG")
    comp = _make_product(auth_headers, "CB-COMP")
    loc = _make_location(auth_headers, "CB-LOC")
    assert _receive(auth_headers, comp["id"], 10, loc["id"], lot_number="CB-LOT").status_code == 201
    bom = _create_bom(auth_headers, fg["id"], [(comp["id"], 2)]).json()
    wo = _create_wo(auth_headers, fg["id"], 3, bom_id=bom["id"]).json()
    released = client.post(f"/api/work-orders/{wo['id']}/release", headers=auth_headers).json()
    assert released["items"][0]["quantity_issued"] == 6
    assert client.get(f"/api/products/{comp['id']}", headers=auth_headers).json()["quantity"] == 4

    cancelled = client.post(f"/api/work-orders/{wo['id']}/cancel", headers=auth_headers).json()
    assert cancelled["status"] == "cancelled"
    assert cancelled["items"][0]["quantity_issued"] == 0
    assert client.get(f"/api/products/{comp['id']}", headers=auth_headers).json()["quantity"] == 10


def test_complete_consumes_issued_serial(auth_headers):
    fg = _make_product(auth_headers, "CC-FG", serialized=True)
    comp = _make_product(auth_headers, "CC-COMP", serialized=True)
    loc = _make_location(auth_headers, "CC-LOC")
    assert _receive_serials(auth_headers, comp["id"], loc["id"], ["CC-1"]).status_code == 201
    bom = _create_bom(auth_headers, fg["id"], [(comp["id"], 1)]).json()
    wo = _create_wo(auth_headers, fg["id"], 1, bom_id=bom["id"]).json()
    client.post(f"/api/work-orders/{wo['id']}/release", headers=auth_headers)

    done = client.post(f"/api/work-orders/{wo['id']}/complete", json={
        "receive_location_id": loc["id"], "lot_number": "CC-FGLOT",
        "serial_numbers": ["CC-FG1"],
    }, headers=auth_headers)
    assert done.status_code == 200

    serial = _list_serials(auth_headers, comp["id"])[0]
    assert serial["status"] == "consumed"
    assert serial["location_id"] == done.json()["wip_location_id"]


def test_product_reserved_qty_reflects_reserved_serials(auth_headers):
    fg = _make_product(auth_headers, "PQ-FG", serialized=True)
    comp = _make_product(auth_headers, "PQ-COMP", serialized=True)
    loc = _make_location(auth_headers, "PQ-LOC")
    assert _receive_serials(auth_headers, comp["id"], loc["id"], ["PQ-1", "PQ-2"], lot_number="PQ-LOT").status_code == 201
    bom = _create_bom(auth_headers, fg["id"], [(comp["id"], 2)]).json()
    wo = _create_wo(auth_headers, fg["id"], 1, bom_id=bom["id"]).json()
    assert client.get(f"/api/products/{comp['id']}", headers=auth_headers).json()["reserved_qty"] == 0

    client.post(f"/api/work-orders/{wo['id']}/release", headers=auth_headers)
    body = client.get(f"/api/products/{comp['id']}", headers=auth_headers).json()
    assert body["reserved_qty"] == 2
    assert body["quantity"] == 0
    assert body["sellable_qty"] == 0

    lot = client.get("/api/lots", params={"product_id": comp["id"]}, headers=auth_headers).json()["items"][0]
    assert lot["reserved_count"] == 2


def test_reserved_serial_cannot_be_moved_by_journal(auth_headers):
    fg = _make_product(auth_headers, "RG-FG", serialized=True)
    comp = _make_product(auth_headers, "RG-COMP", serialized=True)
    loc = _make_location(auth_headers, "RG-LOC")
    assert _receive_serials(auth_headers, comp["id"], loc["id"], ["RG-1"]).status_code == 201
    bom = _create_bom(auth_headers, fg["id"], [(comp["id"], 1)]).json()
    wo = _create_wo(auth_headers, fg["id"], 1, bom_id=bom["id"]).json()
    client.post(f"/api/work-orders/{wo['id']}/release", headers=auth_headers)

    db = TestingSessionLocal()
    try:
        user = db.query(User).first()
        serial = db.query(SerialNumber).filter(SerialNumber.serial_number == "RG-1").first()
        try:
            inventory.post_journal_entry(
                db, product_id=serial.product_id, user_id=user.id,
                quantity_change=-1, movement_type=inventory.TRANSFER_OUT,
                from_location_id=serial.location_id, to_location_id=loc["id"],
                serial_id=serial.id,
            )
        except inventory.InventoryError as e:
            assert "reserved" in str(e)
        else:
            raise AssertionError("expected InventoryError for reserved serial")
    finally:
        db.close()
