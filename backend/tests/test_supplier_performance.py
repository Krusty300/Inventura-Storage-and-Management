from datetime import datetime, timedelta, timezone

from tests.conftest import TestingSessionLocal, client, receive_order
from app.models.order import Order


def _backdate_order(order_id: int, days_ago: int = 10) -> None:
    db = TestingSessionLocal()
    try:
        o = db.get(Order, order_id)
        o.created_at = datetime.now(timezone.utc) - timedelta(days=days_ago)
        db.commit()
    finally:
        db.close()


def _make_supplier(auth_headers, name, lead_time_days=None):
    payload = {"name": name}
    if lead_time_days is not None:
        payload["lead_time_days"] = lead_time_days
    return client.post("/api/suppliers", json=payload, headers=auth_headers).json()


def _make_product(auth_headers, sku, supplier_id):
    return client.post("/api/products", json={
        "location_id": 1, "sku": sku, "name": sku,
        "unit_price": 10.0, "cost_price": 5.0, "supplier_id": supplier_id,
    }, headers=auth_headers).json()


def _received_order(auth_headers, supplier_id, sku, expected=None, price=10.0, qty=2):
    prod = _make_product(auth_headers, sku, supplier_id)
    payload = {
        "supplier_id": supplier_id,
        "items": [{"product_id": prod["id"], "quantity": qty, "unit_price": price}],
    }
    if expected:
        payload["expected_arrival"] = expected
    order = client.post("/api/orders", json=payload, headers=auth_headers).json()
    return receive_order(client, auth_headers, order["id"])


