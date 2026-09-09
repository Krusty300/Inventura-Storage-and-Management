from tests.conftest import client

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\x00\x00\x00\x00\x00"
JPG = b"\xff\xd8\xff\xe0" + b"\x00" * 16


def _register(auth_headers, username, email, password="testpass123"):
    client.post("/api/users", json={
        "username": username, "email": email, "password": password, "role": "worker",
    }, headers=auth_headers)
    token = client.post("/api/auth/login", json={"username": username, "password": password}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_customer_upload_and_remove_image(auth_headers):
    c = client.post("/api/customers", json={"name": "Pic Corp"}, headers=auth_headers).json()
    resp = client.post(f"/api/customers/{c['id']}/upload-image", files={"file": ("logo.png", PNG, "image/png")}, headers=auth_headers)
    assert resp.status_code == 200
    url = resp.json()["image_url"]
    assert url.startswith("/uploads/customer_")

    got = client.get(f"/api/customers/{c['id']}", headers=auth_headers).json()
    assert got["image_url"] == url
    row = next(i for i in client.get("/api/customers", headers=auth_headers).json()["items"] if i["id"] == c["id"])
    assert row["image_url"] == url

    removed = client.delete(f"/api/customers/{c['id']}/upload-image", headers=auth_headers)
    assert removed.status_code == 200
    assert removed.json()["image_url"] == ""
    assert client.get(f"/api/customers/{c['id']}", headers=auth_headers).json()["image_url"] == ""


def test_supplier_upload_and_remove_image(auth_headers):
    s = client.post("/api/suppliers", json={"name": "Pic Supply"}, headers=auth_headers).json()
    resp = client.post(f"/api/suppliers/{s['id']}/upload-image", files={"file": ("logo.jpg", JPG, "image/jpeg")}, headers=auth_headers)
    assert resp.status_code == 200
    url = resp.json()["image_url"]
    assert url.startswith("/uploads/supplier_")
    assert url.endswith(".jpg")

    got = client.get(f"/api/suppliers/{s['id']}", headers=auth_headers).json()
    assert got["image_url"] == url
    row = next(i for i in client.get("/api/suppliers", headers=auth_headers).json()["items"] if i["id"] == s["id"])
    assert row["image_url"] == url

    removed = client.delete(f"/api/suppliers/{s['id']}/upload-image", headers=auth_headers)
    assert removed.status_code == 200
    assert removed.json()["image_url"] == ""


def test_customer_image_rejects_bad_file(auth_headers):
    c = client.post("/api/customers", json={"name": "Bad Pic"}, headers=auth_headers).json()
    fake = client.post(f"/api/customers/{c['id']}/upload-image", files={"file": ("fake.png", JPG, "image/jpeg")}, headers=auth_headers)
    assert fake.status_code == 400
    evil = client.post(f"/api/customers/{c['id']}/upload-image", files={"file": ("evil.png", b"not an image", "image/png")}, headers=auth_headers)
    assert evil.status_code == 400


def test_supplier_image_rejects_renamed_file(auth_headers):
    s = client.post("/api/suppliers", json={"name": "Bad Supply"}, headers=auth_headers).json()
    resp = client.post(f"/api/suppliers/{s['id']}/upload-image", files={"file": ("fake.jpg", PNG, "image/png")}, headers=auth_headers)
    assert resp.status_code == 400


def test_worker_cannot_upload_contact_images(auth_headers):
    worker = _register(auth_headers, "picworker", "picworker@example.com")
    c = client.post("/api/customers", json={"name": "Worker Pic Co"}, headers=auth_headers).json()
    s = client.post("/api/suppliers", json={"name": "Worker Pic Supply"}, headers=auth_headers).json()
    assert client.post(f"/api/customers/{c['id']}/upload-image", files={"file": ("l.png", PNG, "image/png")}, headers=worker).status_code == 403
    assert client.post(f"/api/suppliers/{s['id']}/upload-image", files={"file": ("l.png", PNG, "image/png")}, headers=worker).status_code == 403
    assert client.delete(f"/api/customers/{c['id']}/upload-image", headers=worker).status_code == 403


def test_sale_item_image_falls_back_to_gallery(auth_headers):
    prod = client.post("/api/products", json={"location_id": 1, "sku": "IMG-1", "name": "Galleried Item", "quantity": 10, "unit_price": 5.0}, headers=auth_headers).json()
    ups = client.post(
        f"/api/products/{prod['id']}/images",
        files=[("files", ("a.png", PNG, "image/png")), ("files", ("b.png", PNG, "image/png"))],
        headers=auth_headers,
    )
    assert ups.status_code == 200
    first = ups.json()[0]["url"]

    sale = client.post("/api/sales", json={"items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 5.0}]}, headers=auth_headers).json()
    assert sale["items"][0]["product_image"] == first
    detail = client.get(f"/api/sales/{sale['id']}", headers=auth_headers).json()
    assert detail["items"][0]["product_image"] == first