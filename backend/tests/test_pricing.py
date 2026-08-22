"""Tests for price lists, customer groups, promotions, and pricing integration."""

from datetime import date, timedelta

from app.models.customer import Customer
from app.models.customer_group import CustomerGroup
from app.models.price_list import PriceList, PriceListItem
from app.models.product import Product
from app.models.promotion import Promotion
from app.services.pricing import resolve_price, validate_promotion, PromoError, apply_promotion
from tests.conftest import TestingSessionLocal, client


def _make_product(auth_headers, sku="PROMO-PROD", unit_price=50.0, quantity=100):
    return client.post("/api/products", json={
        "location_id": 1, "sku": sku, "name": sku,
        "unit_price": unit_price, "cost_price": unit_price / 2, "quantity": quantity,
    }, headers=auth_headers).json()


# ── Price List CRUD ──

def test_create_price_list(auth_headers):
    resp = client.post("/api/price-lists", json={
        "name": "Wholesale",
        "description": "Bulk pricing",
        "items": [],
    }, headers=auth_headers)
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Wholesale"
    assert data["is_default"] is False
    assert data["is_active"] is True


def test_price_list_default_flag(auth_headers):
    client.post("/api/price-lists", json={"name": "PL1"}, headers=auth_headers)
    resp = client.post("/api/price-lists", json={"name": "PL2", "is_default": True}, headers=auth_headers)
    assert resp.status_code == 201
    assert resp.json()["is_default"] is True
    pl1 = client.get("/api/price-lists/1", headers=auth_headers).json()
    assert pl1["is_default"] is False


def test_price_list_unique_name(auth_headers):
    client.post("/api/price-lists", json={"name": "UniquePL"}, headers=auth_headers)
    resp = client.post("/api/price-lists", json={"name": "UniquePL"}, headers=auth_headers)
    assert resp.status_code == 400


def test_price_list_with_items(auth_headers):
    prod = _make_product(auth_headers, sku="PLITEM-1")
    resp = client.post("/api/price-lists", json={
        "name": "With Items",
        "items": [{"product_id": prod["id"], "price": 30.0, "min_qty": 1}],
    }, headers=auth_headers)
    assert resp.status_code == 201
    data = resp.json()
    assert len(data["items"]) == 1
    assert data["items"][0]["price"] == 30.0


