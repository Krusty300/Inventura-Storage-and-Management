from datetime import date
from pathlib import Path

from tests.conftest import TestingSessionLocal, client

from app.models.product import Product


def _make_product(auth_headers, sku, **kwargs):
    payload = {"sku": sku, "name": sku, "quantity": 10, "reorder_level": 0, "location_id": 1, **kwargs}
    return client.post("/api/products", json=payload, headers=auth_headers).json()


def test_barcode_labels_pdf(auth_headers):
    _make_product(auth_headers, "LABEL-001", barcode="4006381333931")
    resp = client.get("/api/products/barcode-labels", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.content.startswith(b"%PDF")


def test_barcode_labels_filters_by_ids(auth_headers):
    p1 = _make_product(auth_headers, "LABEL-002")
    _make_product(auth_headers, "LABEL-003")
    resp = client.get(f"/api/products/barcode-labels?ids={p1['id']}", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.content.startswith(b"%PDF")


def test_barcode_labels_excludes_inactive(auth_headers):
    p = _make_product(auth_headers, "LABEL-004")
    client.delete(f"/api/products/{p['id']}", headers=auth_headers)
    resp = client.get("/api/products/barcode-labels", headers=auth_headers)
    assert resp.status_code == 200


def test_get_product_by_barcode(auth_headers):
    p = _make_product(auth_headers, "BAR-001", barcode="1234567890")
    resp = client.get("/api/products/barcode/1234567890", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["id"] == p["id"]


def test_get_product_by_barcode_not_found(auth_headers):
    resp = client.get("/api/products/barcode/does-not-exist", headers=auth_headers)
    assert resp.status_code == 404


def test_get_product_by_barcode_case_insensitive(auth_headers):
    p = _make_product(auth_headers, "BAR-002", barcode="AbC-1234")
    resp = client.get("/api/products/barcode/abc-1234", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["id"] == p["id"]
    resp = client.get("/api/products/barcode/ABC-1234", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["id"] == p["id"]


def test_get_product_by_barcode_excludes_inactive(auth_headers):
    p = _make_product(auth_headers, "BAR-003", barcode="INACTIVE-BAR")
    client.delete(f"/api/products/{p['id']}", headers=auth_headers)
    resp = client.get("/api/products/barcode/INACTIVE-BAR", headers=auth_headers)
    assert resp.status_code == 404


def test_get_product_by_barcode_fallback_to_sku(auth_headers):
    p = _make_product(auth_headers, "SKU-FALLBACK-01")
    resp = client.get("/api/products/barcode/SKU-FALLBACK-01", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["id"] == p["id"]


def test_get_product_by_barcode_fallback_sku_case_insensitive(auth_headers):
    p = _make_product(auth_headers, "Sku-Case-01")
    resp = client.get("/api/products/barcode/sku-case-01", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["id"] == p["id"]


def test_get_product_by_barcode_prefers_barcode_over_sku(auth_headers):
    p_barcode = _make_product(auth_headers, "PREF-001", barcode="DUAL-001")
    p_sku = _make_product(auth_headers, "DUAL-001")
    resp = client.get("/api/products/barcode/DUAL-001", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["id"] == p_barcode["id"]


def test_product_movements_endpoint(auth_headers):
    p = _make_product(auth_headers, "MOV-EXT", quantity=50)
    client.post("/api/stock-movements", json={
        "product_id": p["id"], "quantity_change": 5, "movement_type": "in",
    }, headers=auth_headers)
    resp = client.get(f"/api/products/{p['id']}/movements", headers=auth_headers)
    assert resp.status_code == 200
    assert len(resp.json()) >= 1
    assert resp.json()[0]["product_id"] == p["id"]


def test_upload_product_image(auth_headers, monkeypatch, tmp_path):
    from app.routers import products as products_module
    monkeypatch.setattr(products_module, "UPLOAD_DIR", Path(tmp_path))
    p = _make_product(auth_headers, "IMG-001")
    resp = client.post(
        f"/api/products/{p['id']}/upload-image",
        files={"file": ("photo.jpg", b"\xff\xd8\xff\xe0fake-image-bytes", "image/jpeg")},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["image_url"].startswith("/uploads/")
    assert list(Path(tmp_path).iterdir())


def test_upload_product_image_rejects_bad_extension(auth_headers, monkeypatch, tmp_path):
    from app.routers import products as products_module
    monkeypatch.setattr(products_module, "UPLOAD_DIR", Path(tmp_path))
    p = _make_product(auth_headers, "IMG-002")
    resp = client.post(
        f"/api/products/{p['id']}/upload-image",
        files={"file": ("evil.html", b"<script>alert(1)</script>", "text/html")},
        headers=auth_headers,
    )
    assert resp.status_code == 400


def test_upload_image_requires_admin(auth_headers, tmp_path):
    client.post("/api/users", json={"username": "imgworker", "email": "imgworker@example.com", "password": "testpass123", "role": "worker"}, headers=auth_headers)
    token = client.post("/api/auth/login", json={"username": "imgworker", "password": "testpass123"}).json()["access_token"]
    p = _make_product(auth_headers, "IMG-003")
    resp = client.post(
        f"/api/products/{p['id']}/upload-image",
        files={"file": ("photo.jpg", b"bytes", "image/jpeg")},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403


def test_bulk_edit_products(auth_headers):
    p1 = _make_product(auth_headers, "BULK-001")
    p2 = _make_product(auth_headers, "BULK-002")
    cat = client.post("/api/categories", json={"name": "Bulk Cat"}, headers=auth_headers).json()
    resp = client.patch("/api/products/bulk-edit", json={
        "ids": [p1["id"], p2["id"]], "category_id": cat["id"],
    }, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["updated"] == 2
    updated = client.get(f"/api/products/{p1['id']}", headers=auth_headers).json()
    assert updated["category_id"] == cat["id"]


def test_bulk_edit_no_fields(auth_headers):
    p = _make_product(auth_headers, "BULK-003")
    resp = client.patch("/api/products/bulk-edit", json={"ids": [p["id"]]}, headers=auth_headers)
    assert resp.status_code == 400


def test_bulk_edit_requires_admin(auth_headers):
    client.post("/api/users", json={"username": "bulkworker", "email": "bulkworker@example.com", "password": "testpass123", "role": "worker"}, headers=auth_headers)
    token = client.post("/api/auth/login", json={"username": "bulkworker", "password": "testpass123"}).json()["access_token"]
    p = _make_product(auth_headers, "BULK-004")
    resp = client.patch("/api/products/bulk-edit", json={"ids": [p["id"]], "reorder_level": 5},
                        headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


def test_import_products_csv(auth_headers):
    csv_data = (
        "sku,name,unit_price,cost_price,quantity,reorder_level,location\n"
        "IMP-001,Imported One,10.0,5.0,25,10,Default Location\n"
        "IMP-002,Imported Two,20.0,10.0,15,5,Default Location\n"
    )
    resp = client.post(
        "/api/products/import-csv",
        files={"file": ("import.csv", csv_data, "text/csv")},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    result = resp.json()
    assert result["created"] == 2
    assert result["errors"] == []
    listing = client.get("/api/products?search=Imported", headers=auth_headers).json()
    assert len(listing["items"]) == 2


def test_import_products_csv_reports_bad_rows(auth_headers):
    csv_data = (
        "sku,name,quantity,location\n"
        "IMP-003,Good Row,5,Default Location\n"
        "IMP-004,,3,Default Location\n"
        ",Missing Name,2,Default Location\n"
    )
    resp = client.post(
        "/api/products/import-csv",
        files={"file": ("import.csv", csv_data, "text/csv")},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    result = resp.json()
    assert result["created"] == 1
    assert len(result["errors"]) == 2


def test_import_products_csv_rejects_non_csv(auth_headers):
    resp = client.post(
        "/api/products/import-csv",
        files={"file": ("data.txt", b"sku,name\n", "text/plain")},
        headers=auth_headers,
    )
    assert resp.status_code == 400


def test_import_csv_requires_admin(auth_headers):
    client.post("/api/users", json={"username": "impworker", "email": "impworker@example.com", "password": "testpass123", "role": "worker"}, headers=auth_headers)
    token = client.post("/api/auth/login", json={"username": "impworker", "password": "testpass123"}).json()["access_token"]
    resp = client.post(
        "/api/products/import-csv",
        files={"file": ("import.csv", b"sku,name\n", "text/csv")},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403


def test_sort_products_by_category_name(auth_headers):
    cat_a = client.post("/api/categories", json={"name": "Alpha Cat"}, headers=auth_headers).json()
    cat_b = client.post("/api/categories", json={"name": "Beta Cat"}, headers=auth_headers).json()
    _make_product(auth_headers, "SORT-001", category_id=cat_b["id"])
    _make_product(auth_headers, "SORT-002", category_id=cat_a["id"])
    asc_resp = client.get("/api/products?sort_by=category_name&sort_dir=asc", headers=auth_headers).json()
    desc_resp = client.get("/api/products?sort_by=category_name&sort_dir=desc", headers=auth_headers).json()
    asc_cats = [p["category_name"] for p in asc_resp["items"] if p["category_name"]]
    desc_cats = [p["category_name"] for p in desc_resp["items"] if p["category_name"]]
    assert asc_cats == sorted(asc_cats)
    assert desc_cats == sorted(desc_cats, reverse=True)


def test_sort_products_by_name_server_side(auth_headers):
    _make_product(auth_headers, "ZZZ-001", name="Zebra")
    _make_product(auth_headers, "AAA-001", name="Apple")
    resp = client.get("/api/products?sort_by=name&sort_dir=asc", headers=auth_headers).json()
    names = [p["name"] for p in resp["items"] if p["name"] in ("Zebra", "Apple")]
    assert names == ["Apple", "Zebra"]


def _make_location(auth_headers, code="LOC-PICK"):
    return client.post("/api/locations", json={"code": code, "name": code}, headers=auth_headers).json()


def test_create_product_with_location_places_stock_at_location(auth_headers):
    loc = _make_location(auth_headers)
    p = _make_product(auth_headers, "LOCPRD-001", quantity=10, location_id=loc["id"], cost_price=5)
    assert p["location_id"] == loc["id"]
    detail = client.get(f"/api/locations/{loc['id']}/detail", headers=auth_headers).json()
    lines = [sl for sl in detail["stock_lines"] if sl["product_id"] == p["id"]]
    assert len(lines) == 1
    assert lines[0]["quantity"] == 10
    assert lines[0]["value"] == 50.0


def test_update_product_quantity_adjusts_at_location(auth_headers):
    loc = _make_location(auth_headers)
    p = _make_product(auth_headers, "LOCPRD-002", quantity=10, location_id=loc["id"])
    resp = client.put(f"/api/products/{p['id']}", json={"quantity": 15, "location_id": loc["id"]}, headers=auth_headers)
    assert resp.status_code == 200
    detail = client.get(f"/api/locations/{loc['id']}/detail", headers=auth_headers).json()
    lines = [sl for sl in detail["stock_lines"] if sl["product_id"] == p["id"]]
    assert len(lines) == 1
    assert lines[0]["quantity"] == 15


def test_update_product_quantity_cannot_go_negative_at_location(auth_headers):
    loc = _make_location(auth_headers)
    p = _make_product(auth_headers, "LOCPRD-003", quantity=10, location_id=loc["id"])
    resp = client.put(f"/api/products/{p['id']}", json={"quantity": -5, "location_id": loc["id"]}, headers=auth_headers)
    assert resp.status_code == 400
    detail = client.get(f"/api/locations/{loc['id']}/detail", headers=auth_headers).json()
    lines = [sl for sl in detail["stock_lines"] if sl["product_id"] == p["id"]]
    assert lines[0]["quantity"] == 10


def _make_serialized(auth_headers, sku):
    return client.post("/api/products", json={
        "location_id": 1, "sku": sku, "name": sku, "unit_price": 20.0, "cost_price": 10.0,
        "quantity": 0, "is_serialized": True,
    }, headers=auth_headers).json()


def _receive(auth_headers, product_id, serials, lot_number):
    resp = client.post("/api/receipts", json={"items": [{
        "product_id": product_id, "quantity": len(serials),
        "serial_numbers": serials, "lot_number": lot_number,
    }]}, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _lot(auth_headers, product_id, lot_number):
    lots = client.get("/api/lots", params={"product_id": product_id}, headers=auth_headers).json()
    return next(l for l in lots["items"] if l["lot_number"] == lot_number)


def test_sellable_qty_for_serialized_product_counts_only_in_stock_serials(auth_headers):
    prod = _make_serialized(auth_headers, "SELL-SER1")
    _receive(auth_headers, prod["id"], ["SELL-S1-A1", "SELL-S1-A2", "SELL-S1-A3"], "LOT-SELL-A")
    _receive(auth_headers, prod["id"], ["SELL-S1-B1", "SELL-S1-B2"], "LOT-SELL-B")
    lot_b = _lot(auth_headers, prod["id"], "LOT-SELL-B")
    assert client.put(f"/api/lots/{lot_b['id']}", json={"status": "quarantined"}, headers=auth_headers).status_code == 200

    body = client.get("/api/products", params={"search": "SELL-SER1", "include_variants": "1"}, headers=auth_headers).json()
    item = next(p for p in body["items"] if p["id"] == prod["id"])
    # on-hand counts in-stock plus quarantined serials (parity with bulk, where
    # quarantined lots stay on-hand) - the quarantined pair is a breakdown of Qty.
    assert item["quantity"] == 5
    assert item["quarantined_qty"] == 2
    # sellable is the on-hand subset that can actually be allocated: in-stock
    # serials in a live (in_stock) lot, i.e. 3 - not quantity - quarantined (1).
    assert item["sellable_qty"] == 3

    detail = client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()
    assert detail["quantity"] == 5
    assert detail["quarantined_qty"] == 2
    assert detail["sellable_qty"] == 3


def test_get_product_parent_aggregates_variant_derived_qty(auth_headers):
    parent = client.post("/api/products", json={
        "location_id": 1, "sku": "AGG-PARENT", "name": "Aggregate Group",
        "unit_price": 10.0, "cost_price": 5.0, "barcode": "AGG-BARCODE",
    }, headers=auth_headers).json()
    v1 = client.post("/api/products", json={"location_id": 1,
        "sku": "AGG-V1", "parent_id": parent["id"], "attributes": {"Color": "Red"},
    }, headers=auth_headers).json()
    v2 = client.post("/api/products", json={"location_id": 1,
        "sku": "AGG-V2", "parent_id": parent["id"], "attributes": {"Color": "Blue"},
    }, headers=auth_headers).json()

    assert client.post("/api/receipts", json={"items": [{
        "product_id": v1["id"], "quantity": 2, "lot_number": "LOT-AGG-1",
    }, {
        "product_id": v2["id"], "quantity": 1, "lot_number": "LOT-AGG-2",
    }]}, headers=auth_headers).status_code == 201
    lot1 = _lot(auth_headers, v1["id"], "LOT-AGG-1")
    assert client.put(f"/api/lots/{lot1['id']}", json={"status": "quarantined"}, headers=auth_headers).status_code == 200

    detail = client.get(f"/api/products/{parent['id']}", headers=auth_headers).json()
    # Parent row aggregates its active variants' derived stock fields.
    assert detail["quarantined_qty"] == 2
    assert detail["expired_lot_qty"] == 0
    assert detail["sellable_qty"] == 1

    by_barcode = client.get("/api/products/barcode/AGG-BARCODE", headers=auth_headers)
    assert by_barcode.status_code == 200
    assert by_barcode.json()["quarantined_qty"] == 2


def test_products_list_parent_row_keeps_own_derived_qty(auth_headers):
    parent = client.post("/api/products", json={
        "location_id": 1, "sku": "AGG-LIST", "name": "List Group",
        "unit_price": 10.0, "cost_price": 5.0,
    }, headers=auth_headers).json()
    v1 = client.post("/api/products", json={"location_id": 1,
        "sku": "AGG-LV1", "parent_id": parent["id"], "attributes": {"Color": "Red"},
    }, headers=auth_headers).json()
    assert client.post("/api/receipts", json={"items": [{
        "product_id": v1["id"], "quantity": 1, "lot_number": "LOT-AGG-L1",
    }]}, headers=auth_headers).status_code == 201
    lot = _lot(auth_headers, v1["id"], "LOT-AGG-L1")
    assert client.put(f"/api/lots/{lot['id']}", json={"status": "quarantined"}, headers=auth_headers).status_code == 200

    body = client.get("/api/products", params={"search": "AGG-LIST", "include_variants": "1"}, headers=auth_headers).json()
    item = next(p for p in body["items"] if p["id"] == parent["id"])
    assert item["quarantined_qty"] == 0
    assert item["sellable_qty"] == 0
    v = next(x for x in item["variants"] if x["id"] == v1["id"])
    assert v["quarantined_qty"] == 1
    assert v["sellable_qty"] == 0


def test_expired_lot_qty_counts_in_stock_serials_in_expired_lots(auth_headers):
    """Serialized products carry no stock lines, so the E badge must count the
    in_stock serials sitting in an expired lot (expiring a lot leaves the serial
    status untouched)."""
    prod = _make_serialized(auth_headers, "EXP-SER1")
    _receive(auth_headers, prod["id"], ["EXP-S1-A1", "EXP-S1-A2", "EXP-S1-A3"], "LOT-EXP-A")
    _receive(auth_headers, prod["id"], ["EXP-S1-B1", "EXP-S1-B2"], "LOT-FRESH-B")
    lot_a = _lot(auth_headers, prod["id"], "LOT-EXP-A")
    assert client.put(f"/api/lots/{lot_a['id']}", json={"expiry_date": "2020-01-01"}, headers=auth_headers).status_code == 200

    # the list endpoint flips the overdue in_stock lot to expired
    body = client.get("/api/products", params={"search": "EXP-SER1", "include_variants": 1}, headers=auth_headers).json()
    item = next(p for p in body["items"] if p["id"] == prod["id"])
    assert item["expired_lot_qty"] == 3

    detail = client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()
    assert detail["expired_lot_qty"] == 3
    assert detail["quantity"] == 5
    assert detail["sellable_qty"] == 2


def test_expired_filter_matches_expired_lots_not_static_product_expiry(auth_headers):
    """The products 'expired' filter must agree with the E badge: match on stock
    held in an expired lot (bulk and serialized), not on a past static
    Product.expiry_date that may no longer correspond to any actual stock."""
    bulk = client.post("/api/products", json={"location_id": 1,
        "sku": "EXP-FILTER-BULK", "name": "Exp Filter Bulk", "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    assert client.post("/api/receipts", json={"items": [{
        "product_id": bulk["id"], "quantity": 3, "lot_number": "LOT-FB-OLD", "expiry_date": "2020-01-01",
    }]}, headers=auth_headers).status_code == 201

    ser = _make_serialized(auth_headers, "EXP-FILTER-SER")
    _receive(auth_headers, ser["id"], ["EXP-FS-A1", "EXP-FS-A2"], "LOT-FS-OLD")
    lot = _lot(auth_headers, ser["id"], "LOT-FS-OLD")
    assert client.put(f"/api/lots/{lot['id']}", json={"expiry_date": "2020-01-01"}, headers=auth_headers).status_code == 200

    # product whose static expiry has passed but which holds no stock in an
    # expired lot (fresh lot, no expiry) must NOT be listed as expired
    ghost = client.post("/api/products", json={"location_id": 1,
        "sku": "EXP-FILTER-GHOST", "name": "Exp Filter Ghost", "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    assert client.post("/api/receipts", json={"items": [{
        "product_id": ghost["id"], "quantity": 2, "lot_number": "LOT-FG-FRESH",
    }]}, headers=auth_headers).status_code == 201
    db = TestingSessionLocal()
    db.query(Product).filter(Product.id == ghost["id"]).update({"expiry_date": date(2020, 1, 1)})
    db.commit()
    db.close()

    body = client.get("/api/products", params={"expiry": "expired", "include_variants": 1, "limit": 100}, headers=auth_headers).json()
    matches = {p["id"]: p for p in body["items"]}
    assert bulk["id"] in matches and matches[bulk["id"]]["expired_lot_qty"] == 3
    assert ser["id"] in matches and matches[ser["id"]]["expired_lot_qty"] == 2
    assert ghost["id"] not in matches
