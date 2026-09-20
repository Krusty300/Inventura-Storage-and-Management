from tests.conftest import client

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\x00\x00\x00\x00\x00"
JPG = b"\xff\xd8\xff\xe0" + b"\x00" * 16


def _register(auth_headers, username, email, password="testpass123"):
    client.post("/api/users", json={
        "username": username, "email": email, "password": password, "role": "worker",
    }, headers=auth_headers)
    token = client.post("/api/auth/login", json={"username": username, "password": password}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _make_supplier(auth_headers, name):
    resp = client.post("/api/suppliers", json={"name": name}, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _make_customer(auth_headers, name):
    resp = client.post("/api/customers", json={"name": name}, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _make_supplier_account(auth_headers, username, supplier_id):
    resp = client.post("/api/users", json={
        "username": username, "email": f"{username}@example.com",
        "password": "portalpass123", "role": "supplier", "supplier_id": supplier_id,
    }, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    token = client.post("/api/auth/login", json={"username": username, "password": "portalpass123"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _make_customer_account(auth_headers, username, customer_id):
    resp = client.post("/api/users", json={
        "username": username, "email": f"{username}@example.com",
        "password": "portalpass123", "role": "customer", "customer_id": customer_id,
    }, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    token = client.post("/api/auth/login", json={"username": username, "password": "portalpass123"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_customer_upload_and_remove_image(auth_headers):
    c = _make_customer(auth_headers, "Pic Corp")
    headers = _make_customer_account(auth_headers, "piccus", c["id"])
    resp = client.post("/api/customer/profile/image", files={"file": ("logo.png", PNG, "image/png")}, headers=headers)
    assert resp.status_code == 200
    url = resp.json()["image_url"]
    assert url.startswith("/uploads/customer_")

    got = client.get("/api/customer/me", headers=headers).json()["customer"]
    assert got["image_url"] == url

    removed = client.delete("/api/customer/profile/image", headers=headers)
    assert removed.status_code == 200
    assert removed.json()["image_url"] == ""
    assert client.get("/api/customer/me", headers=headers).json()["customer"]["image_url"] == ""

    # The customer's image still flows to admin listings read-only.
    row = next(i for i in client.get("/api/customers", headers=auth_headers).json()["items"] if i["id"] == c["id"])
    assert row["image_url"] == ""


def test_supplier_upload_and_remove_image(auth_headers):
    s = _make_supplier(auth_headers, "Pic Supply")
    headers = _make_supplier_account(auth_headers, "picsup", s["id"])
    resp = client.post("/api/portal/profile/image", files={"file": ("logo.jpg", JPG, "image/jpeg")}, headers=headers)
    assert resp.status_code == 200
    url = resp.json()["image_url"]
    assert url.startswith("/uploads/supplier_")
    assert url.endswith(".jpg")

    got = client.get("/api/portal/me", headers=headers).json()["supplier"]
    assert got["image_url"] == url

    removed = client.delete("/api/portal/profile/image", headers=headers)
    assert removed.status_code == 200
    assert removed.json()["image_url"] == ""
    assert client.get("/api/portal/me", headers=headers).json()["supplier"]["image_url"] == ""


def test_customer_image_rejects_bad_file(auth_headers):
    c = _make_customer(auth_headers, "Bad Pic")
    headers = _make_customer_account(auth_headers, "badpic", c["id"])
    fake = client.post("/api/customer/profile/image", files={"file": ("fake.png", JPG, "image/jpeg")}, headers=headers)
    assert fake.status_code == 400
    evil = client.post("/api/customer/profile/image", files={"file": ("evil.png", b"not an image", "image/png")}, headers=headers)
    assert evil.status_code == 400


def test_supplier_image_rejects_renamed_file(auth_headers):
    s = _make_supplier(auth_headers, "Bad Supply")
    headers = _make_supplier_account(auth_headers, "badsup", s["id"])
    resp = client.post("/api/portal/profile/image", files={"file": ("fake.jpg", PNG, "image/png")}, headers=headers)
    assert resp.status_code == 400


def test_non_customer_cannot_manage_customer_image(auth_headers):
    worker = _register(auth_headers, "picworker", "picworker@example.com")
    c = _make_customer(auth_headers, "Worker Pic Co")
    assert client.post("/api/customer/profile/image", files={"file": ("l.png", PNG, "image/png")}, headers=worker).status_code == 403
    assert client.delete("/api/customer/profile/image", headers=worker).status_code == 403
    # The customer portal exposes only the customer's own image, so admins can't
    # reach a mutation endpoint either.
    admin_headers = auth_headers
    assert client.post("/api/customer/profile/image", files={"file": ("l.png", PNG, "image/png")}, headers=admin_headers).status_code == 403


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


def _upload_two(auth_headers, product_id):
    resp = client.post(
        f"/api/products/{product_id}/images",
        files=[("files", ("a.png", PNG, "image/png")), ("files", ("b.png", PNG, "image/png"))],
        headers=auth_headers,
    )
    assert resp.status_code == 200
    return resp.json()


def test_delete_product_image_advances_cover(auth_headers, monkeypatch, tmp_path):
    from app.routers import products as products_module
    monkeypatch.setattr(products_module, "UPLOAD_DIR", tmp_path)
    prod = client.post("/api/products", json={"location_id": 1, "sku": "IMG-PROD-A", "name": "Cover Advancer", "quantity": 10, "unit_price": 5.0}, headers=auth_headers).json()
    gallery = _upload_two(auth_headers, prod["id"])
    images = client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()["images"]
    first, second = images[0], images[1]
    assert client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()["image_url"] == first["url"]
    assert gallery[1]["url"] != first["url"]

    resp = client.delete(f"/api/products/{prod['id']}/images/{first['id']}", headers=auth_headers)
    assert resp.status_code == 200
    got = client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()
    assert got["image_url"] == second["url"]
    assert [i["url"] for i in got["images"]] == [second["url"]]


def test_delete_last_product_image_clears_cover(auth_headers, monkeypatch, tmp_path):
    from app.routers import products as products_module
    monkeypatch.setattr(products_module, "UPLOAD_DIR", tmp_path)
    prod = client.post("/api/products", json={"location_id": 1, "sku": "IMG-PROD-B", "name": "Cover Clearer", "quantity": 10, "unit_price": 5.0}, headers=auth_headers).json()
    row = client.post(f"/api/products/{prod['id']}/upload-image", files={"file": ("only.png", PNG, "image/png")}, headers=auth_headers).json()["image_url"]
    image_id = client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()["images"][0]["id"]
    assert client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()["image_url"] == row

    client.delete(f"/api/products/{prod['id']}/images/{image_id}", headers=auth_headers)
    got = client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()
    assert got["image_url"] == ""
    assert got["images"] == []


def test_single_upload_replaces_previous_row(auth_headers, monkeypatch, tmp_path):
    from app.routers import products as products_module
    monkeypatch.setattr(products_module, "UPLOAD_DIR", tmp_path)
    prod = client.post("/api/products", json={"location_id": 1, "sku": "IMG-PROD-C", "name": "Single Replacer", "quantity": 10, "unit_price": 5.0}, headers=auth_headers).json()
    first = client.post(f"/api/products/{prod['id']}/upload-image", files={"file": ("one.png", PNG, "image/png")}, headers=auth_headers).json()["image_url"]
    second = client.post(f"/api/products/{prod['id']}/upload-image", files={"file": ("two.png", PNG, "image/png")}, headers=auth_headers).json()["image_url"]
    assert first != second
    got = client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()
    assert got["image_url"] == second
    assert [i["url"] for i in got["images"]] == [second]


def test_reorder_updates_cover_image_url(auth_headers, monkeypatch, tmp_path):
    from app.routers import products as products_module
    monkeypatch.setattr(products_module, "UPLOAD_DIR", tmp_path)
    prod = client.post("/api/products", json={"location_id": 1, "sku": "IMG-PROD-D", "name": "Reorderer", "quantity": 10, "unit_price": 5.0}, headers=auth_headers).json()
    gallery = _upload_two(auth_headers, prod["id"])
    second_url = gallery[1]["url"]
    images = client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()["images"]
    order = [images[1]["id"], images[0]["id"]]

    resp = client.put(f"/api/products/{prod['id']}/images/reorder", json={"image_ids": order}, headers=auth_headers)
    assert resp.status_code == 200
    got = client.get(f"/api/products/{prod['id']}", headers=auth_headers).json()
    assert got["image_url"] == second_url
    assert [i["sort_order"] for i in got["images"]] == [0, 1]