def test_update_price_list(auth_headers):
    resp = client.post("/api/price-lists", json={"name": "UpdateMe"}, headers=auth_headers)
    pl_id = resp.json()["id"]
    resp = client.put(f"/api/price-lists/{pl_id}", json={"description": "Updated"}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["description"] == "Updated"


def test_delete_price_list(auth_headers):
    resp = client.post("/api/price-lists", json={"name": "DeleteMe"}, headers=auth_headers)
    pl_id = resp.json()["id"]
    resp = client.delete(f"/api/price-lists/{pl_id}", headers=auth_headers)
    assert resp.status_code == 200


def test_cannot_delete_default_price_list(auth_headers):
    resp = client.post("/api/price-lists", json={"name": "Default", "is_default": True}, headers=auth_headers)
    pl_id = resp.json()["id"]
    resp = client.delete(f"/api/price-lists/{pl_id}", headers=auth_headers)
    assert resp.status_code == 400


# ── Price Resolution ──

def test_resolve_price_fallback_to_product_unit_price(auth_headers):
    prod = _make_product(auth_headers, sku="RESOLVE-1", unit_price=75.0)
    db = TestingSessionLocal()
    price = resolve_price(db, prod["id"])
    db.close()
    assert price == 75.0


def test_resolve_price_from_default_list(auth_headers):
    prod = _make_product(auth_headers, sku="RESOLVE-2", unit_price=75.0)
    client.post("/api/price-lists", json={
        "name": "Default PL",
        "is_default": True,
        "items": [{"product_id": prod["id"], "price": 60.0, "min_qty": 1}],
    }, headers=auth_headers)
    db = TestingSessionLocal()
    price = resolve_price(db, prod["id"])
    db.close()
    assert price == 60.0


def test_resolve_price_min_qty(auth_headers):
    prod = _make_product(auth_headers, sku="RESOLVE-3", unit_price=75.0)
    client.post("/api/price-lists", json={
        "name": "Tiered PL",
        "is_default": True,
        "items": [
            {"product_id": prod["id"], "price": 65.0, "min_qty": 1},
            {"product_id": prod["id"], "price": 55.0, "min_qty": 10},
        ],
    }, headers=auth_headers)
    db = TestingSessionLocal()
    assert resolve_price(db, prod["id"], qty=1) == 65.0
    assert resolve_price(db, prod["id"], qty=10) == 55.0
    assert resolve_price(db, prod["id"], qty=5) == 65.0
    db.close()


def test_resolve_price_inactive_list_ignored(auth_headers):
    prod = _make_product(auth_headers, sku="RESOLVE-4", unit_price=75.0)
    resp = client.post("/api/price-lists", json={
        "name": "Inactive PL",
        "is_default": True,
        "items": [{"product_id": prod["id"], "price": 10.0, "min_qty": 1}],
    }, headers=auth_headers)
    pl_id = resp.json()["id"]
    client.put(f"/api/price-lists/{pl_id}", json={"is_active": False}, headers=auth_headers)
    db = TestingSessionLocal()
    price = resolve_price(db, prod["id"])
    db.close()
    assert price == 75.0


# ── Customer Groups ──

def test_create_customer_group(auth_headers):
    resp = client.post("/api/customer-groups", json={"name": "VIP"}, headers=auth_headers)
    assert resp.status_code == 201
    assert resp.json()["name"] == "VIP"


def test_customer_group_unique_name(auth_headers):
    client.post("/api/customer-groups", json={"name": "UniqueGroup"}, headers=auth_headers)
    resp = client.post("/api/customer-groups", json={"name": "UniqueGroup"}, headers=auth_headers)
    assert resp.status_code == 400


def test_delete_empty_group(auth_headers):
    resp = client.post("/api/customer-groups", json={"name": "EmptyGroup"}, headers=auth_headers)
    g_id = resp.json()["id"]
    resp = client.delete(f"/api/customer-groups/{g_id}", headers=auth_headers)
    assert resp.status_code == 200


def test_customer_group_with_price_list(auth_headers):
    pl = client.post("/api/price-lists", json={"name": "Group PL"}, headers=auth_headers).json()
    resp = client.post("/api/customer-groups", json={"name": "PricedGroup", "price_list_id": pl["id"]}, headers=auth_headers)
    assert resp.status_code == 201
    assert resp.json()["price_list_id"] == pl["id"]


# ── Promotions CRUD ──

def test_create_promotion(auth_headers):
    resp = client.post("/api/promotions", json={
        "code": "SAVE20",
        "discount_type": "percentage",
        "value": 20,
    }, headers=auth_headers)
    assert resp.status_code == 201
    data = resp.json()
    assert data["code"] == "SAVE20"
    assert data["discount_type"] == "percentage"
    assert data["value"] == 20


def test_promotion_code_uppercased(auth_headers):
    resp = client.post("/api/promotions", json={
        "code": "lower",
        "discount_type": "fixed",
        "value": 5,
    }, headers=auth_headers)
    assert resp.json()["code"] == "LOWER"


def test_promotion_percentage_over_100_rejected(auth_headers):
    resp = client.post("/api/promotions", json={
        "code": "TOOMUCH",
        "discount_type": "percentage",
        "value": 150,
    }, headers=auth_headers)
    assert resp.status_code == 400


def test_promotion_unique_code(auth_headers):
    client.post("/api/promotions", json={"code": "DUP", "discount_type": "fixed", "value": 5}, headers=auth_headers)
    resp = client.post("/api/promotions", json={"code": "DUP", "discount_type": "fixed", "value": 5}, headers=auth_headers)
    assert resp.status_code == 400


def test_delete_promotion(auth_headers):
    resp = client.post("/api/promotions", json={"code": "DELME", "discount_type": "fixed", "value": 1}, headers=auth_headers)
    p_id = resp.json()["id"]
    resp = client.delete(f"/api/promotions/{p_id}", headers=auth_headers)
    assert resp.status_code == 200


# ── Promo Validation ──

def test_validate_promotion_percentage(auth_headers):
    client.post("/api/promotions", json={
        "code": "PCT20", "discount_type": "percentage", "value": 20,
    }, headers=auth_headers)
    db = TestingSessionLocal()
    promo, discount = validate_promotion(db, "PCT20", subtotal=100.0, total_qty=5)
    assert discount == 20.0
    assert promo.code == "PCT20"
    db.close()


def test_validate_promotion_fixed(auth_headers):
    client.post("/api/promotions", json={
        "code": "FIX10", "discount_type": "fixed", "value": 10,
    }, headers=auth_headers)
    db = TestingSessionLocal()
    _, discount = validate_promotion(db, "FIX10", subtotal=50.0, total_qty=3)
    assert discount == 10.0
    db.close()


def test_validate_promotion_fixed_capped_at_subtotal(auth_headers):
    client.post("/api/promotions", json={
        "code": "FIX99", "discount_type": "fixed", "value": 99,
    }, headers=auth_headers)
    db = TestingSessionLocal()
    _, discount = validate_promotion(db, "FIX99", subtotal=50.0, total_qty=1)
    assert discount == 50.0
    db.close()


def test_validate_promotion_expired(auth_headers):
    client.post("/api/promotions", json={
        "code": "EXPIRED", "discount_type": "fixed", "value": 5,
        "valid_to": (date.today() - timedelta(days=1)).isoformat(),
    }, headers=auth_headers)
    db = TestingSessionLocal()
    try:
        validate_promotion(db, "EXPIRED", subtotal=100.0, total_qty=1)
        assert False, "Should have raised PromoError"
    except PromoError:
        pass
    db.close()


def test_validate_promotion_min_qty(auth_headers):
    client.post("/api/promotions", json={
        "code": "MINQTY", "discount_type": "fixed", "value": 5, "min_qty": 3,
    }, headers=auth_headers)
    db = TestingSessionLocal()
    try:
        validate_promotion(db, "MINQTY", subtotal=100.0, total_qty=2)
        assert False, "Should have raised PromoError"
    except PromoError:
        pass
    _, discount = validate_promotion(db, "MINQTY", subtotal=100.0, total_qty=3)
    assert discount == 5.0
    db.close()


def test_validate_promotion_min_amount(auth_headers):
    client.post("/api/promotions", json={
        "code": "MINAMT", "discount_type": "fixed", "value": 5, "min_amount": 50,
    }, headers=auth_headers)
    db = TestingSessionLocal()
    try:
        validate_promotion(db, "MINAMT", subtotal=30.0, total_qty=1)
        assert False, "Should have raised PromoError"
    except PromoError:
        pass
    _, discount = validate_promotion(db, "MINAMT", subtotal=50.0, total_qty=1)
    assert discount == 5.0
    db.close()


def test_validate_promotion_max_uses(auth_headers):
    client.post("/api/promotions", json={
        "code": "MAXUSE", "discount_type": "fixed", "value": 5, "max_uses": 2,
    }, headers=auth_headers)
    db = TestingSessionLocal()
    promo = db.query(Promotion).filter(Promotion.code == "MAXUSE").first()
    promo.used_count = 2
    db.commit()
    try:
        validate_promotion(db, "MAXUSE", subtotal=100.0, total_qty=1)
        assert False, "Should have raised PromoError"
    except PromoError:
        pass
    db.close()


def test_apply_promotion_increments_used_count(auth_headers):
    client.post("/api/promotions", json={
        "code": "INCR", "discount_type": "fixed", "value": 5, "max_uses": 5,
    }, headers=auth_headers)
    db = TestingSessionLocal()
    promo = db.query(Promotion).filter(Promotion.code == "INCR").first()
    assert promo.used_count == 0
    apply_promotion(db, promo)
    db.commit()
    db.refresh(promo)
    assert promo.used_count == 1
    db.close()


# ── Sale Integration with Promo ──

def test_sale_with_promo_code(auth_headers):
    _make_product(auth_headers, sku="SALE-PROMO-1")
    client.post("/api/promotions", json={
        "code": "SALE20", "discount_type": "percentage", "value": 20,
    }, headers=auth_headers)
    resp = client.post("/api/sales", json={
        "items": [{"product_id": 1, "quantity": 5, "unit_price": 20.0}],
        "promo_code": "SALE20",
    }, headers=auth_headers)
    assert resp.status_code == 201
    data = resp.json()
    assert data["subtotal"] == 100.0
    assert data["promo_discount"] == 20.0
    assert data["promo_code"] == "SALE20"
    assert data["total_amount"] == 80.0


def test_sale_with_invalid_promo_code(auth_headers):
    _make_product(auth_headers, sku="SALE-PROMO-2")
    resp = client.post("/api/sales", json={
        "items": [{"product_id": 1, "quantity": 1, "unit_price": 20.0}],
        "promo_code": "INVALID",
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "Invalid promotion code" in resp.json()["detail"]


def test_sale_with_promo_and_manual_discount(auth_headers):
    _make_product(auth_headers, sku="SALE-PROMO-3")
    client.post("/api/promotions", json={
        "code": "COMBO", "discount_type": "percentage", "value": 10,
    }, headers=auth_headers)
    resp = client.post("/api/sales", json={
        "items": [{"product_id": 1, "quantity": 10, "unit_price": 10.0}],
        "discount_amount": 20.0,
        "promo_code": "COMBO",
    }, headers=auth_headers)
    assert resp.status_code == 201
    data = resp.json()
    assert data["subtotal"] == 100.0
    assert data["discount_amount"] == 20.0
    assert data["promo_discount"] == 10.0
    assert data["total_amount"] == 70.0


def test_sale_promo_used_count_incremented(auth_headers):
    _make_product(auth_headers, sku="SALE-PROMO-4")
    client.post("/api/promotions", json={
        "code": "INCR2", "discount_type": "fixed", "value": 5, "max_uses": 10,
    }, headers=auth_headers)
    client.post("/api/sales", json={
        "items": [{"product_id": 1, "quantity": 1, "unit_price": 20.0}],
        "promo_code": "INCR2",
    }, headers=auth_headers)
    db = TestingSessionLocal()
    promo = db.query(Promotion).filter(Promotion.code == "INCR2").first()
    assert promo.used_count == 1
    db.close()


# ── Promo Validate Endpoint ──

def test_promo_validate_endpoint_valid(auth_headers):
    client.post("/api/promotions", json={
        "code": "APIVAL", "discount_type": "fixed", "value": 15,
    }, headers=auth_headers)
    resp = client.post("/api/promotions/validate", json={
        "code": "APIVAL", "subtotal": 100.0, "total_qty": 5,
    }, headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["valid"] is True
    assert data["discount_amount"] == 15.0


def test_promo_validate_endpoint_invalid(auth_headers):
    resp = client.post("/api/promotions/validate", json={
        "code": "NOPE", "subtotal": 100.0, "total_qty": 1,
    }, headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["valid"] is False
    assert "error" in data


# ── Pricing Resolve Endpoint ──

def test_price_resolve_endpoint(auth_headers):
    prod = _make_product(auth_headers, sku="APIRESOLVE", unit_price=42.0)
    client.post("/api/price-lists", json={
        "name": "API PL", "is_default": True,
        "items": [{"product_id": prod["id"], "price": 35.0, "min_qty": 1}],
    }, headers=auth_headers)
    resp = client.post("/api/price-lists/resolve", json={
        "items": [{"product_id": prod["id"], "qty": 1}],
    }, headers=auth_headers)
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) == 1
    assert items[0]["price"] == 35.0
