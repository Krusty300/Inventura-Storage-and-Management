from app.models import CycleCountItem, Lot, SerialNumber, StockMovement, User
from tests.conftest import TestingSessionLocal, client


def _make_product(auth_headers, sku, price=10.0, qty=0, reorder=5):
    return client.post("/api/products", json={"location_id": 1, 
        "sku": sku, "name": sku, "unit_price": price, "quantity": qty, "reorder_level": reorder,
    }, headers=auth_headers).json()


def test_exceptions_low_stock_and_zero_stock(auth_headers):
    low = _make_product(auth_headers, "EX-LOW", reorder=5)
    assert client.post("/api/receipts", json={
        "items": [{"product_id": low["id"], "quantity": 2}],
    }, headers=auth_headers).status_code == 201
    zero = _make_product(auth_headers, "EX-ZERO", reorder=5)
    assert client.post("/api/receipts", json={
        "items": [{"product_id": zero["id"], "quantity": 3}],
    }, headers=auth_headers).status_code == 201
    # sell out the zero product
    client.post("/api/sales", json={
        "items": [{"product_id": zero["id"], "quantity": 3, "unit_price": 10.0}],
    }, headers=auth_headers)

    data = client.get("/api/reports/exceptions", headers=auth_headers).json()
    names = {p["sku"] for p in data["low_stock"]}
    assert "EX-LOW" in names
    zero_names = {p["sku"] for p in data["zero_stock"]}
    assert "EX-ZERO" in zero_names


def test_exceptions_quarantined_lot_and_pending_asn(auth_headers):
    prod = _make_product(auth_headers, "EX-Q")
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 5, "lot_number": "Q-LOT"}],
    }, headers=auth_headers).status_code == 201
    db = TestingSessionLocal()
    try:
        lot = db.query(Lot).filter(Lot.lot_number == "Q-LOT").first()
        lot.status = "quarantined"
        db.commit()
    finally:
        db.close()
    client.post("/api/asns", json={
        "items": [{"product_id": prod["id"], "expected_qty": 4}],
    }, headers=auth_headers)

    data = client.get("/api/reports/exceptions", headers=auth_headers).json()
    assert any(l["lot_number"] == "Q-LOT" for l in data["quarantined_lots"])
    assert data["summary"]["pending_asns"] >= 1


def test_exceptions_quarantined_serials(auth_headers):
    prod = client.post("/api/products", json={
        "location_id": 1, "sku": "EX-SER", "name": "EX-SER", "unit_price": 10.0,
        "quantity": 0, "reorder_level": 5, "is_serialized": True,
    }, headers=auth_headers).json()
    # no lot_number -> no-lot serial, matching the "orphan serials" case
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 2, "serial_numbers": ["Q-SER-A", "Q-SER-B"]}],
    }, headers=auth_headers).status_code == 201

    db = TestingSessionLocal()
    try:
        for sn in db.query(SerialNumber).filter(SerialNumber.product_id == prod["id"]).all():
            sn.status = "quarantined"
        db.commit()
    finally:
        db.close()

    data = client.get("/api/reports/exceptions", headers=auth_headers).json()
    serials = {s["serial_number"]: s for s in data["quarantined_serials"]}
    assert "Q-SER-A" in serials
    assert serials["Q-SER-A"]["product_name"] == "EX-SER"
    assert serials["Q-SER-A"]["lot_number"] == ""
    assert serials["Q-SER-A"]["location_name"]
    assert data["summary"]["quarantined_serials"] >= 2
    assert data["summary"]["quarantined_units"] >= 2


def test_quarantined_stock_excluded_from_sellable_metrics(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, 
        "sku": "SEL-Q", "name": "SEL-Q", "unit_price": 15.0, "cost_price": 8.0,
        "quantity": 0, "reorder_level": 5,
    }, headers=auth_headers).json()
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 10, "lot_number": "SEL-Q-LOT"}],
    }, headers=auth_headers).status_code == 201
    db = TestingSessionLocal()
    try:
        lot = db.query(Lot).filter(Lot.lot_number == "SEL-Q-LOT").first()
        lot.status = "quarantined"
        db.commit()
    finally:
        db.close()

    exceptions = client.get("/api/reports/exceptions", headers=auth_headers).json()
    assert "SEL-Q" in {p["sku"] for p in exceptions["low_stock"]}
    assert "SEL-Q" in {p["sku"] for p in exceptions["zero_stock"]}

    risk = client.get("/api/reports/stockout-risk?lead_time_days=7", headers=auth_headers).json()
    item = next(i for i in risk["items"] if i["sku"] == "SEL-Q")
    assert item["on_hand"] == 0

    valuation = client.get("/api/reports/inventory-valuation", headers=auth_headers).json()
    assert valuation["total_inventory_value"] == 0.0

    stats = client.get("/api/dashboard/stats", headers=auth_headers).json()
    assert any(p["sku"] == "SEL-Q" for p in stats["low_stock_products"])


