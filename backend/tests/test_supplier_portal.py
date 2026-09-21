"""Supplier portal: account provisioning, auth scoping, and PO transitions."""

from tests.conftest import client, create_test_order, create_test_user, submit_approve

PASSWORD = "portalpass123"


def _make_product(auth_headers, sku):
    resp = client.post("/api/products", json={
        "location_id": 1, "sku": sku, "name": sku, "cost_price": 5.0,
    }, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _make_supplier(auth_headers, name):
    resp = client.post("/api/suppliers", json={"name": name}, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _make_supplier_account(auth_headers, username, supplier_id=None, role="supplier"):
    payload = {"username": username, "email": f"{username}@example.com", "password": PASSWORD, "role": role}
    if supplier_id is not None:
        payload["supplier_id"] = supplier_id
    return client.post("/api/users", json=payload, headers=auth_headers)


def _login(username, password=PASSWORD):
    resp = client.post("/api/auth/login", json={"username": username, "password": password})
    assert resp.status_code == 200, resp.text
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _approved_order(auth_headers, supplier_id, product_sku, quantity=2):
    prod = _make_product(auth_headers, product_sku)
    order = create_test_order(client, auth_headers, prod["id"], quantity=quantity, supplier_id=supplier_id)
    submit_approve(client, auth_headers, order["id"])
    return order


# ---------------------------------------------------------------- provisioning

def test_admin_creates_supplier_account(auth_headers):
    supplier = _make_supplier(auth_headers, "Portal Supplier")
    resp = _make_supplier_account(auth_headers, "portalsup", supplier_id=supplier["id"])
    assert resp.status_code == 201, resp.text
    user = resp.json()
    assert user["role"] == "supplier"
    assert user["supplier_id"] == supplier["id"]
    assert user["supplier_name"] == "Portal Supplier"


def test_supplier_role_requires_supplier_link(auth_headers):
    resp = _make_supplier_account(auth_headers, "portalless")
    assert resp.status_code == 400
    assert "linked to a supplier" in resp.json()["detail"]


def test_supplier_link_rejected_for_non_supplier_roles(auth_headers):
    supplier = _make_supplier(auth_headers, "Not A Portal Supplier")
    for role in ("admin", "manager", "worker"):
        resp = _make_supplier_account(auth_headers, f"plain_{role}", supplier_id=supplier["id"], role=role)
        assert resp.status_code == 400, role
        assert "Only supplier accounts" in resp.json()["detail"]


def test_supplier_link_requires_existing_supplier(auth_headers):
    resp = _make_supplier_account(auth_headers, "ghostlink", supplier_id=999999)
    assert resp.status_code == 400
    assert "Supplier not found or inactive" in resp.json()["detail"]


def test_update_supplier_link_validations(auth_headers):
    sup_a = _make_supplier(auth_headers, "Upd Supplier A")
    sup_b = _make_supplier(auth_headers, "Upd Supplier B")
    created = _make_supplier_account(auth_headers, "updsup", supplier_id=sup_a["id"]).json()
    # Reassign to another supplier.
    resp = client.put(f"/api/users/{created['id']}", json={"supplier_id": sup_b["id"]}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["supplier_id"] == sup_b["id"]
    # Unlinking a supplier account is not allowed.
    resp = client.put(f"/api/users/{created['id']}", json={"supplier_id": None}, headers=auth_headers)
    assert resp.status_code == 400
    # Linking a non-supplier role is not allowed.
    worker = client.post("/api/users", json={
        "username": "plainworker", "email": "plainworker@example.com",
        "password": PASSWORD, "role": "worker",
    }, headers=auth_headers).json()
    resp = client.put(f"/api/users/{worker['id']}", json={"supplier_id": sup_b["id"]}, headers=auth_headers)
    assert resp.status_code == 400
    # Demoting a supplier clears the link automatically.
    resp = client.put(f"/api/users/{created['id']}", json={"role": "worker"}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["supplier_id"] is None


def test_supplier_account_cannot_hold_custom_permissions(auth_headers):
    supplier = _make_supplier(auth_headers, "Perm Supplier")
    resp = client.post("/api/users", json={
        "username": "permsup", "email": "permsup@example.com", "password": PASSWORD,
        "role": "supplier", "supplier_id": supplier["id"], "permissions": ["orders.view"],
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "custom permissions" in resp.json()["detail"]


# ---------------------------------------------------------------- portal auth

def test_portal_requires_supplier_account(auth_headers):
    assert client.get("/api/portal/me", headers=auth_headers).status_code == 403


def test_supplier_without_link_blocked(auth_headers):
    create_test_user("nolinksup", "nolinksup@example.com", PASSWORD, role="supplier")
    headers = _login("nolinksup")
    resp = client.get("/api/portal/me", headers=headers)
    assert resp.status_code == 403
    assert "not linked" in resp.json()["detail"]


def test_supplier_blocked_when_supplier_soft_deleted(auth_headers):
    supplier = _make_supplier(auth_headers, "Doomed Supplier")
    _make_supplier_account(auth_headers, "doomedsup", supplier_id=supplier["id"]).json()
    headers = _login("doomedsup")
    assert client.get("/api/portal/me", headers=headers).status_code == 200
    resp = client.delete(f"/api/suppliers/{supplier['id']}", headers=auth_headers)
    assert resp.status_code == 200
    resp = client.get("/api/portal/me", headers=headers)
    assert resp.status_code == 403
    assert "unavailable" in resp.json()["detail"]


def test_supplier_user_deactivated_cannot_login(auth_headers):
    supplier = _make_supplier(auth_headers, "Gone Supplier")
    user = _make_supplier_account(auth_headers, "gonessup", supplier_id=supplier["id"]).json()
    client.put(f"/api/users/{user['id']}", json={"is_active": False}, headers=auth_headers)
    resp = client.post("/api/auth/login", json={"username": "gonessup", "password": PASSWORD})
    assert resp.status_code == 401


def test_supplier_login_and_portal_me(auth_headers):
    supplier = _make_supplier(auth_headers, "Portal Me Supplier")
    _make_supplier_account(auth_headers, "mesup", supplier_id=supplier["id"]).json()
    headers = _login("mesup")
    data = client.get("/api/portal/me", headers=headers).json()
    assert data["user"]["role"] == "supplier"
    assert data["user"]["supplier_id"] == supplier["id"]
    assert data["supplier"]["name"] == "Portal Me Supplier"


def test_portal_me_uses_supplier_default_page_size(auth_headers):
    supplier = _make_supplier(auth_headers, "Paging Supplier")
    _make_supplier_account(auth_headers, "pagingsup", supplier_id=supplier["id"]).json()
    headers = _login("pagingsup")
    # Until the supplier picks their own size, the store default applies.
    assert client.get("/api/portal/me", headers=headers).json()["default_items_per_page"] == 25
    resp = client.patch("/api/portal/settings", json={"default_page_size": 50}, headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["preferences"]["default_page_size"] == 50
    assert client.get("/api/portal/me", headers=headers).json()["default_items_per_page"] == 50
    # Non-allowed sizes are still rejected.
    resp = client.patch("/api/portal/settings", json={"default_page_size": 40}, headers=headers)
    assert resp.status_code == 422


def test_supplier_cannot_use_internal_endpoints(auth_headers):
    supplier = _make_supplier(auth_headers, "Fenced Supplier")
    _make_supplier_account(auth_headers, "fencedsup", supplier_id=supplier["id"]).json()
    headers = _login("fencedsup")
    assert client.get("/api/orders", headers=headers).status_code == 403
    assert client.get("/api/suppliers", headers=headers).status_code == 403
    assert client.get("/api/products", headers=headers).status_code == 403
    assert client.get("/api/dashboard/stats", headers=headers).status_code == 403


# ---------------------------------------------------------------- order scoping

def test_portal_lists_only_own_orders(auth_headers):
    sup_a = _make_supplier(auth_headers, "Scoped Supplier A")
    sup_b = _make_supplier(auth_headers, "Scoped Supplier B")
    _make_supplier_account(auth_headers, "scoped_a", supplier_id=sup_a["id"]).json()
    order_a = _approved_order(auth_headers, sup_a["id"], "SCOPE-A")
    _approved_order(auth_headers, sup_b["id"], "SCOPE-B")
    headers = _login("scoped_a")
    data = client.get("/api/portal/orders", headers=headers).json()
    assert data["total"] == 1
    assert data["items"][0]["id"] == order_a["id"]
    assert data["items"][0]["supplier_id"] == sup_a["id"]


def test_portal_hides_pending_and_submitted(auth_headers):
    supplier = _make_supplier(auth_headers, "Hide Drafts Supplier")
    _make_supplier_account(auth_headers, "draftsup", supplier_id=supplier["id"]).json()
    _approved_order(auth_headers, supplier["id"], "DRAFT-OK")
    create_test_order(client, auth_headers, _make_product(auth_headers, "DRAFT-PEND")["id"], supplier_id=supplier["id"])
    headers = _login("draftsup")
    data = client.get("/api/portal/orders", headers=headers).json()
    assert data["total"] == 1
    resp = client.get("/api/portal/orders", params={"status": "pending"}, headers=headers)
    assert resp.status_code == 400
    summary = client.get("/api/portal/summary", headers=headers).json()
    assert summary["total_orders"] == 1


def test_portal_order_detail_scoped(auth_headers):
    sup_a = _make_supplier(auth_headers, "Detail Supplier A")
    sup_b = _make_supplier(auth_headers, "Detail Supplier B")
    order_b = _approved_order(auth_headers, sup_b["id"], "DETAIL-B")
    _make_supplier_account(auth_headers, "detail_a", supplier_id=sup_a["id"]).json()
    headers = _login("detail_a")
    resp = client.get(f"/api/portal/orders/{order_b['id']}", headers=headers)
    assert resp.status_code == 404
    resp = client.get("/api/portal/orders/999999", headers=headers)
    assert resp.status_code == 404


def test_portal_summary_counts_and_recent(auth_headers):
    supplier = _make_supplier(auth_headers, "Summary Supplier")
    _approved_order(auth_headers, supplier["id"], "SUM-ONE", quantity=2)
    _make_supplier_account(auth_headers, "sumsup", supplier_id=supplier["id"]).json()
    headers = _login("sumsup")
    data = client.get("/api/portal/summary", headers=headers).json()
    assert data["total_orders"] == 1
    assert data["open_orders"] == 1
    assert data["status_counts"]["approved"] == 1
    assert data["open_value"] > 0
    assert len(data["recent_orders"]) == 1


# ---------------------------------------------------------------- transitions

def test_portal_acknowledge_and_in_transit(auth_headers):
    supplier = _make_supplier(auth_headers, "Transit Supplier")
    order = _approved_order(auth_headers, supplier["id"], "TRANSIT-1")
    _make_supplier_account(auth_headers, "transitsup", supplier_id=supplier["id"]).json()
    headers = _login("transitsup")
    resp = client.patch(f"/api/portal/orders/{order['id']}", json={"status": "acknowledged"}, headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "acknowledged"
    resp = client.patch(f"/api/portal/orders/{order['id']}", json={"status": "in_transit"}, headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "in_transit"


def test_portal_illegal_transitions_rejected(auth_headers):
    supplier = _make_supplier(auth_headers, "Strict Supplier")
    order = _approved_order(auth_headers, supplier["id"], "STRICT-1")
    _make_supplier_account(auth_headers, "strictsup", supplier_id=supplier["id"]).json()
    headers = _login("strictsup")
    # A supplier cannot skip to in_transit, receive, cancel, or revert.
    for st in ("in_transit", "received", "cancelled", "approved", "submitted", "pending"):
        resp = client.patch(f"/api/portal/orders/{order['id']}", json={"status": st}, headers=headers)
        assert resp.status_code == 400, st
    assert "Cannot change order status" in resp.json()["detail"]
    # Re-acknowledging or reverting an acknowledged order is also rejected.
    client.patch(f"/api/portal/orders/{order['id']}", json={"status": "acknowledged"}, headers=headers)
    for st in ("acknowledged", "approved"):
        resp = client.patch(f"/api/portal/orders/{order['id']}", json={"status": st}, headers=headers)
        assert resp.status_code == 400, st


def test_portal_cannot_move_received_order(auth_headers):
    supplier = _make_supplier(auth_headers, "Done Supplier")
    order = _approved_order(auth_headers, supplier["id"], "DONE-1")
    resp = client.put(f"/api/orders/{order['id']}", json={"status": "received"}, headers=auth_headers)
    assert resp.status_code == 200
    _make_supplier_account(auth_headers, "donesup", supplier_id=supplier["id"]).json()
    headers = _login("donesup")
    resp = client.patch(f"/api/portal/orders/{order['id']}", json={"status": "acknowledged"}, headers=headers)
    assert resp.status_code == 400


def test_portal_transition_notifies_admins(auth_headers):
    supplier = _make_supplier(auth_headers, "Notifying Supplier")
    order = _approved_order(auth_headers, supplier["id"], "NOTIFY-1")
    _make_supplier_account(auth_headers, "notifysup", supplier_id=supplier["id"]).json()
    headers = _login("notifysup")
    client.patch(f"/api/portal/orders/{order['id']}", json={"status": "acknowledged"}, headers=headers)
    notifications = client.get("/api/notifications", headers=auth_headers).json()
    assert any(
        "acknowledged" in n["title"].lower() and order["order_number"] in n["title"]
        for n in notifications["items"]
    )


# ---------------------------------------------------------------- order notes

def test_portal_order_notes_save_and_read_back(auth_headers):
    supplier = _make_supplier(auth_headers, "Note Taker Supplier")
    order = _approved_order(auth_headers, supplier["id"], "NOTES-1")
    _make_supplier_account(auth_headers, "notetaker", supplier_id=supplier["id"]).json()
    headers = _login("notetaker")
    resp = client.put(f"/api/portal/orders/{order['id']}/notes", json={
        "delivery_notes": "3 pallets, use dock B",
        "instructions": "Keep upright",
    }, headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["supplier_delivery_notes"] == "3 pallets, use dock B"
    assert resp.json()["supplier_instructions"] == "Keep upright"
    detail = client.get(f"/api/portal/orders/{order['id']}", headers=headers).json()
    assert detail["supplier_delivery_notes"] == "3 pallets, use dock B"
    assert detail["supplier_instructions"] == "Keep upright"
    # The buyer team can see the supplier's notes on the order too.
    internal = client.get(f"/api/orders/{order['id']}", headers=auth_headers).json()
    assert internal["supplier_delivery_notes"] == "3 pallets, use dock B"
    assert internal["supplier_instructions"] == "Keep upright"


def test_portal_order_notes_partial_update(auth_headers):
    supplier = _make_supplier(auth_headers, "Partial Note Supplier")
    order = _approved_order(auth_headers, supplier["id"], "PNOTES-1")
    _make_supplier_account(auth_headers, "partialnote", supplier_id=supplier["id"]).json()
    headers = _login("partialnote")
    resp = client.put(f"/api/portal/orders/{order['id']}/notes", json={
        "instructions": "Call on arrival",
    }, headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["supplier_delivery_notes"] == ""
    assert resp.json()["supplier_instructions"] == "Call on arrival"


def test_portal_order_notes_scoped(auth_headers):
    sup_a = _make_supplier(auth_headers, "Notes Scoped A")
    sup_b = _make_supplier(auth_headers, "Notes Scoped B")
    order_b = _approved_order(auth_headers, sup_b["id"], "NSCOPE-B")
    _make_supplier_account(auth_headers, "nscope_a", supplier_id=sup_a["id"]).json()
    headers = _login("nscope_a")
    resp = client.put(f"/api/portal/orders/{order_b['id']}/notes", json={
        "delivery_notes": "intrusion attempt",
    }, headers=headers)
    assert resp.status_code == 404
    # Supplier B's notes were not touched.
    _make_supplier_account(auth_headers, "nscope_b", supplier_id=sup_b["id"]).json()
    headers_b = _login("nscope_b")
    detail = client.get(f"/api/portal/orders/{order_b['id']}", headers=headers_b).json()
    assert detail["supplier_delivery_notes"] == ""


def test_portal_order_notes_length_limited(auth_headers):
    supplier = _make_supplier(auth_headers, "Long Note Supplier")
    order = _approved_order(auth_headers, supplier["id"], "LONGNOTE-1")
    _make_supplier_account(auth_headers, "longnote", supplier_id=supplier["id"]).json()
    headers = _login("longnote")
    resp = client.put(f"/api/portal/orders/{order['id']}/notes", json={
        "delivery_notes": "x" * 2001,
    }, headers=headers)
    assert resp.status_code == 422
    assert "2000" in resp.json()["detail"][0]["msg"]


def test_portal_order_notes_notify_admins(auth_headers):
    supplier = _make_supplier(auth_headers, "Noting Supplier")
    order = _approved_order(auth_headers, supplier["id"], "NOTIFY-NOTE-1")
    _make_supplier_account(auth_headers, "notifynote", supplier_id=supplier["id"]).json()
    headers = _login("notifynote")
    client.put(f"/api/portal/orders/{order['id']}/notes", json={
        "delivery_notes": "Arriving Thursday",
    }, headers=headers)
    notifications = client.get("/api/notifications", headers=auth_headers).json()
    assert any(
        "notes updated" in n["title"].lower() and order["order_number"] in n["title"]
        for n in notifications["items"]
    )


# ---------------------------------------------------------------- ASN/receipts

def _in_transit_order(auth_headers, supplier_id, sku, quantity=2):
    """Approved order, then supplier pushes it to in_transit (auto-ASN)."""
    order = _approved_order(auth_headers, supplier_id, sku, quantity=quantity)
    _make_supplier_account(auth_headers, f"tsup_{sku.lower()}", supplier_id=supplier_id).json()
    headers = _login(f"tsup_{sku.lower()}")
    resp = client.patch(f"/api/portal/orders/{order['id']}", json={"status": "acknowledged"}, headers=headers)
    assert resp.status_code == 200, resp.text
    resp = client.patch(f"/api/portal/orders/{order['id']}", json={"status": "in_transit"}, headers=headers)
    assert resp.status_code == 200, resp.text
    return order, headers


def test_portal_in_transit_auto_creates_asn(auth_headers):
    supplier = _make_supplier(auth_headers, "Transit ASN Supplier")
    order, headers = _in_transit_order(auth_headers, supplier["id"], "TASN-1")
    data = client.get("/api/portal/asns", headers=headers).json()
    assert data["total"] == 1
    asn = data["items"][0]
    assert asn["status"] == "pending"
    assert asn["order_id"] == order["id"]
    assert asn["order_number"] == order["order_number"]
    assert asn["items"] and asn["items"][0]["product_name"].endswith("TASN-1")
    # Detail endpoint matches.
    detail = client.get(f"/api/portal/asns/{asn['id']}", headers=headers).json()
    assert detail["asn_number"] == asn["asn_number"]
    # Transitioning again does not create a second ASN.
    resp = client.patch(f"/api/portal/orders/{order['id']}", json={"status": "in_transit"}, headers=headers)
    assert resp.status_code == 400
    assert client.get("/api/portal/asns", headers=headers).json()["total"] == 1


def test_portal_asn_status_filter_and_scoping(auth_headers):
    sup_a = _make_supplier(auth_headers, "ASN Scoped A")
    order_a, headers_a = _in_transit_order(auth_headers, sup_a["id"], "ASCOP-A")
    asn_a = client.get("/api/portal/asns", headers=headers_a).json()["items"][0]
    # Invalid status is rejected.
    resp = client.get("/api/portal/asns", params={"status": "draft"}, headers=headers_a)
    assert resp.status_code == 400
    assert "Invalid ASN status" in resp.json()["detail"]
    # Supplier B cannot see supplier A's ASN.
    sup_b = _make_supplier(auth_headers, "ASN Scoped B")
    _make_supplier_account(auth_headers, "ascop_b", supplier_id=sup_b["id"]).json()
    headers_b = _login("ascop_b")
    assert client.get("/api/portal/asns", headers=headers_b).json()["total"] == 0
    for path in (f"/api/portal/asns/{asn_a['id']}", f"/api/portal/asns/{asn_a['id']}/pdf"):
        resp = client.get(path, headers=headers_b)
        assert resp.status_code == 404, path
    assert client.get("/api/portal/asns/999999", headers=headers_a).status_code == 404


def test_portal_asn_pdf(auth_headers):
    supplier = _make_supplier(auth_headers, "ASN Pdf Supplier")
    _, headers = _in_transit_order(auth_headers, supplier["id"], "TAPDF-1")
    asn = client.get("/api/portal/asns", headers=headers).json()["items"][0]
    resp = client.get(f"/api/portal/asns/{asn['id']}/pdf", headers=headers)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.content.startswith(b"%PDF")


def _portal_receipt(auth_headers, supplier_id, product_id, quantity=2, lot=None):
    """Record a warehouse receipt document tied to the supplier."""
    payload = {"items": [{"product_id": product_id, "quantity": quantity}]}
    if lot:
        payload["items"][0]["lot_number"] = lot
    resp = client.post("/api/receipts", json={
        "supplier_id": supplier_id,
        "items": payload["items"],
    }, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_portal_receipt_visible_with_supplier_link(auth_headers):
    supplier = _make_supplier(auth_headers, "Receipt Supplier")
    order, headers = _in_transit_order(auth_headers, supplier["id"], "TRECV-1")
    asn = client.get("/api/portal/asns", headers=headers).json()["items"][0]
    receipt = _portal_receipt(auth_headers, supplier["id"], asn["items"][0]["product_id"])
    # The supplier can see the delivery document tied to them.
    data = client.get("/api/portal/receipts", headers=headers).json()
    assert data["total"] == 1
    assert data["items"][0]["id"] == receipt["id"]
    assert data["items"][0]["supplier_id"] == supplier["id"]
    detail = client.get(f"/api/portal/receipts/{receipt['id']}", headers=headers).json()
    assert detail["receipt_number"] == receipt["receipt_number"]
    # Another supplier is fenced off from it.
    sup_b = _make_supplier(auth_headers, "Receipt Scoped B")
    _make_supplier_account(auth_headers, "trecv_b", supplier_id=sup_b["id"]).json()
    headers_b = _login("trecv_b")
    resp = client.get(f"/api/portal/receipts/{receipt['id']}", headers=headers_b)
    assert resp.status_code == 404
    assert client.get("/api/portal/receipts", headers=headers_b).json()["total"] == 0


def test_portal_receipt_pdf(auth_headers):
    supplier = _make_supplier(auth_headers, "Receipt Pdf Supplier")
    _, headers = _in_transit_order(auth_headers, supplier["id"], "TRPDF-1")
    asn = client.get("/api/portal/asns", headers=headers).json()["items"][0]
    receipt = _portal_receipt(auth_headers, supplier["id"], asn["items"][0]["product_id"])
    resp = client.get(f"/api/portal/receipts/{receipt['id']}/pdf", headers=headers)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.content.startswith(b"%PDF")


def test_portal_summary_includes_asn_and_receipt_counts(auth_headers):
    supplier = _make_supplier(auth_headers, "Full Summary Supplier")
    order, headers = _in_transit_order(auth_headers, supplier["id"], "TSUM-1")
    asn = client.get("/api/portal/asns", headers=headers).json()["items"][0]
    data = client.get("/api/portal/summary", headers=headers).json()
    assert data["total_asns"] == 1
    assert data["asn_counts"]["pending"] == 1
    assert data["receipt_count"] == 0
    assert len(data["recent_asns"]) == 1
    assert data["recent_asns"][0]["order_id"] == order["id"]
    # After staff record the delivery, the summary reflects it.
    _portal_receipt(auth_headers, supplier["id"], asn["items"][0]["product_id"])
    data = client.get("/api/portal/summary", headers=headers).json()
    assert data["asn_counts"]["pending"] == 1
    assert data["total_asns"] == 1
    assert data["receipt_count"] == 1
    assert len(data["recent_receipts"]) == 1


# ---------------------------------------------------------------- misc

def test_portal_order_pdf(auth_headers):
    supplier = _make_supplier(auth_headers, "Pdf Supplier")
    order = _approved_order(auth_headers, supplier["id"], "PPDF-1")
    _make_supplier_account(auth_headers, "pdfsup", supplier_id=supplier["id"]).json()
    headers = _login("pdfsup")
    resp = client.get(f"/api/portal/orders/{order['id']}/pdf", headers=headers)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.content.startswith(b"%PDF")


def test_purge_supplier_blocked_with_linked_accounts(auth_headers):
    supplier = _make_supplier(auth_headers, "Purge Supplier")
    _make_supplier_account(auth_headers, "purgesup", supplier_id=supplier["id"]).json()
    client.delete(f"/api/suppliers/{supplier['id']}", headers=auth_headers)
    resp = client.delete(f"/api/trash/supplier/{supplier['id']}", headers=auth_headers)
    assert resp.status_code == 400
    assert "linked portal accounts" in resp.json()["detail"]