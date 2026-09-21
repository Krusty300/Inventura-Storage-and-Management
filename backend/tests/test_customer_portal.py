"""Customer portal: account provisioning, auth scoping, catalog pricing, and sales visibility."""

from tests.conftest import client, create_test_user

PASSWORD = "portalpass123"


def _make_product(auth_headers, sku, unit_price=10.0, quantity=10):
    resp = client.post("/api/products", json={
        "location_id": 1, "sku": sku, "name": sku,
        "unit_price": unit_price, "cost_price": 5.0, "quantity": quantity,
    }, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _make_customer(auth_headers, name, **extra):
    payload = {"name": name}
    payload.update(extra)
    resp = client.post("/api/customers", json=payload, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _make_customer_account(auth_headers, username, customer_id=None, role="customer"):
    payload = {"username": username, "email": f"{username}@example.com", "password": PASSWORD, "role": role}
    if customer_id is not None:
        payload["customer_id"] = customer_id
    return client.post("/api/users", json=payload, headers=auth_headers)


def _login(username, password=PASSWORD):
    resp = client.post("/api/auth/login", json={"username": username, "password": password})
    assert resp.status_code == 200, resp.text
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _sale(auth_headers, customer_id, product_id, quantity=2, unit_price=10.0):
    resp = client.post("/api/sales", json={
        "customer_id": customer_id,
        "items": [{"product_id": product_id, "quantity": quantity, "unit_price": unit_price}],
        "payment_method": "cash",
    }, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


# ---------------------------------------------------------------- provisioning

def test_admin_creates_customer_account(auth_headers):
    customer = _make_customer(auth_headers, "Portal Customer")
    resp = _make_customer_account(auth_headers, "portalcust", customer_id=customer["id"])
    assert resp.status_code == 201, resp.text
    user = resp.json()
    assert user["role"] == "customer"
    assert user["customer_id"] == customer["id"]
    assert user["customer_name"] == "Portal Customer"


def test_customer_role_requires_customer_link(auth_headers):
    resp = _make_customer_account(auth_headers, "customeral")
    assert resp.status_code == 400
    assert "linked to a customer" in resp.json()["detail"]


def test_customer_link_rejected_for_non_customer_roles(auth_headers):
    customer = _make_customer(auth_headers, "Not A Portal Customer")
    for role in ("admin", "manager", "worker"):
        resp = _make_customer_account(auth_headers, f"plain_{role}", customer_id=customer["id"], role=role)
        assert resp.status_code == 400, role
        assert "Only customer accounts" in resp.json()["detail"]


def test_customer_link_requires_existing_customer(auth_headers):
    resp = _make_customer_account(auth_headers, "ghostlink", customer_id=999999)
    assert resp.status_code == 400
    assert "Customer not found or inactive" in resp.json()["detail"]


def test_update_customer_link_validations(auth_headers):
    cust_a = _make_customer(auth_headers, "Upd Customer A")
    cust_b = _make_customer(auth_headers, "Upd Customer B")
    created = _make_customer_account(auth_headers, "updcust", customer_id=cust_a["id"]).json()
    # Reassign to another customer.
    resp = client.put(f"/api/users/{created['id']}", json={"customer_id": cust_b["id"]}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["customer_id"] == cust_b["id"]
    # Unlinking a customer account is not allowed.
    resp = client.put(f"/api/users/{created['id']}", json={"customer_id": None}, headers=auth_headers)
    assert resp.status_code == 400
    # Linking a non-customer role is not allowed.
    worker = client.post("/api/users", json={
        "username": "plainworker2", "email": "plainworker2@example.com",
        "password": PASSWORD, "role": "worker",
    }, headers=auth_headers).json()
    resp = client.put(f"/api/users/{worker['id']}", json={"customer_id": cust_b["id"]}, headers=auth_headers)
    assert resp.status_code == 400
    # Demoting a customer clears the link automatically.
    resp = client.put(f"/api/users/{created['id']}", json={"role": "worker"}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["customer_id"] is None


def test_customer_account_cannot_hold_custom_permissions(auth_headers):
    customer = _make_customer(auth_headers, "Perm Customer")
    resp = client.post("/api/users", json={
        "username": "permcust", "email": "permcust@example.com", "password": PASSWORD,
        "role": "customer", "customer_id": customer["id"], "permissions": ["sales.view"],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "custom permissions" in resp.json()["detail"]


# ---------------------------------------------------------------- portal auth

def test_portal_requires_customer_account(auth_headers):
    assert client.get("/api/customer/me", headers=auth_headers).status_code == 403


def test_customer_without_link_blocked(auth_headers):
    create_test_user("nolinkcust", "nolinkcust@example.com", PASSWORD, role="customer")
    headers = _login("nolinkcust")
    resp = client.get("/api/customer/me", headers=headers)
    assert resp.status_code == 403
    assert "not linked" in resp.json()["detail"]


def test_customer_blocked_when_customer_soft_deleted(auth_headers):
    customer = _make_customer(auth_headers, "Doomed Customer")
    _make_customer_account(auth_headers, "doomedcust", customer_id=customer["id"]).json()
    headers = _login("doomedcust")
    assert client.get("/api/customer/me", headers=headers).status_code == 200
    resp = client.delete(f"/api/customers/{customer['id']}", headers=auth_headers)
    assert resp.status_code == 200
    resp = client.get("/api/customer/me", headers=headers)
    assert resp.status_code == 403
    assert "unavailable" in resp.json()["detail"]


def test_customer_user_deactivated_cannot_login(auth_headers):
    customer = _make_customer(auth_headers, "Gone Customer")
    user = _make_customer_account(auth_headers, "gonecust", customer_id=customer["id"]).json()
    client.put(f"/api/users/{user['id']}", json={"is_active": False}, headers=auth_headers)
    resp = client.post("/api/auth/login", json={"username": "gonecust", "password": PASSWORD})
    assert resp.status_code == 401


def test_customer_login_and_portal_me(auth_headers):
    customer = _make_customer(auth_headers, "Portal Me Customer")
    _make_customer_account(auth_headers, "mecust", customer_id=customer["id"]).json()
    headers = _login("mecust")
    data = client.get("/api/customer/me", headers=headers).json()
    assert data["user"]["role"] == "customer"
    assert data["user"]["customer_id"] == customer["id"]
    assert data["customer"]["name"] == "Portal Me Customer"


def test_customer_cannot_use_internal_endpoints(auth_headers):
    customer = _make_customer(auth_headers, "Fenced Customer")
    _make_customer_account(auth_headers, "fencedcust", customer_id=customer["id"]).json()
    headers = _login("fencedcust")
    assert client.get("/api/orders", headers=headers).status_code == 403
    assert client.get("/api/customers", headers=headers).status_code == 403
    assert client.get("/api/products", headers=headers).status_code == 403
    assert client.get("/api/sales", headers=headers).status_code == 403
    assert client.get("/api/dashboard/stats", headers=headers).status_code == 403


# ---------------------------------------------------------------- catalog + pricing

def test_portal_catalog_lists_active_products(auth_headers):
    customer = _make_customer(auth_headers, "Catalog Customer")
    _make_customer_account(auth_headers, "catcust", customer_id=customer["id"]).json()
    prod = _make_product(auth_headers, "CAT-1", unit_price=25.0)
    hidden = _make_product(auth_headers, "CAT-HIDDEN", unit_price=5.0)
    client.put(f"/api/products/{hidden['id']}", json={"is_active": False}, headers=auth_headers)
    headers = _login("catcust")
    data = client.get("/api/customer/products", headers=headers).json()
    assert data["total"] == 1
    item = data["items"][0]
    assert item["id"] == prod["id"]
    assert item["price"] == 25.0
    assert item["unit_price"] == 25.0
    assert item["in_stock"] is True


def test_portal_catalog_resolves_group_price_list(auth_headers):
    prod = _make_product(auth_headers, "CAT-PRICED", unit_price=20.0)
    pl = client.post("/api/price-lists", json={
        "name": "Wholesale Cat", "is_default": False,
        "items": [{"product_id": prod["id"], "price": 12.5}],
    }, headers=auth_headers).json()
    group = client.post("/api/customer-groups", json={
        "name": "Wholesale Group", "price_list_id": pl["id"],
    }, headers=auth_headers).json()
    customer = _make_customer(auth_headers, "Priced Customer", group_id=group["id"])
    _make_customer_account(auth_headers, "pricedcust", customer_id=customer["id"]).json()
    headers = _login("pricedcust")
    data = client.get("/api/customer/products", headers=headers).json()
    item = data["items"][0]
    assert item["price"] == 12.5
    assert item["unit_price"] == 20.0
    detail = client.get(f"/api/customer/products/{prod['id']}", headers=headers).json()
    assert detail["price"] == 12.5


def test_portal_catalog_detail_hides_parents_and_inactive(auth_headers):
    customer = _make_customer(auth_headers, "Detail Customer")
    _make_customer_account(auth_headers, "detcust", customer_id=customer["id"]).json()
    prod = _make_product(auth_headers, "CAT-DETAIL", unit_price=9.0)
    headers = _login("detcust")
    data = client.get(f"/api/customer/products/{prod['id']}", headers=headers).json()
    assert data["id"] == prod["id"]
    assert client.get("/api/customer/products/999999", headers=headers).status_code == 404
    child = client.post("/api/products", json={
        "location_id": 1, "sku": "CAT-CHILD", "name": "Child",
        "unit_price": 1.0, "parent_id": prod["id"],
    }, headers=auth_headers)
    if child.status_code == 201:
        # Variant children are hidden from the portal catalog.
        assert client.get(f"/api/customer/products/{child.json()['id']}", headers=headers).status_code == 404
        assert any(p["id"] == prod["id"] for p in client.get("/api/customer/products", headers=headers).json()["items"])


def test_portal_catalog_filters_unknown_status_ok(auth_headers):
    customer = _make_customer(auth_headers, "Search Customer")
    _make_customer_account(auth_headers, "srchcust", customer_id=customer["id"]).json()
    _make_product(auth_headers, "SEARCH-ONE", unit_price=4.0)
    headers = _login("srchcust")
    data = client.get("/api/customer/products", params={"search": "search-one"}, headers=headers).json()
    assert data["total"] == 1


def test_portal_catalog_image_url_falls_back_to_gallery(auth_headers):
    prod = _make_product(auth_headers, "CAT-IMAGED", unit_price=7.0)
    # Seed a gallery entry; the product's image_url column stays empty so the
    # catalog must fall back to images[0].url.
    from sqlalchemy.orm import Session
    from tests.conftest import TestingSessionLocal
    from app.models.product_image import ProductImage
    db: Session = TestingSessionLocal()
    db.add(ProductImage(product_id=prod["id"], url="/uploads/gallery-test.jpg", sort_order=0))
    db.commit()
    db.close()

    customer = _make_customer(auth_headers, "Imaged Customer")
    _make_customer_account(auth_headers, "imgcust", customer_id=customer["id"]).json()
    headers = _login("imgcust")
    for item in client.get("/api/customer/products", headers=headers).json()["items"]:
        if item["id"] == prod["id"]:
            assert item["image_url"] == "/uploads/gallery-test.jpg"
            break
    else:
        raise AssertionError("product with gallery image not present in catalog")
    detail = client.get(f"/api/customer/products/{prod['id']}", headers=headers).json()
    assert detail["image_url"] == "/uploads/gallery-test.jpg"


# ---------------------------------------------------------------- sales scoping

def _customer_with_sale(auth_headers, name, sku, customer_id, quantity=2):
    prod = _make_product(auth_headers, sku)
    return prod, _sale(auth_headers, customer_id, prod["id"], quantity=quantity)


def test_portal_lists_only_own_sales(auth_headers):
    cust_a = _make_customer(auth_headers, "Scoped Customer A")
    cust_b = _make_customer(auth_headers, "Scoped Customer B")
    _make_customer_account(auth_headers, "scoped_a", customer_id=cust_a["id"]).json()
    _make_customer_account(auth_headers, "scoped_b", customer_id=cust_b["id"]).json()
    sale_a = _customer_with_sale(auth_headers, "Scoped A", "SCOPE-CA", cust_a["id"])[1]
    _customer_with_sale(auth_headers, "Scoped B", "SCOPE-CB", cust_b["id"])[1]
    headers = _login("scoped_a")
    data = client.get("/api/customer/sales", headers=headers).json()
    assert data["total"] == 1
    assert data["items"][0]["customer_id"] == cust_a["id"]
    # Customer B cannot see customer A's sale detail.
    headers_b = _login("scoped_b")
    resp = client.get(f"/api/customer/sales/{sale_a['id']}", headers=headers_b)
    assert resp.status_code == 404
    # ...but can see its own.
    own = client.get("/api/customer/sales", headers=headers_b).json()
    assert own["total"] == 1
    assert own["items"][0]["customer_id"] == cust_b["id"]


def test_portal_sale_detail_scoped_404(auth_headers):
    cust = _make_customer(auth_headers, "Hidden Customer")
    _customer_with_sale(auth_headers, "Hidden", "HIDE-SALE", cust["id"])
    other = _make_customer(auth_headers, "Other Customer")
    _make_customer_account(auth_headers, "hideother", customer_id=other["id"]).json()
    headers = _login("hideother")
    assert client.get("/api/customer/sales/999999", headers=headers).status_code == 404


def test_portal_summary_counts_and_recent(auth_headers):
    cust = _make_customer(auth_headers, "Summary Customer")
    prod, sale = _customer_with_sale(auth_headers, "Summary", "SUM-CUST", cust["id"], quantity=2)
    _make_customer_account(auth_headers, "sumcust", customer_id=cust["id"]).json()
    headers = _login("sumcust")
    data = client.get("/api/customer/summary", headers=headers).json()
    assert data["total_sales"] == 1
    assert data["status_counts"]["completed"] == 1
    assert data["total_spent"] > 0
    assert len(data["recent_sales"]) == 1


def test_portal_sales_status_filter_rejects_invalid(auth_headers):
    cust = _make_customer(auth_headers, "Filter Customer")
    _customer_with_sale(auth_headers, "Filter", "FIL-SALE", cust["id"])
    _make_customer_account(auth_headers, "filcust", customer_id=cust["id"]).json()
    headers = _login("filcust")
    resp = client.get("/api/customer/sales", params={"status": "draft"}, headers=headers)
    assert resp.status_code == 400
    data = client.get("/api/customer/sales", params={"status": "completed"}, headers=headers).json()
    assert data["total"] == 1


def test_portal_sale_pdf(auth_headers):
    cust = _make_customer(auth_headers, "Invoice Customer")
    _, sale = _customer_with_sale(auth_headers, "Invoice", "INV-CUST", cust["id"])
    _make_customer_account(auth_headers, "invcust", customer_id=cust["id"]).json()
    headers = _login("invcust")
    resp = client.get(f"/api/customer/sales/{sale['id']}/pdf", headers=headers)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.content.startswith(b"%PDF")


# ---------------------------------------------------------------- profile + purge

def test_portal_profile_update(auth_headers):
    cust = _make_customer(auth_headers, "Profile Customer")
    _make_customer_account(auth_headers, "profcust", customer_id=cust["id"]).json()
    headers = _login("profcust")
    resp = client.patch("/api/customer/profile", json={
        "phone": "+15555550100", "address": "1 Portal Way",
    }, headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["phone"] == "+15555550100"
    assert resp.json()["address"] == "1 Portal Way"


def test_portal_profile_update_requires_field_changes(auth_headers):
    cust = _make_customer(auth_headers, "Noop Customer")
    _make_customer_account(auth_headers, "noopcust", customer_id=cust["id"]).json()
    headers = _login("noopcust")
    resp = client.patch("/api/customer/profile", json={}, headers=headers)
    assert resp.status_code == 400
    resp = client.patch("/api/customer/profile", json={"email": "not-an-email"}, headers=headers)
    assert resp.status_code == 422


def test_portal_change_password(auth_headers):
    cust = _make_customer(auth_headers, "Password Customer")
    _make_customer_account(auth_headers, "pwcust", customer_id=cust["id"]).json()
    headers = _login("pwcust")
    resp = client.post("/api/customer/change-password", json={
        "current_password": PASSWORD,
        "new_password": "newpassword456",
    }, headers=headers)
    assert resp.status_code == 200, resp.text
    assert _login("pwcust", "newpassword456")["Authorization"]
    # The old password no longer works.
    resp = client.post("/api/auth/login", json={"username": "pwcust", "password": PASSWORD})
    assert resp.status_code == 401


def test_purge_customer_blocked_with_linked_accounts(auth_headers):
    customer = _make_customer(auth_headers, "Purge Customer")
    _make_customer_account(auth_headers, "purgecust", customer_id=customer["id"]).json()
    client.delete(f"/api/customers/{customer['id']}", headers=auth_headers)
    resp = client.delete(f"/api/trash/customer/{customer['id']}", headers=auth_headers)
    assert resp.status_code == 400
    assert "linked portal accounts" in resp.json()["detail"]


# ---------------------------------------------------------------- checkout

def test_portal_checkout_completes_sale(auth_headers):
    customer = _make_customer(auth_headers, "Checkout Customer")
    _make_customer_account(auth_headers, "cocust", customer_id=customer["id"]).json()
    prod = _make_product(auth_headers, "CO-1", unit_price=30.0, quantity=5)
    headers = _login("cocust")
    resp = client.post("/api/customer/checkout", json={
        "items": [{"product_id": prod["id"], "quantity": 2}],
        "payment_method": "cash",
    }, headers=headers)
    assert resp.status_code == 201, resp.text
    sale = resp.json()
    assert sale["customer_id"] == customer["id"]
    assert sale["status"] == "completed"
    assert sale["payment_method"] == "cash"
    assert sale["subtotal"] == 60.0
    assert sale["total_amount"] == 60.0
    assert sale["items"][0]["quantity"] == 2
    assert sale["items"][0]["unit_price"] == 30.0
    # Stock was decremented: only 3 remain, so 4 more fails but 3 succeeds.
    resp = client.post("/api/customer/checkout", json={
        "items": [{"product_id": prod["id"], "quantity": 4}],
        "payment_method": "cash",
    }, headers=headers)
    assert resp.status_code == 400
    assert "out of stock" in resp.json()["detail"]
    resp = client.post("/api/customer/checkout", json={
        "items": [{"product_id": prod["id"], "quantity": 3}],
        "payment_method": "cash",
    }, headers=headers)
    assert resp.status_code == 201, resp.text


def test_portal_checkout_card_and_transfer(auth_headers):
    customer = _make_customer(auth_headers, "Card Customer")
    _make_customer_account(auth_headers, "cardcust", customer_id=customer["id"]).json()
    prod = _make_product(auth_headers, "CO-CARD", unit_price=10.0)
    headers = _login("cardcust")
    resp = client.post("/api/customer/checkout", json={
        "items": [{"product_id": prod["id"], "quantity": 1}],
        "payment_method": "card", "payment_reference": "CARD-REF-1",
    }, headers=headers)
    assert resp.status_code == 201, resp.text
    assert resp.json()["payment_method"] == "card"
    assert resp.json()["payment_reference"] == "CARD-REF-1"
    resp = client.post("/api/customer/checkout", json={
        "items": [{"product_id": prod["id"], "quantity": 1}],
        "payment_method": "transfer",
    }, headers=headers)
    assert resp.status_code == 201, resp.text
    assert resp.json()["payment_method"] == "transfer"


def test_portal_checkout_rejects_mobile_money(auth_headers):
    customer = _make_customer(auth_headers, "MoMo Customer")
    _make_customer_account(auth_headers, "momocust", customer_id=customer["id"]).json()
    prod = _make_product(auth_headers, "CO-MOMO", unit_price=10.0)
    headers = _login("momocust")
    resp = client.post("/api/customer/checkout", json={
        "items": [{"product_id": prod["id"], "quantity": 1}],
        "payment_method": "mobile_money", "payment_provider": "m-pesa",
    }, headers=headers)
    assert resp.status_code == 400
    assert "Mobile money" in resp.json()["detail"]


def test_portal_checkout_rejects_provider_for_cash(auth_headers):
    customer = _make_customer(auth_headers, "Provider Customer")
    _make_customer_account(auth_headers, "provcust", customer_id=customer["id"]).json()
    prod = _make_product(auth_headers, "CO-PROV", unit_price=10.0)
    headers = _login("provcust")
    resp = client.post("/api/customer/checkout", json={
        "items": [{"product_id": prod["id"], "quantity": 1}],
        "payment_method": "cash", "payment_provider": "m-pesa",
    }, headers=headers)
    assert resp.status_code == 400
    assert "payment_provider" in resp.json()["detail"]


def test_portal_checkout_requires_items(auth_headers):
    customer = _make_customer(auth_headers, "Empty Customer")
    _make_customer_account(auth_headers, "emptycust", customer_id=customer["id"]).json()
    headers = _login("emptycust")
    resp = client.post("/api/customer/checkout", json={"items": []}, headers=headers)
    assert resp.status_code == 422


def test_portal_checkout_resolves_group_price_list(auth_headers):
    prod = _make_product(auth_headers, "CO-PRICED", unit_price=20.0, quantity=10)
    pl = client.post("/api/price-lists", json={
        "name": "Checkout Price List", "is_default": False,
        "items": [{"product_id": prod["id"], "price": 12.5}],
    }, headers=auth_headers).json()
    group = client.post("/api/customer-groups", json={
        "name": "Checkout Group", "price_list_id": pl["id"],
    }, headers=auth_headers).json()
    customer = _make_customer(auth_headers, "Pay Customer", group_id=group["id"])
    _make_customer_account(auth_headers, "paycust", customer_id=customer["id"]).json()
    headers = _login("paycust")
    resp = client.post("/api/customer/checkout", json={
        "items": [{"product_id": prod["id"], "quantity": 2}],
        "payment_method": "cash",
    }, headers=headers)
    assert resp.status_code == 201, resp.text
    sale = resp.json()
    assert sale["subtotal"] == 25.0
    assert sale["items"][0]["unit_price"] == 12.5


def test_portal_checkout_lands_in_order_history(auth_headers):
    customer = _make_customer(auth_headers, "History Customer")
    _make_customer_account(auth_headers, "histcust", customer_id=customer["id"]).json()
    prod = _make_product(auth_headers, "CO-HIST", unit_price=15.0)
    headers = _login("histcust")
    resp = client.post("/api/customer/checkout", json={
        "items": [{"product_id": prod["id"], "quantity": 1}],
        "payment_method": "cash",
    }, headers=headers)
    assert resp.status_code == 201, resp.text
    sale = resp.json()
    data = client.get("/api/customer/sales", headers=headers).json()
    assert data["total"] == 1
    assert data["items"][0]["invoice_number"] == sale["invoice_number"]
    summary = client.get("/api/customer/summary", headers=headers).json()
    assert summary["total_sales"] == 1
    assert summary["status_counts"]["completed"] == 1
    assert client.get(f"/api/customer/sales/{sale['id']}/pdf", headers=headers).status_code == 200


def test_portal_checkout_scoped_to_own_account(auth_headers):
    cust_a = _make_customer(auth_headers, "Scoped Checkout A")
    cust_b = _make_customer(auth_headers, "Scoped Checkout B")
    _make_customer_account(auth_headers, "scopeco_a", customer_id=cust_a["id"]).json()
    _make_customer_account(auth_headers, "scopeco_b", customer_id=cust_b["id"]).json()
    prod = _make_product(auth_headers, "CO-SCOPE", unit_price=5.0, quantity=10)
    sale = client.post("/api/customer/checkout", json={
        "items": [{"product_id": prod["id"], "quantity": 1}],
        "payment_method": "cash",
    }, headers=_login("scopeco_b")).json()
    resp = client.get(f"/api/customer/sales/{sale['id']}", headers=_login("scopeco_a"))
    assert resp.status_code == 404


# ---------------------------------------------------------------- live pricing

def test_portal_me_exposes_date_format_and_page_size(auth_headers):
    customer = _make_customer(auth_headers, "Me Fields Customer")
    _make_customer_account(auth_headers, "mefields", customer_id=customer["id"]).json()
    data = client.get("/api/customer/me", headers=_login("mefields")).json()
    assert data["currency_code"] in ("USD",)
    assert bool(data["currency_symbol"])
    assert data["date_format"] == "YYYY-MM-DD"
    assert data["default_items_per_page"] >= 1


def test_portal_pricing_matches_checkout(auth_headers):
    customer = _make_customer(auth_headers, "Pricing Customer")
    _make_customer_account(auth_headers, "pricecust", customer_id=customer["id"]).json()
    prod = _make_product(auth_headers, "PRICE-1", unit_price=30.0, quantity=10)
    headers = _login("pricecust")
    resp = client.post("/api/customer/pricing", json={
        "items": [{"product_id": prod["id"], "quantity": 2}],
    }, headers=headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["subtotal"] == 60.0
    assert data["items"][0]["unit_price"] == 30.0
    assert data["items"][0]["line_total"] == 60.0
    # Checkout lands at exactly the price shown in the cart.
    sale = client.post("/api/customer/checkout", json={
        "items": [{"product_id": prod["id"], "quantity": 2}],
        "payment_method": "cash",
    }, headers=headers).json()
    assert sale["subtotal"] == data["subtotal"]
    assert sale["total_amount"] == data["total"]
    assert sale["items"][0]["unit_price"] == data["items"][0]["unit_price"]


def test_portal_pricing_resolves_group_list_with_qty(auth_headers):
    prod = _make_product(auth_headers, "PRICE-GRP", unit_price=20.0, quantity=50)
    pl = client.post("/api/price-lists", json={
        "name": "Pricing List", "is_default": False,
        "items": [{"product_id": prod["id"], "price": 10.0}],
    }, headers=auth_headers).json()
    group = client.post("/api/customer-groups", json={
        "name": "Pricing Group", "price_list_id": pl["id"],
    }, headers=auth_headers).json()
    customer = _make_customer(auth_headers, "Priced Group Customer", group_id=group["id"])
    _make_customer_account(auth_headers, "pricegrp", customer_id=customer["id"]).json()
    data = client.post("/api/customer/pricing", json={
        "items": [{"product_id": prod["id"], "quantity": 3}],
    }, headers=_login("pricegrp")).json()
    assert data["subtotal"] == 30.0
    assert data["items"][0]["unit_price"] == 10.0


def test_portal_pricing_guards_mirror_checkout(auth_headers):
    customer = _make_customer(auth_headers, "Pricing Guard Customer")
    _make_customer_account(auth_headers, "priceguard", customer_id=customer["id"]).json()
    headers = _login("priceguard")
    resp = client.post("/api/customer/pricing", json={"items": []}, headers=headers)
    assert resp.status_code == 422
    resp = client.post("/api/customer/pricing", json={
        "items": [{"product_id": 999999, "quantity": 1}],
    }, headers=headers)
    assert resp.status_code == 404
    resp = client.post("/api/customer/pricing", json={
        "items": [{"product_id": 1, "quantity": 0}],
    }, headers=headers)
    assert resp.status_code == 422