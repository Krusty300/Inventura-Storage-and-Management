from datetime import date

from app.models import Location, Lot, Product, StockMovement, User
from app.services import inventory
from tests.conftest import TestingSessionLocal, client


def _make_product(auth_headers, sku="SALE-PROD", quantity=10):
    return client.post("/api/products", json={"location_id": 1, 
        "sku": sku, "name": sku, "unit_price": 20.00, "cost_price": 10.00, "quantity": quantity,
    }, headers=auth_headers).json()


def _make_sale(auth_headers, items):
    return client.post("/api/sales", json={"items": items}, headers=auth_headers)


def test_create_sale_decrements_stock_and_logs_movement(auth_headers):
    prod = _make_product(auth_headers)
    resp = _make_sale(auth_headers, [{"product_id": prod["id"], "quantity": 3, "unit_price": 20.00}])
    assert resp.status_code == 201
    data = resp.json()
    assert data["invoice_number"].startswith("INV-")
    assert data["total_amount"] == 60.0
    assert data["status"] == "completed"
    updated = client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()
    assert updated["quantity"] == 7
    movements = client.get(f"/api/products/{prod['id']}/movements", headers=auth_headers).json()
    assert any(m["movement_type"] == "out" and m["quantity_change"] == -3 for m in movements)


def test_sale_mobile_money_with_provider(auth_headers):
    prod = _make_product(auth_headers)
    resp = client.post("/api/sales", json={
        "items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 20.00}],
        "payment_method": "mobile_money",
        "payment_provider": "m-pesa",
    }, headers=auth_headers)
    assert resp.status_code == 201
    data = resp.json()
    assert data["payment_method"] == "mobile_money"
    assert data["payment_provider"] == "m-pesa"