def _performance(auth_headers, supplier_id):
    resp = client.get(f"/api/suppliers/{supplier_id}/performance", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_performance_no_data_returns_neutral(auth_headers):
    sup = _make_supplier(auth_headers, "Neutral Supply")
    data = _performance(auth_headers, sup["id"])
    assert data["score"] is None
    assert data["rating"] is None
    assert data["on_time"]["rate"] is None
    assert data["quality"]["pass_rate"] is None
    assert data["lead_time"]["adherence"] is None
    assert data["volume"]["total_orders"] == 0
    assert data["volume"]["open_orders"] == 0
    assert data["price_trend"] == []
    assert data["supply_chain"] == {
        "total_asns": 0, "open_asns": 0, "received_asns": 0,
        "total_receipts": 0, "received_units": 0,
    }


def test_on_time_and_lead_dimensions(auth_headers):
    sup = _make_supplier(auth_headers, "Punctual Supply", lead_time_days=30)
    order = _received_order(auth_headers, sup["id"], "PERF-ONTIME", expected="2030-01-01T00:00:00")

    data = _performance(auth_headers, sup["id"])
    assert data["on_time"]["orders"] == 1
    assert data["on_time"]["on_time"] == 1
    assert data["on_time"]["late"] == 0
    assert data["on_time"]["rate"] == 100.0
    assert data["on_time"]["avg_deviation_days"] < 0  # arrived before expected
    assert data["lead_time"]["promised_days"] == 30
    assert data["lead_time"]["actual_avg_days"] == 0.0
    assert data["lead_time"]["adherence"] == 100.0
    assert data["score"] == 100.0
    assert data["rating"] == "excellent"
    assert data["volume"]["total_orders"] == 1
    assert data["volume"]["total_spent"] == 20.0
    assert data["volume"]["avg_order_value"] == 20.0
    assert data["recent_orders"][0]["order_number"] == order["order_number"]
    assert data["recent_orders"][0]["on_time"] is True
    assert data["price_trend"][0]["items"] == 1


def test_late_order_counts_as_late(auth_headers):
    sup = _make_supplier(auth_headers, "Late Supply", lead_time_days=30)
    order = _received_order(auth_headers, sup["id"], "PERF-LATE", expected="2020-01-01T00:00:00")
    # Simulate a slow supplier: the order sat unfilled for 10 days before receiving.
    _backdate_order(order["id"], days_ago=10)

    data = _performance(auth_headers, sup["id"])
    assert data["on_time"]["orders"] == 1
    assert data["on_time"]["on_time"] == 0
    assert data["on_time"]["late"] == 1
    assert data["on_time"]["rate"] == 0.0
    assert data["lead_time"]["actual_avg_days"] >= 9.0
    # 10 actual vs 30 promised still beats the promise: full adherence.
    assert data["lead_time"]["adherence"] == 100.0


def test_lead_time_adherence_penalises_slow_fulfilment(auth_headers):
    sup = _make_supplier(auth_headers, "Slow Supply", lead_time_days=1)
    order = _received_order(auth_headers, sup["id"], "PERF-SLOW", expected="2030-01-01T00:00:00")
    _backdate_order(order["id"], days_ago=10)

    data = _performance(auth_headers, sup["id"])
    assert data["on_time"]["rate"] == 100.0  # promised arrival is far away
    assert data["lead_time"]["promised_days"] == 1
    assert data["lead_time"]["adherence"] == 0.0  # 10 days vs 1-day promise


def test_quality_dimension_from_product_or_lot(auth_headers):
    sup = _make_supplier(auth_headers, "Quality Supply")
    other = _make_supplier(auth_headers, "Other Supply")
    prod = _make_product(auth_headers, "PERF-QC", sup["id"])
    _make_product(auth_headers, "PERF-QC-OTHER", other["id"])

    client.post("/api/quality-checks", json={"product_id": prod["id"], "result": "pass"}, headers=auth_headers)
    client.post("/api/quality-checks", json={"product_id": prod["id"], "result": "pass"}, headers=auth_headers)
    client.post("/api/quality-checks", json={"product_id": prod["id"], "result": "fail"}, headers=auth_headers)
    client.post("/api/quality-checks", json={"product_id": prod["id"], "result": "pending"}, headers=auth_headers)
    client.post("/api/quality-checks", json={
        "product_id": _make_product(auth_headers, "PERF-QC-STRAY", other["id"])["id"],
        "result": "fail",
    }, headers=auth_headers)

    data = _performance(auth_headers, sup["id"])
    assert data["quality"]["checks"] == 3  # pending is not scored
    assert data["quality"]["passed"] == 2
    assert data["quality"]["failed"] == 1
    assert data["quality"]["pass_rate"] == round(200 / 3, 1)

    other_data = _performance(auth_headers, other["id"])
    assert other_data["quality"]["checks"] == 1
    assert other_data["quality"]["pass_rate"] == 0.0


def test_score_renormalises_missing_dimensions(auth_headers):
    # No on-time data (orders lack expected_arrival) and no quality checks:
    # only lead-time adherence counts, so the score equals the adherence.
    sup = _make_supplier(auth_headers, "Weighted Supply", lead_time_days=30)
    _received_order(auth_headers, sup["id"], "PERF-WEIGHT")
    data = _performance(auth_headers, sup["id"])
    assert data["on_time"]["rate"] is None
    assert data["lead_time"]["adherence"] == 100.0
    assert data["score"] == 100.0  # single weighted dimension


def test_performance_list_sorts_and_searches(auth_headers):
    good = _make_supplier(auth_headers, "List Good", lead_time_days=30)
    _received_order(auth_headers, good["id"], "PERF-LIST-GOOD", expected="2030-01-01T00:00:00")
    _make_supplier(auth_headers, "List NoData")

    resp = client.get("/api/suppliers/performance", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 2
    by_id = {i["supplier_id"]: i for i in body["items"]}
    assert by_id[good["id"]]["score"] == 100.0
    assert by_id[good["id"]]["rating"] == "excellent"
    # Suppliers without data sort last (score is None).
    assert body["items"][0]["supplier_id"] == good["id"]

    search = client.get("/api/suppliers/performance", params={"search": "Good"}, headers=auth_headers).json()
    assert search["total"] == 1
    assert search["items"][0]["supplier_id"] == good["id"]

    asc = client.get("/api/suppliers/performance", params={"sort_by": "name", "order": "asc"}, headers=auth_headers).json()
    assert asc["items"][0]["name"] == "List Good"


def test_performance_rejects_missing_supplier(auth_headers):
    assert client.get("/api/suppliers/999999/performance", headers=auth_headers).status_code == 404


def test_supply_chain_dimension_counts(auth_headers):
    sup = _make_supplier(auth_headers, "Chain Supply")
    _received_order(auth_headers, sup["id"], "PERF-CHAIN")
    prod = _make_product(auth_headers, "PERF-CHAIN-2", sup["id"])

    client.post("/api/receipts", json={
        "supplier_id": sup["id"],
        "items": [{"product_id": prod["id"], "quantity": 4, "lot_number": "CHAIN-LOT"}],
    }, headers=auth_headers)
    client.post("/api/asns", json={
        "supplier_id": sup["id"],
        "items": [{"product_id": prod["id"], "expected_qty": 4}],
    }, headers=auth_headers)

    data = _performance(auth_headers, sup["id"])
    chain = data["supply_chain"]
    assert chain["total_asns"] == 1
    assert chain["open_asns"] == 1
    assert chain["received_asns"] == 0
    assert chain["total_receipts"] == 1
    assert chain["received_units"] == 4