def test_inventory_aging(auth_headers):
    prod = _make_product(auth_headers, "AGE-P")
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 10, "lot_number": "AGE-LOT"}],
    }, headers=auth_headers).status_code == 201
    client.post("/api/sales", json={
        "items": [{"product_id": prod["id"], "quantity": 4, "unit_price": 10.0}],
    }, headers=auth_headers)

    data = client.get("/api/reports/inventory-aging", headers=auth_headers).json()
    row = next(r for r in data["items"] if r["lot_number"] == "AGE-LOT")
    assert row["on_hand"] == 6
    assert row["age_days"] == 0
    assert row["avg_daily_demand"] > 0
    assert row["days_of_stock"] is not None


def test_stockout_risk(auth_headers):
    prod = _make_product(auth_headers, "RISK-P")
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 2}],
    }, headers=auth_headers).status_code == 201
    # daily demand well above on-hand -> high risk
    for _ in range(5):
        client.post("/api/sales", json={
            "items": [{"product_id": prod["id"], "quantity": 2, "unit_price": 10.0}],
        }, headers=auth_headers)

    data = client.get("/api/reports/stockout-risk", headers=auth_headers).json()
    row = next(r for r in data["items"] if r["sku"] == "RISK-P")
    assert row["risk_level"] == "high"
    assert row["risk_score"] == 100
    assert data["summary"]["high"] >= 1


def test_stockout_risk_counts_shipment_demand(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "RISK-SHP", "name": "RISK-SHP", "unit_price": 10.0, "cost_price": 4.0,
        "quantity": 0, "reorder_level": 5,
    }, headers=auth_headers).json()
    loc = client.post("/api/locations", json={"code": "RSHP", "name": "RSHP"}, headers=auth_headers).json()
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 5, "location_id": loc["id"]}],
    }, headers=auth_headers).status_code == 201

    shipment = client.post("/api/shipments", json={
        "items": [{"product_id": prod["id"], "quantity": 5}],
    }, headers=auth_headers).json()
    client.post(f"/api/shipments/{shipment['id']}/pick", headers=auth_headers)
    client.post(f"/api/shipments/{shipment['id']}/ship", headers=auth_headers)
    assert client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()["quantity"] == 0

    data = client.get("/api/reports/stockout-risk", headers=auth_headers).json()
    row = next(r for r in data["items"] if r["sku"] == "RISK-SHP")
    assert row["on_hand"] == 0
    assert row["avg_daily_demand"] > 0
    assert row["risk_level"] == "high"


def test_stockout_risk_sorted_high_first(auth_headers):
    from datetime import datetime, timedelta, timezone

    high = _make_product(auth_headers, "RISK-HIGH", reorder=5)
    assert client.post("/api/receipts", json={
        "items": [{"product_id": high["id"], "quantity": 2}],
    }, headers=auth_headers).status_code == 201
    med = _make_product(auth_headers, "RISK-MED", reorder=5)
    assert client.post("/api/receipts", json={
        "items": [{"product_id": med["id"], "quantity": 10}],
    }, headers=auth_headers).status_code == 201
    low = _make_product(auth_headers, "RISK-LOW", reorder=5)
    assert client.post("/api/receipts", json={
        "items": [{"product_id": low["id"], "quantity": 50}],
    }, headers=auth_headers).status_code == 201

    db = TestingSessionLocal()
    try:
        user = db.query(User).filter(User.username == "testuser").first()
        since = datetime.now(timezone.utc) - timedelta(days=2)
        # demand 2/day for high (2 on hand -> ~1 day of supply),
        # 1/day for medium (10 on hand -> ~10 days), 1/day for low (50 on hand)
        for pid, units in ((high["id"], 180), (med["id"], 90), (low["id"], 90)):
            for _ in range(units):
                db.add(StockMovement(
                    product_id=pid, user_id=user.id, quantity_change=-1,
                    movement_type="sale", created_at=since,
                ))
        db.commit()
    finally:
        db.close()

    data = client.get("/api/reports/stockout-risk", headers=auth_headers).json()
    rows = [i for i in data["items"] if i["sku"] in ("RISK-HIGH", "RISK-MED", "RISK-LOW")]
    assert len(rows) == 3
    assert {r["sku"]: r["risk_level"] for r in rows} == {
        "RISK-HIGH": "high", "RISK-MED": "medium", "RISK-LOW": "low",
    }
    # high-risk items must be listed before medium before low
    assert [r["risk_level"] for r in rows] == ["high", "medium", "low"]