def test_sale_mobile_money_requires_provider(auth_headers):
    prod = _make_product(auth_headers)
    resp = client.post("/api/sales", json={
        "items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 20.00}],
        "payment_method": "mobile_money",
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "payment_provider is required" in resp.json()["detail"]


def test_sale_mobile_money_rejects_unknown_provider(auth_headers):
    prod = _make_product(auth_headers)
    resp = client.post("/api/sales", json={
        "items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 20.00}],
        "payment_method": "mobile_money",
        "payment_provider": "bitcoin",
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "payment_provider must be one of" in resp.json()["detail"]


def test_sale_rejects_unknown_payment_method(auth_headers):
    prod = _make_product(auth_headers)
    resp = client.post("/api/sales", json={
        "items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 20.00}],
        "payment_method": "bitcoin",
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "payment_method must be one of" in resp.json()["detail"]


def test_sale_with_discount_reduces_tax_and_total(auth_headers):
    from app.models import Settings

    db = TestingSessionLocal()
    try:
        settings = db.query(Settings).first()
        if settings is None:
            settings = Settings(currency_symbol="$", tax_rate=10)
            db.add(settings)
        else:
            settings.tax_rate = 10
        db.commit()
    finally:
        db.close()

    prod = _make_product(auth_headers)
    resp = client.post("/api/sales", json={
        "items": [{"product_id": prod["id"], "quantity": 4, "unit_price": 20.00}],
        "discount_amount": 30.0,
    }, headers=auth_headers)
    assert resp.status_code == 201
    data = resp.json()
    assert data["subtotal"] == 80.0
    assert data["discount_amount"] == 30.0
    assert data["tax_amount"] == 5.0  # (80 - 30) * 10%
    assert data["total_amount"] == 55.0


def test_sale_discount_over_subtotal_rejected(auth_headers):
    prod = _make_product(auth_headers)
    resp = client.post("/api/sales", json={
        "items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 20.00}],
        "discount_amount": 99.0,
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "exceed" in resp.json()["detail"]


def test_sale_requires_at_least_one_item(auth_headers):
    resp = _make_sale(auth_headers, [])
    assert resp.status_code == 400


def test_sale_zero_or_negative_quantity_rejected(auth_headers):
    prod = _make_product(auth_headers)
    resp = _make_sale(auth_headers, [{"product_id": prod["id"], "quantity": 0, "unit_price": 20.00}])
    assert resp.status_code == 422
    resp = _make_sale(auth_headers, [{"product_id": prod["id"], "quantity": -2, "unit_price": 20.00}])
    assert resp.status_code == 422


def test_sale_negative_price_rejected(auth_headers):
    prod = _make_product(auth_headers)
    resp = _make_sale(auth_headers, [{"product_id": prod["id"], "quantity": 1, "unit_price": -5.00}])
    assert resp.status_code == 422


def test_sale_unknown_customer_rejected(auth_headers):
    prod = _make_product(auth_headers)
    resp = client.post("/api/sales", json={
        "customer_id": 99999,
        "items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 20.00}],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "not found" in resp.json()["detail"].lower()
    updated = client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()
    assert updated["quantity"] == 10


def test_sale_with_valid_customer_succeeds(auth_headers):
    cust = client.post("/api/customers", json={"name": "Acme Corp"}, headers=auth_headers).json()
    prod = _make_product(auth_headers)
    resp = client.post("/api/sales", json={
        "customer_id": cust["id"],
        "items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 20.00}],
    }, headers=auth_headers)
    assert resp.status_code == 201
    assert resp.json()["customer_name"] == "Acme Corp"


def test_sale_insufficient_stock_rejected(auth_headers):
    prod = _make_product(auth_headers, quantity=5)
    resp = _make_sale(auth_headers, [{"product_id": prod["id"], "quantity": 6, "unit_price": 20.00}])
    assert resp.status_code == 400


def test_sale_duplicate_lines_cannot_bypass_stock_check(auth_headers):
    prod = _make_product(auth_headers, quantity=5)
    resp = _make_sale(auth_headers, [
        {"product_id": prod["id"], "quantity": 3, "unit_price": 20.00},
        {"product_id": prod["id"], "quantity": 3, "unit_price": 20.00},
    ])
    assert resp.status_code == 400
    updated = client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()
    assert updated["quantity"] == 5


def test_sale_of_inactive_product_rejected(auth_headers):
    prod = _make_product(auth_headers)
    client.put(f"/api/products/{prod['id']}", json={"is_active": False}, headers=auth_headers)
    resp = _make_sale(auth_headers, [{"product_id": prod["id"], "quantity": 1, "unit_price": 20.00}])
    assert resp.status_code == 404


def test_sale_blocked_by_pending_quality_check(auth_headers):
    prod = _make_product(auth_headers, sku="QC-BLOCK", quantity=5)
    qc = client.post("/api/quality-checks", json={
        "product_id": prod["id"], "result": "pending",
    }, headers=auth_headers)
    assert qc.status_code == 201

    resp = _make_sale(auth_headers, [{"product_id": prod["id"], "quantity": 1, "unit_price": 20.00}])
    assert resp.status_code == 400
    assert "quality check" in resp.json()["detail"].lower()
    updated = client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()
    assert updated["quantity"] == 5


def test_sale_allowed_after_pending_quality_check_resolved(auth_headers):
    prod = _make_product(auth_headers, sku="QC-CLEAR", quantity=5)
    qc = client.post("/api/quality-checks", json={
        "product_id": prod["id"], "result": "pending",
    }, headers=auth_headers).json()

    resp = client.put(f"/api/quality-checks/{qc['id']}", json={"result": "pass"}, headers=auth_headers)
    assert resp.status_code == 200

    resp = _make_sale(auth_headers, [{"product_id": prod["id"], "quantity": 1, "unit_price": 20.00}])
    assert resp.status_code == 201


def test_sale_allowed_when_only_non_pending_checks_exist(auth_headers):
    prod = _make_product(auth_headers, sku="QC-PASS", quantity=5)
    assert client.post("/api/quality-checks", json={
        "product_id": prod["id"], "result": "pass",
    }, headers=auth_headers).status_code == 201

    resp = _make_sale(auth_headers, [{"product_id": prod["id"], "quantity": 1, "unit_price": 20.00}])
    assert resp.status_code == 201


def test_location_scoped_pending_qc_only_blocks_that_location(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "QC-LOC-BLK", "name": "QC Location Block", "unit_price": 10.0, "cost_price": 5.0, "quantity": 0,
    }, headers=auth_headers).json()
    loc_a = _make_location("QC-LOC-BLK-A")
    loc_b = _make_location("QC-LOC-BLK-B")

    db = TestingSessionLocal()
    try:
        user = db.query(User).first()
        _receive_to_locations(db, user, prod["id"], [(loc_a, 5), (loc_b, 5)])
        db.commit()
    finally:
        db.close()

    assert client.post("/api/quality-checks", json={
        "product_id": prod["id"], "location_id": loc_a, "result": "pending",
    }, headers=auth_headers).status_code == 201

    blocked = client.post("/api/sales", json={
        "items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 10.0, "location_id": loc_a}],
    }, headers=auth_headers)
    assert blocked.status_code == 400
    assert "quality check" in blocked.json()["detail"].lower()

    # auto-location sale may draw from the quarantined location, so it is blocked too
    auto = client.post("/api/sales", json={
        "items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 10.0}],
    }, headers=auth_headers)
    assert auto.status_code == 400

    ok = client.post("/api/sales", json={
        "items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 10.0, "location_id": loc_b}],
    }, headers=auth_headers)
    assert ok.status_code == 201

    db = TestingSessionLocal()
    try:
        assert inventory.on_hand(db, product_id=prod["id"], location_id=loc_a) == 5
        assert inventory.on_hand(db, product_id=prod["id"], location_id=loc_b) == 4
    finally:
        db.close()


def test_refund_restores_stock(auth_headers):
    prod = _make_product(auth_headers, quantity=10)
    sale = _make_sale(auth_headers, [{"product_id": prod["id"], "quantity": 4, "unit_price": 20.00}]).json()
    resp = client.put(f"/api/sales/{sale['id']}/refund", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "refunded"
    updated = client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()
    assert updated["quantity"] == 10
    movements = client.get(f"/api/products/{prod['id']}/movements", headers=auth_headers).json()
    assert any(m["movement_type"] == "return" and m["quantity_change"] == 4 for m in movements)


def test_refund_restores_stock_to_original_location(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "REFUND-LOC", "name": "Refund Loc Item", "unit_price": 10.0, "cost_price": 5.0, "quantity": 0,
    }, headers=auth_headers).json()
    loc_a = _make_location("REFUND-A")
    loc_b = _make_location("REFUND-B")

    db = TestingSessionLocal()
    try:
        user = db.query(User).first()
        _receive_to_locations(db, user, prod["id"], [(loc_a, 5), (loc_b, 5)])
        db.commit()
        path_a = db.get(Location, loc_a).path
    finally:
        db.close()

    sale = client.post("/api/sales", json={
        "items": [{"product_id": prod["id"], "quantity": 3, "unit_price": 10.0, "location_id": loc_a}],
    }, headers=auth_headers)
    assert sale.status_code == 201
    assert sale.json()["locations"] == [path_a]

    refund = client.put(f"/api/sales/{sale.json()['id']}/refund", headers=auth_headers)
    assert refund.status_code == 200

    db = TestingSessionLocal()
    try:
        assert inventory.on_hand(db, product_id=prod["id"], location_id=loc_a) == 5
        assert inventory.on_hand(db, product_id=prod["id"], location_id=loc_b) == 5
        assert inventory.on_hand(db, product_id=prod["id"]) == 10
        returns = db.query(StockMovement).filter(
            StockMovement.product_id == prod["id"],
            StockMovement.movement_type == "return",
        ).all()
        assert returns and all(m.from_location_id == loc_a for m in returns)
        assert db.get(Product, prod["id"]).quantity == 10
    finally:
        db.close()


def test_refund_twice_rejected(auth_headers):
    prod = _make_product(auth_headers, quantity=10)
    sale = _make_sale(auth_headers, [{"product_id": prod["id"], "quantity": 1, "unit_price": 20.00}]).json()
    client.put(f"/api/sales/{sale['id']}/refund", headers=auth_headers)
    resp = client.put(f"/api/sales/{sale['id']}/refund", headers=auth_headers)
    assert resp.status_code == 400


def test_refund_serialized_invoice_restores_serials(auth_headers):
    loc = client.post("/api/locations", json={
        "code": "SALE-SER-LOC", "name": "SALE-SER-LOC", "location_type": "bin",
    }, headers=auth_headers).json()
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "SALE-SER", "name": "Serialized Sale", "unit_price": 25.00, "cost_price": 10.00,
        "quantity": 0, "is_serialized": True,
    }, headers=auth_headers).json()
    recv = client.post("/api/receipts", json={"items": [{
        "product_id": prod["id"], "quantity": 3, "location_id": loc["id"],
        "serial_numbers": ["SR-1", "SR-2", "SR-3"],
    }]}, headers=auth_headers)
    assert recv.status_code == 201

    shipment = client.post("/api/shipments", json={
        "items": [{"product_id": prod["id"], "quantity": 2}],
    }, headers=auth_headers).json()
    sid = shipment["id"]
    assert client.post(f"/api/shipments/{sid}/pick", headers=auth_headers).status_code == 200
    assert client.post(f"/api/shipments/{sid}/pack", headers=auth_headers).status_code == 200
    assert client.post(f"/api/shipments/{sid}/ship", headers=auth_headers).status_code == 200
    sale = client.post(f"/api/shipments/{sid}/create-sale", params={"payment_method": "card"}, headers=auth_headers).json()
    assert sale["payment_method"] == "card"

    serials = client.get(f"/api/serial-numbers?product_id={prod['id']}&limit=10", headers=auth_headers).json()["items"]
    assert sum(1 for s in serials if s["status"] == "sold") == 2
    assert sum(1 for s in serials if s["status"] == "in_stock") == 1

    refund = client.put(f"/api/sales/{sale['id']}/refund", headers=auth_headers)
    assert refund.status_code == 200
    assert refund.json()["status"] == "refunded"

    serials = client.get(f"/api/serial-numbers?product_id={prod['id']}&limit=10", headers=auth_headers).json()["items"]
    assert all(s["status"] == "in_stock" for s in serials)
    assert all(s["sold_at"] is None for s in serials)
    assert client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()["quantity"] == 3


def test_refund_serialized_lot_restores_lot_status(auth_headers):
    loc = client.post("/api/locations", json={
        "code": "SALE-SER-LOT-LOC", "name": "SALE-SER-LOT-LOC", "location_type": "bin",
    }, headers=auth_headers).json()
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "SALE-SER-LOT", "name": "Serialized Sale Lot", "unit_price": 25.00, "cost_price": 10.00,
        "quantity": 0, "is_serialized": True,
    }, headers=auth_headers).json()
    resp = client.post("/api/receipts", json={"items": [{
        "product_id": prod["id"], "quantity": 2, "location_id": loc["id"],
        "lot_number": "SALE-LOT-1", "serial_numbers": ["SSL-1", "SSL-2"],
    }]}, headers=auth_headers)
    assert resp.status_code == 201

    def _lot():
        return client.get("/api/lots", params={"product_id": prod["id"]}, headers=auth_headers).json()["items"][0]

    assert _lot()["status"] == "in_stock"

    shipment = client.post("/api/shipments", json={
        "items": [{"product_id": prod["id"], "quantity": 2}],
    }, headers=auth_headers).json()
    sid = shipment["id"]
    assert client.post(f"/api/shipments/{sid}/pick", headers=auth_headers).status_code == 200
    assert client.post(f"/api/shipments/{sid}/pack", headers=auth_headers).status_code == 200
    assert client.post(f"/api/shipments/{sid}/ship", headers=auth_headers).status_code == 200

    lot = _lot()
    assert lot["status"] == "sold"
    assert lot["serial_count"] == 0

    sale = client.post(f"/api/shipments/{sid}/create-sale", params={"payment_method": "card"}, headers=auth_headers).json()
    refund = client.put(f"/api/sales/{sale['id']}/refund", headers=auth_headers)
    assert refund.status_code == 200

    lot = _lot()
    assert lot["status"] == "in_stock"
    assert lot["serial_count"] == 2


def test_sale_search_and_stats(auth_headers):
    prod = _make_product(auth_headers)
    _make_sale(auth_headers, [{"product_id": prod["id"], "quantity": 2, "unit_price": 20.00}])
    res = client.get("/api/sales", headers=auth_headers).json()
    assert len(res["items"]) >= 1
    inv = res["items"][0]["invoice_number"]
    res = client.get("/api/sales", params={"search": inv}, headers=auth_headers).json()
    assert len(res["items"]) == 1
    stats = client.get("/api/sales/stats", headers=auth_headers).json()
    assert stats["total_sales"] >= 1
    assert stats["total_revenue"] >= 40.0


def test_sale_pdf_generated(auth_headers):
    prod = _make_product(auth_headers)
    sale = _make_sale(auth_headers, [{"product_id": prod["id"], "quantity": 2, "unit_price": 20.00}]).json()
    resp = client.get(f"/api/sales/{sale['id']}/pdf", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.content.startswith(b"%PDF")


def test_sale_pdf_not_found(auth_headers):
    assert client.get("/api/sales/99999/pdf", headers=auth_headers).status_code == 404


def test_checkout_allocates_soonest_expiry_lots_first(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, 
        "sku": "FEFO-PROD", "name": "FEFO Item", "unit_price": 10.0, "cost_price": 5.0, "quantity": 0,
    }, headers=auth_headers).json()

    db = TestingSessionLocal()
    try:
        user = db.query(User).first()
        lot_soon = Lot(product_id=prod["id"], lot_number="LOT-SOON", expiry_date=date(2026, 1, 31))
        lot_late = Lot(product_id=prod["id"], lot_number="LOT-LATE", expiry_date=date(2026, 12, 31))
        db.add_all([lot_soon, lot_late])
        db.commit()
        for lot, qty in ((lot_soon, 5), (lot_late, 5)):
            inventory.post_journal_entry(
                db, product_id=prod["id"], user_id=user.id,
                quantity_change=qty, movement_type=inventory.RECEIVE, lot_id=lot.id,
                reference=f"Lot {lot.lot_number}",
            )
        db.commit()
        soon_id, late_id = lot_soon.id, lot_late.id
    finally:
        db.close()

    resp = client.post("/api/sales", json={
        "items": [{"product_id": prod["id"], "quantity": 7, "unit_price": 10.0}],
    }, headers=auth_headers)
    assert resp.status_code == 201

    db = TestingSessionLocal()
    try:
        out = db.query(StockMovement).filter(
            StockMovement.product_id == prod["id"],
            StockMovement.movement_type == "out",
        ).all()
        assert sorted((m.lot_id, m.quantity_change) for m in out) == sorted(
            [(soon_id, -5), (late_id, -2)]
        )
        assert inventory.on_hand(db, product_id=prod["id"]) == 3
        assert inventory.on_hand(db, product_id=prod["id"], lot_id=late_id) == 3
        assert inventory.on_hand(db, product_id=prod["id"], lot_id=soon_id) == 0
        assert db.get(Product, prod["id"]).quantity == 3
    finally:
        db.close()


def test_sale_of_stock_located_in_a_bin_succeeds(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, 
        "sku": "LOC-SALE", "name": "Located Item", "unit_price": 10.0, "cost_price": 5.0, "quantity": 0,
    }, headers=auth_headers).json()

    db = TestingSessionLocal()
    try:
        user = db.query(User).first()
        loc = Location(name="Bin A", code="BIN-A")
        db.add(loc)
        db.commit()
        db.refresh(loc)
        inventory.post_journal_entry(
            db, product_id=prod["id"], user_id=user.id,
            quantity_change=10, movement_type=inventory.RECEIVE,
            to_location_id=loc.id, reference="Inbound",
        )
        db.commit()
        loc_id = loc.id
    finally:
        db.close()

    resp = client.post("/api/sales", json={
        "items": [{"product_id": prod["id"], "quantity": 3, "unit_price": 10.0}],
    }, headers=auth_headers)
    assert resp.status_code == 201

    db = TestingSessionLocal()
    try:
        assert inventory.on_hand(db, product_id=prod["id"]) == 7
        assert inventory.on_hand(db, product_id=prod["id"], location_id=loc_id) == 7
        assert db.get(Product, prod["id"]).quantity == 7
    finally:
        db.close()


def _receive_to_locations(db, user, product_id, entries):
    """Receive `quantity` of a product into each (location_id, quantity) entry."""
    for loc_id, qty in entries:
        inventory.post_journal_entry(
            db, product_id=product_id, user_id=user.id,
            quantity_change=qty, movement_type=inventory.RECEIVE,
            to_location_id=loc_id, reference="Inbound",
        )


def _make_location(code):
    db = TestingSessionLocal()
    try:
        loc = Location(name=code, code=code)
        db.add(loc)
        db.commit()
        db.refresh(loc)
        return loc.id
    finally:
        db.close()


def test_sale_with_location_consumes_from_that_location_only(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "LOC-AUTO", "name": "Multi-Loc Item", "unit_price": 10.0, "cost_price": 5.0, "quantity": 0,
    }, headers=auth_headers).json()
    loc_a = _make_location("SALE-A")
    loc_b = _make_location("SALE-B")

    db = TestingSessionLocal()
    try:
        user = db.query(User).first()
        _receive_to_locations(db, user, prod["id"], [(loc_a, 5), (loc_b, 5)])
        db.commit()
    finally:
        db.close()

    resp = client.post("/api/sales", json={
        "items": [{"product_id": prod["id"], "quantity": 3, "unit_price": 10.0, "location_id": loc_a}],
    }, headers=auth_headers)
    assert resp.status_code == 201

    db = TestingSessionLocal()
    try:
        assert inventory.on_hand(db, product_id=prod["id"], location_id=loc_a) == 2
        assert inventory.on_hand(db, product_id=prod["id"], location_id=loc_b) == 5
        assert inventory.on_hand(db, product_id=prod["id"]) == 7
        out = db.query(StockMovement).filter(
            StockMovement.product_id == prod["id"],
            StockMovement.movement_type == "out",
        ).all()
        assert out and all(m.from_location_id == loc_a for m in out)
    finally:
        db.close()


def test_sale_split_across_locations(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "LOC-SPLIT", "name": "Split Item", "unit_price": 10.0, "cost_price": 5.0, "quantity": 0,
    }, headers=auth_headers).json()
    loc_a = _make_location("SPLIT-A")
    loc_b = _make_location("SPLIT-B")

    db = TestingSessionLocal()
    try:
        user = db.query(User).first()
        _receive_to_locations(db, user, prod["id"], [(loc_a, 3), (loc_b, 4)])
        db.commit()
    finally:
        db.close()

    resp = client.post("/api/sales", json={
        "items": [
            {"product_id": prod["id"], "quantity": 2, "unit_price": 10.0, "location_id": loc_a},
            {"product_id": prod["id"], "quantity": 3, "unit_price": 10.0, "location_id": loc_b},
        ],
    }, headers=auth_headers)
    assert resp.status_code == 201

    db = TestingSessionLocal()
    try:
        assert inventory.on_hand(db, product_id=prod["id"], location_id=loc_a) == 1
        assert inventory.on_hand(db, product_id=prod["id"], location_id=loc_b) == 1
        assert inventory.on_hand(db, product_id=prod["id"]) == 2
    finally:
        db.close()


def test_sale_location_insufficient_stock_rejected(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "LOC-SHORT", "name": "Short Item", "unit_price": 10.0, "cost_price": 5.0, "quantity": 0,
    }, headers=auth_headers).json()
    loc_a = _make_location("SHORT-A")
    loc_b = _make_location("SHORT-B")

    db = TestingSessionLocal()
    try:
        user = db.query(User).first()
        _receive_to_locations(db, user, prod["id"], [(loc_a, 5)])
        db.commit()
    finally:
        db.close()

    over = client.post("/api/sales", json={
        "items": [{"product_id": prod["id"], "quantity": 6, "unit_price": 10.0, "location_id": loc_a}],
    }, headers=auth_headers)
    assert over.status_code == 400

    empty = client.post("/api/sales", json={
        "items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 10.0, "location_id": loc_b}],
    }, headers=auth_headers)
    assert empty.status_code == 400

    db = TestingSessionLocal()
    try:
        assert inventory.on_hand(db, product_id=prod["id"]) == 5
        assert db.get(Product, prod["id"]).quantity == 5
    finally:
        db.close()


def test_sale_unknown_or_inactive_location_rejected(auth_headers):
    prod = _make_product(auth_headers, sku="LOC-UNKNOWN", quantity=5)
    resp = client.post("/api/sales", json={
        "items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 10.0, "location_id": 99999}],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "not found" in resp.json()["detail"]

    loc = client.post("/api/locations", json={
        "code": "SALE-INACTIVE", "name": "Inactive Loc", "location_type": "bin",
    }, headers=auth_headers).json()
    client.put(f"/api/locations/{loc['id']}", json={"is_active": False}, headers=auth_headers)
    resp = client.post("/api/sales", json={
        "items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 10.0, "location_id": loc["id"]}],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "inactive" in resp.json()["detail"]


def test_sale_location_excludes_quarantined_lots(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "LOC-Q", "name": "Quarantined Item", "unit_price": 10.0, "cost_price": 5.0, "quantity": 0,
    }, headers=auth_headers).json()
    loc_a = _make_location("Q-LOC")

    db = TestingSessionLocal()
    try:
        user = db.query(User).first()
        lot = Lot(product_id=prod["id"], lot_number="Q-LOT-1", status="quarantined")
        db.add(lot)
        db.commit()
        db.refresh(lot)
        inventory.post_journal_entry(
            db, product_id=prod["id"], user_id=user.id,
            quantity_change=5, movement_type=inventory.RECEIVE,
            to_location_id=loc_a, lot_id=lot.id, reference="Quarantined inbound",
        )
        db.commit()
    finally:
        db.close()

    resp = client.post("/api/sales", json={
        "items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 10.0, "location_id": loc_a}],
    }, headers=auth_headers)
    assert resp.status_code == 400

    auto = client.post("/api/sales", json={
        "items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 10.0}],
    }, headers=auth_headers)
    assert auto.status_code == 400


def test_sale_response_includes_source_locations(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "LOC-RESP", "name": "Located Response", "unit_price": 10.0, "cost_price": 5.0, "quantity": 0,
    }, headers=auth_headers).json()
    loc_a = _make_location("RESP-A")
    loc_b = _make_location("RESP-B")

    db = TestingSessionLocal()
    try:
        user = db.query(User).first()
        _receive_to_locations(db, user, prod["id"], [(loc_a, 5), (loc_b, 5)])
        db.commit()
        path_a = db.get(Location, loc_a).path
        path_b = db.get(Location, loc_b).path
    finally:
        db.close()

    pinned = client.post("/api/sales", json={
        "items": [{"product_id": prod["id"], "quantity": 2, "unit_price": 10.0, "location_id": loc_a}],
    }, headers=auth_headers)
    assert pinned.status_code == 201
    assert pinned.json()["locations"] == [path_a]
    item = pinned.json()["items"][0]
    assert item["locations"] == [path_a]
    assert item["location"] == path_a

    auto = client.post("/api/sales", json={
        "items": [{"product_id": prod["id"], "quantity": 4, "unit_price": 10.0}],
    }, headers=auth_headers)
    assert auto.status_code == 201
    assert auto.json()["locations"] == sorted([path_a, path_b])

    detail = client.get(f"/api/sales/{pinned.json()['id']}", headers=auth_headers)
    assert detail.status_code == 200
    assert detail.json()["locations"] == [path_a]

    listing = client.get("/api/sales", headers=auth_headers).json()
    by_invoice = {s["invoice_number"]: s["locations"] for s in listing["items"]}
    assert by_invoice[pinned.json()["invoice_number"]] == [path_a]
    assert by_invoice[auto.json()["invoice_number"]] == sorted([path_a, path_b])


def test_shipment_invoice_lists_source_location(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "SHP-LOC", "name": "Shipment Loc Item", "unit_price": 10.0, "cost_price": 5.0, "quantity": 0,
    }, headers=auth_headers).json()
    loc = _make_location("SHP-LOC-BIN")

    db = TestingSessionLocal()
    try:
        user = db.query(User).first()
        _receive_to_locations(db, user, prod["id"], [(loc, 5)])
        db.commit()
        path = db.get(Location, loc).path
    finally:
        db.close()

    shipment = client.post("/api/shipments", json={
        "items": [{"product_id": prod["id"], "quantity": 2}],
    }, headers=auth_headers).json()
    sid = shipment["id"]
    assert client.post(f"/api/shipments/{sid}/pick", headers=auth_headers).status_code == 200
    assert client.post(f"/api/shipments/{sid}/pack", headers=auth_headers).status_code == 200
    assert client.post(f"/api/shipments/{sid}/ship", headers=auth_headers).status_code == 200
    sale = client.post(f"/api/shipments/{sid}/create-sale", headers=auth_headers).json()
    assert sale["locations"] == [path]
    item = sale["items"][0]
    assert item["locations"] == [path]
    assert item["location"] == path

    detail = client.get(f"/api/sales/{sale['id']}", headers=auth_headers).json()
    assert detail["locations"] == [path]

    listing = client.get("/api/sales", headers=auth_headers).json()
    by_invoice = {s["invoice_number"]: s["locations"] for s in listing["items"]}
    assert by_invoice[sale["invoice_number"]] == [path]
