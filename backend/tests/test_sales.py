from datetime import date

from app.models import Lot, Product, StockMovement, User
from app.services import inventory
from tests.conftest import TestingSessionLocal, client


def _make_product(auth_headers, sku="SALE-PROD", quantity=10):
    return client.post("/api/products", json={
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


def test_refund_twice_rejected(auth_headers):
    prod = _make_product(auth_headers, quantity=10)
    sale = _make_sale(auth_headers, [{"product_id": prod["id"], "quantity": 1, "unit_price": 20.00}]).json()
    client.put(f"/api/sales/{sale['id']}/refund", headers=auth_headers)
    resp = client.put(f"/api/sales/{sale['id']}/refund", headers=auth_headers)
    assert resp.status_code == 400


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
    prod = client.post("/api/products", json={
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
