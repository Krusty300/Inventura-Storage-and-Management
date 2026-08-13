from tests.conftest import client


def _make_product(auth_headers, sku, quantity=0, reorder_level=10, supplier_id=None):
    payload = {
        "location_id": 1, "sku": sku, "name": sku,
        "quantity": quantity, "reorder_level": reorder_level, "cost_price": 5.0,
    }
    if supplier_id is not None:
        payload["supplier_id"] = supplier_id
    return client.post("/api/products", json=payload, headers=auth_headers).json()


def _receive(auth_headers, product_id, qty, lot):
    resp = client.post("/api/receipts", json={
        "items": [{"product_id": product_id, "quantity": qty, "lot_number": lot}],
    }, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _lot(auth_headers, product_id, lot_number):
    lots = client.get("/api/lots", params={"product_id": product_id}, headers=auth_headers).json()
    return next(l for l in lots["items"] if l["lot_number"] == lot_number)


def _set_status(auth_headers, lot_id, status):
    resp = client.put(f"/api/lots/{lot_id}", json={"status": status}, headers=auth_headers)
    assert resp.status_code == 200, resp.text


def test_reorder_low_stock_creates_po_grouped_by_supplier(auth_headers):
    sup1 = client.post("/api/suppliers", json={"name": "RLS Sup 1"}, headers=auth_headers).json()
    sup2 = client.post("/api/suppliers", json={"name": "RLS Sup 2"}, headers=auth_headers).json()
    low_a = _make_product(auth_headers, "RLS-A", quantity=3, reorder_level=10, supplier_id=sup1["id"])
    low_b = _make_product(auth_headers, "RLS-B", quantity=1, reorder_level=5, supplier_id=sup2["id"])

    resp = client.post("/api/orders/reorder-low-stock", json={}, headers=auth_headers)
    assert resp.status_code == 200
    orders = resp.json()
    assert isinstance(orders, list)
    assert len(orders) == 2
    by_supplier = {o["supplier_id"]: o for o in orders}
    assert by_supplier[sup1["id"]]["items"][0]["product_id"] == low_a["id"]
    assert by_supplier[sup1["id"]]["items"][0]["quantity"] == 7
    assert by_supplier[sup2["id"]]["items"][0]["product_id"] == low_b["id"]
    assert by_supplier[sup2["id"]]["items"][0]["quantity"] == 4


def test_reorder_low_stock_respects_product_ids(auth_headers):
    sup = client.post("/api/suppliers", json={"name": "RLS Sup 3"}, headers=auth_headers).json()
    low_a = _make_product(auth_headers, "RLS-C", quantity=2, reorder_level=10, supplier_id=sup["id"])
    _make_product(auth_headers, "RLS-D", quantity=2, reorder_level=10, supplier_id=sup["id"])

    resp = client.post("/api/orders/reorder-low-stock", json={"product_ids": [low_a["id"]]}, headers=auth_headers)
    assert resp.status_code == 200
    orders = resp.json()
    assert len(orders) == 1
    items = orders[0]["items"]
    assert len(items) == 1
    assert items[0]["product_id"] == low_a["id"]


def test_reorder_low_stock_skips_optout_and_above_threshold(auth_headers):
    sup = client.post("/api/suppliers", json={"name": "RLS Sup 4"}, headers=auth_headers).json()
    low = _make_product(auth_headers, "RLS-E", quantity=2, reorder_level=5, supplier_id=sup["id"])
    ok = _make_product(auth_headers, "RLS-F", quantity=50, reorder_level=5, supplier_id=sup["id"])
    optout = _make_product(auth_headers, "RLS-G", quantity=0, reorder_level=0, supplier_id=sup["id"])

    resp = client.post("/api/orders/reorder-low-stock", json={}, headers=auth_headers)
    assert resp.status_code == 200
    orders = resp.json()
    assert len(orders) == 1
    item_ids = [i["product_id"] for i in orders[0]["items"]]
    assert low["id"] in item_ids
    assert ok["id"] not in item_ids
    assert optout["id"] not in item_ids
    assert next(i for i in orders[0]["items"] if i["product_id"] == low["id"])["quantity"] == 3


def test_reorder_low_stock_uses_sellable_qty(auth_headers):
    prod = _make_product(auth_headers, "RLS-H", reorder_level=5)
    _receive(auth_headers, prod["id"], 2, "LOT-RLS-S")
    _receive(auth_headers, prod["id"], 3, "LOT-RLS-Q")
    _set_status(auth_headers, _lot(auth_headers, prod["id"], "LOT-RLS-Q")["id"], "quarantined")
    # Raw on-hand is 5 (== reorder level), but sellable is 2 -> PO must top up by 3.
    assert client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()["quantity"] == 5

    resp = client.post("/api/orders/reorder-low-stock", json={}, headers=auth_headers)
    assert resp.status_code == 200
    orders = resp.json()
    assert len(orders) == 1
    item = orders[0]["items"][0]
    assert item["product_id"] == prod["id"]
    assert item["quantity"] == 3


def test_reorder_low_stock_no_low_stock_errors(auth_headers):
    _make_product(auth_headers, "RLS-I", quantity=100, reorder_level=5)
    resp = client.post("/api/orders/reorder-low-stock", json={}, headers=auth_headers)
    assert resp.status_code == 400
    assert "No low-stock" in resp.json()["detail"]
