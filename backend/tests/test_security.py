import pytest
from sqlalchemy import text

from app.config import Settings
from app.database import engine
from tests.conftest import client

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
JPEG_BYTES = b"\xff\xd8\xff\xe0" + b"\x00" * 16


def _make_product(auth_headers, sku="SEC-001"):
    return client.post(
        "/api/products", json={"sku": sku, "name": "Security Test Product"}, headers=auth_headers
    ).json()


# --- Image upload magic-byte validation ---


def test_upload_valid_png(auth_headers):
    pid = _make_product(auth_headers)["id"]
    resp = client.post(
        f"/api/products/{pid}/upload-image",
        files={"file": ("image.png", PNG_SIGNATURE, "image/png")},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["image_url"].startswith("/uploads/")
    assert resp.json()["image_url"].endswith(".png")


def test_upload_valid_jpeg_with_jpeg_extension(auth_headers):
    pid = _make_product(auth_headers, "SEC-002")["id"]
    resp = client.post(
        f"/api/products/{pid}/upload-image",
        files={"file": ("image.jpeg", JPEG_BYTES, "image/jpeg")},
        headers=auth_headers,
    )
    assert resp.status_code == 200


def test_upload_html_disguised_as_png(auth_headers):
    pid = _make_product(auth_headers, "SEC-003")["id"]
    resp = client.post(
        f"/api/products/{pid}/upload-image",
        files={"file": ("evil.png", b"<script>alert(1)</script>", "image/png")},
        headers=auth_headers,
    )
    assert resp.status_code == 400


def test_upload_mismatched_content_and_extension(auth_headers):
    pid = _make_product(auth_headers, "SEC-004")["id"]
    resp = client.post(
        f"/api/products/{pid}/upload-image",
        files={"file": ("image.jpg", PNG_SIGNATURE, "image/png")},
        headers=auth_headers,
    )
    assert resp.status_code == 400


def test_upload_non_image_extension_rejected(auth_headers):
    pid = _make_product(auth_headers, "SEC-005")["id"]
    resp = client.post(
        f"/api/products/{pid}/upload-image",
        files={"file": ("page.html", b"<html>x</html>", "text/html")},
        headers=auth_headers,
    )
    assert resp.status_code == 400


# --- FK / referential-integrity validation ---


def test_create_product_with_unknown_category_rejected(auth_headers):
    resp = client.post(
        "/api/products",
        json={"sku": "SEC-006", "name": "Bad Ref", "category_id": 99999},
        headers=auth_headers,
    )
    assert resp.status_code == 400


def test_create_product_with_unknown_supplier_rejected(auth_headers):
    resp = client.post(
        "/api/products",
        json={"sku": "SEC-007", "name": "Bad Ref", "supplier_id": 99999},
        headers=auth_headers,
    )
    assert resp.status_code == 400


def test_update_product_with_unknown_category_rejected(auth_headers):
    pid = _make_product(auth_headers, "SEC-008")["id"]
    resp = client.put(f"/api/products/{pid}", json={"category_id": 99999}, headers=auth_headers)
    assert resp.status_code == 400


def test_bulk_edit_with_unknown_supplier_rejected(auth_headers):
    pid = _make_product(auth_headers, "SEC-009")["id"]
    resp = client.patch(
        "/api/products/bulk-edit",
        json={"ids": [pid], "supplier_id": 99999},
        headers=auth_headers,
    )
    assert resp.status_code == 400


def test_delete_supplier_with_orders_soft_deletes(auth_headers):
    prod = client.post(
        "/api/products", json={"sku": "SEC-010", "name": "Ordered", "cost_price": 5.0}, headers=auth_headers
    ).json()
    sup = client.post("/api/suppliers", json={"name": "Has Orders"}, headers=auth_headers).json()
    client.post(
        "/api/orders",
        json={"supplier_id": sup["id"], "items": [{"product_id": prod["id"], "quantity": 2, "unit_price": 5.0}]},
        headers=auth_headers,
    )
    resp = client.delete(f"/api/suppliers/{sup['id']}", headers=auth_headers)
    assert resp.status_code == 200
    detail = client.get(f"/api/suppliers/{sup['id']}?include_inactive=true", headers=auth_headers).json()
    assert detail["is_active"] is False


def test_delete_category_with_subcategories_rejected(auth_headers):
    parent = client.post("/api/categories", json={"name": "Parent Cat"}, headers=auth_headers).json()
    client.post("/api/categories", json={"name": "Child Cat", "parent_id": parent["id"]}, headers=auth_headers)
    resp = client.delete(f"/api/categories/{parent['id']}", headers=auth_headers)
    assert resp.status_code == 400


def test_foreign_keys_pragma_enforced():
    with engine.connect() as conn:
        assert conn.execute(text("PRAGMA foreign_keys")).scalar() == 1


# --- JWT secret validation ---


def test_placeholder_secret_rejected():
    with pytest.raises(ValueError):
        Settings(_env_file=None, secret_key="change-this-to-a-secure-random-key")


def test_placeholder_substring_secret_rejected():
    with pytest.raises(ValueError):
        Settings(_env_file=None, secret_key="my-secret-change-this-to-a-secure-random-key-suffix")


def test_short_secret_rejected():
    with pytest.raises(ValueError):
        Settings(_env_file=None, secret_key="too-short")


def test_strong_secret_accepted():
    s = Settings(_env_file=None, secret_key="a" * 64)
    assert len(s.secret_key) == 64
