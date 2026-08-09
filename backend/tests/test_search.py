from tests.conftest import client


def _make_product(auth_headers, sku):
    return client.post("/api/products", json={
        "location_id": 1, "sku": sku, "name": sku, "unit_price": 10.0, "quantity": 0,
    }, headers=auth_headers).json()


def _make_supplier(auth_headers, name):
    return client.post("/api/suppliers", json={"name": name, "email": f"{name.lower()}@example.com"}, headers=auth_headers).json()


def _make_customer(auth_headers, name):
    return client.post("/api/customers", json={"name": name, "email": f"{name.lower()}@example.com"}, headers=auth_headers).json()


def _receive(auth_headers, product_id, quantity, lot_number):
    return client.post("/api/receipts", json={
        "items": [{"product_id": product_id, "quantity": quantity, "location_id": 1, "lot_number": lot_number}],
    }, headers=auth_headers)


def test_global_search_returns_entities_across_types(auth_headers):
    _make_product(auth_headers, "GLOBWIDGET")
    _make_supplier(auth_headers, "GlobSupplier")
    _make_customer(auth_headers, "GlobCustomer")
    assert _receive(auth_headers, _make_product(auth_headers, "GLOBLOT").get("id"), 5, "LOT-GLOB").status_code == 201

    resp = client.get("/api/search", params={"q": "GLOB"}, headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] > 0

    types = {r["type"] for r in data["results"]}
    assert "product" in types
    assert "supplier" in types
    assert "customer" in types
    assert "lot" in types

    product_hits = [r for r in data["results"] if r["type"] == "product"]
    assert any("GLOBWIDGET" in r["label"] for r in product_hits)
    assert all(r["route"] for r in data["results"])


def test_global_search_no_results_and_empty_query(auth_headers):
    resp = client.get("/api/search", params={"q": "ZZZ-NOT-FOUND-ANYWHERE"}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["total"] == 0
    assert resp.json()["results"] == []

    resp = client.get("/api/search", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["total"] == 0


def test_global_search_requires_auth():
    resp = client.get("/api/search", params={"q": "x"})
    assert resp.status_code == 403


def test_global_search_finds_parent_by_variant_sku_and_attribute(auth_headers):
    parent = client.post("/api/products", json={
        "location_id": 1, "sku": "GS-PARENT", "name": "GS T-Shirt", "unit_price": 10.0, "quantity": 0,
    }, headers=auth_headers).json()
    client.post("/api/products", json={
        "location_id": 1, "sku": "GS-RED-L", "parent_id": parent["id"], "quantity": 0,
        "attributes": {"Color": "Crimson", "Size": "Large"},
    }, headers=auth_headers)

    # searching a variant's sku returns the variant (label includes the parent name)
    resp = client.get("/api/search", params={"q": "GS-RED-L"}, headers=auth_headers)
    assert resp.status_code == 200
    product_hits = [r for r in resp.json()["results"] if r["type"] == "product"]
    assert any("GS T-Shirt" in r["label"] for r in product_hits)

    # searching a variant attribute value surfaces the parent product
    resp = client.get("/api/search", params={"q": "Crimson"}, headers=auth_headers)
    assert resp.status_code == 200
    product_hits = [r for r in resp.json()["results"] if r["type"] == "product"]
    assert any("GS T-Shirt" in r["label"] for r in product_hits)