def test_exceptions_open_cycle_count_with_variance(auth_headers):
    prod = _make_product(auth_headers, "EX-CC")
    loc = client.post("/api/locations", json={"name": "Ex Loc", "code": "EX-01"}, headers=auth_headers).json()
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 10, "location_id": loc["id"]}],
    }, headers=auth_headers).status_code == 201
    cc = client.post("/api/cycle-counts", json={
        "location_id": loc["id"],
        "items": [{"product_id": prod["id"]}],
    }, headers=auth_headers).json()

    # Simulate a counted-but-unsubmitted variance on the open count
    db = TestingSessionLocal()
    try:
        item = db.query(CycleCountItem).filter(CycleCountItem.cycle_count_id == cc["id"]).first()
        item.counted_qty = 7
        item.variance = -3
        item.status = "mismatch"
        db.commit()
    finally:
        db.close()

    data = client.get("/api/reports/exceptions", headers=auth_headers).json()
    assert any(c["id"] == cc["id"] for c in data["open_cycle_counts"])
    assert data["summary"]["open_cycle_counts"] >= 1


def test_location_label_pdf(auth_headers):
    loc = client.post("/api/locations", json={"name": "Bin Label", "code": "BL-01"}, headers=auth_headers).json()
    resp = client.get(f"/api/labels/location/{loc['id']}", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.content[:4] == b"%PDF"


def test_pallet_label_pdf(auth_headers):
    loc = client.post("/api/locations", json={"name": "Pallet Loc", "code": "PL-01"}, headers=auth_headers).json()
    lpn = client.post("/api/lpns", json={"lpn_type": "pallet", "location_id": loc["id"]}, headers=auth_headers).json()
    resp = client.get(f"/api/labels/pallet/{lpn['id']}", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.content[:4] == b"%PDF"


def test_pending_count_without_variance_appears_in_open_counts(auth_headers):
    """Open Cycle Counts must list scheduled (pending) counts even before any variance exists."""
    prod = _make_product(auth_headers, "EX-PEND")
    loc = client.post("/api/locations", json={"name": "Ex Loc P", "code": "EX-P"}, headers=auth_headers).json()
    cc = client.post("/api/cycle-counts", json={
        "location_id": loc["id"],
        "items": [{"product_id": prod["id"]}],
    }, headers=auth_headers).json()
    assert cc["status"] == "pending"

    data = client.get("/api/reports/exceptions", headers=auth_headers).json()
    assert any(c["id"] == cc["id"] and c["total_variance"] == 0 for c in data["open_cycle_counts"])
    assert data["summary"]["open_cycle_counts"] >= 1


def test_partial_submit_flags_open_count_in_exceptions(auth_headers):
    p1 = _make_product(auth_headers, "EX-PARTIAL")
    p2 = _make_product(auth_headers, "EX-PARTIAL2")
    loc = client.post("/api/locations", json={"name": "Ex Loc 2", "code": "EX-02"}, headers=auth_headers).json()
    for p in (p1, p2):
        assert client.post("/api/receipts", json={
            "items": [{"product_id": p["id"], "quantity": 10, "location_id": loc["id"]}],
        }, headers=auth_headers).status_code == 201
    cc = client.post("/api/cycle-counts", json={
        "location_id": loc["id"],
        "items": [
            {"product_id": p1["id"]},
            {"product_id": p2["id"]},
        ],
    }, headers=auth_headers).json()

    resp = client.post(f"/api/cycle-counts/{cc['id']}/submit", json={
        "items": [{"product_id": p1["id"], "counted_qty": 8}],
    }, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "in_progress"
    assert resp.json()["total_variance"] == -2

    data = client.get("/api/reports/exceptions", headers=auth_headers).json()
    assert any(c["id"] == cc["id"] for c in data["open_cycle_counts"])
    assert data["summary"]["open_cycle_counts"] >= 1


def test_dashboard_pdf(auth_headers):
    prod = _make_product(auth_headers, "PDF-P")
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 3}],
    }, headers=auth_headers).status_code == 201
    client.post("/api/asns", json={
        "items": [{"product_id": prod["id"], "expected_qty": 5}],
    }, headers=auth_headers)

    resp = client.get("/api/reports/dashboard/pdf", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.content[:4] == b"%PDF"
