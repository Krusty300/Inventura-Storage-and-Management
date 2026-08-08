import io
from pathlib import Path

from tests.conftest import client


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
