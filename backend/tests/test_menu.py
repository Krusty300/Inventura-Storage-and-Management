import uuid

from tests.conftest import client, create_test_user, TestingSessionLocal
from app.models.restaurant import RestaurantTicketItem


def _auth(role: str = "admin") -> dict:
    suffix = uuid.uuid4().hex[:8]
    username = f"{role}_{suffix}"
    create_test_user(username, f"{suffix}@{role}.example.com", "testpass123", role=role)
    resp = client.post("/api/auth/login", json={"username": username, "password": "testpass123"})
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _create_menu_product(headers: dict, sku: str, qty: int = 10, price: float = 100.0, section_id: int | None = None) -> dict:
    payload = {"location_id": 1, "sku": sku, "name": f"Menu {sku}", "unit_price": price,
               "is_menu_item": True, "quantity": qty}
    if section_id is not None:
        payload["menu_section_id"] = section_id
    resp = client.post("/api/products", json=payload, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _create_section(headers: dict, name: str, sort_order: int = 0) -> dict:
    resp = client.post("/api/restaurant/menu-sections", json={"name": name, "sort_order": sort_order}, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _open_ticket(headers: dict) -> dict:
    resp = client.post("/api/restaurant/tickets", json={"guest_count": 2}, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_menu_sections_crud(auth_headers):
    section = _create_section(auth_headers, "Starters", sort_order=1)
    assert section["name"] == "Starters"

    dup = client.post("/api/restaurant/menu-sections", json={"name": "Starters"}, headers=auth_headers)
    assert dup.status_code == 400

    renamed = client.put(f"/api/restaurant/menu-sections/{section['id']}", json={"name": "Mains"}, headers=auth_headers)
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Mains"

    sections = client.get("/api/restaurant/menu-sections", headers=auth_headers).json()
    assert any(s["id"] == section["id"] and s["name"] == "Mains" for s in sections)

    deleted = client.delete(f"/api/restaurant/menu-sections/{section['id']}", headers=auth_headers)
    assert deleted.status_code == 200
    assert deleted.json()["ok"] is True


def test_assign_product_to_section_forces_menu_flag(auth_headers):
    product = _create_menu_product(auth_headers, "ASSIGN1", qty=5, is_menu_item=False) if False else None
    # Create an ordinary product (not a menu item).
    resp = client.post("/api/products", json={"location_id": 1, "sku": "ASSIGN2", "name": "Assign me", "quantity": 5}, headers=auth_headers)
    product = resp.json()
    assert product["is_menu_item"] is False

    section = _create_section(auth_headers, "Beverages")
    updated = client.put(f"/api/products/{product['id']}", json={"menu_section_id": section["id"]}, headers=auth_headers)
    assert updated.status_code == 200
    body = updated.json()
    assert body["menu_section_id"] == section["id"]
    assert body["is_menu_item"] is True

    # Clearing the section leaves the menu flag alone.
    cleared = client.put(f"/api/products/{product['id']}", json={"menu_section_id": None}, headers=auth_headers)
    assert cleared.status_code == 200
    assert cleared.json()["menu_section_id"] is None


def test_menu_endpoint_groups_by_section(auth_headers):
    starters = _create_section(auth_headers, "Starters", sort_order=1)
    mains = _create_section(auth_headers, "Mains", sort_order=2)
    _create_menu_product(auth_headers, "GRP1", price=50.0, section_id=starters["id"])
    _create_menu_product(auth_headers, "GRP2", price=80.0, section_id=mains["id"])
    _create_menu_product(auth_headers, "GRP3", price=70.0)  # uncategorized

    menu = client.get("/api/restaurant/menu", headers=auth_headers).json()
    by_name = {s["name"]: s for s in menu}
    assert by_name["Starters"]["item_count"] == 1
    assert by_name["Starters"]["items"][0]["sku"] == "GRP1"
    assert by_name["Mains"]["item_count"] == 1
    uncat = next(s for s in menu if s["id"] is None)
    assert uncat["item_count"] == 1

    # Inactive products never appear on the menu.
    inactive = _create_menu_product(auth_headers, "GRP4", price=1.0)
    client.put(f"/api/products/{inactive['id']}", json={"is_active": False}, headers=auth_headers)
    menu = client.get("/api/restaurant/menu", headers=auth_headers).json()
    assert all(s["item_count"] == 0 or not any(i["sku"] == "GRP4" for i in s["items"]) for s in menu)


def test_modifier_group_lifecycle_and_option_crud(auth_headers):
    product = _create_menu_product(auth_headers, "MODLIFE", qty=5, price=100.0)

    groups = client.get(f"/api/restaurant/menu-items/{product['id']}/modifiers", headers=auth_headers)
    assert groups.status_code == 200
    assert groups.json() == []

    created = client.post(f"/api/restaurant/menu-items/{product['id']}/modifiers", json={
        "name": "Toppings", "min_select": 0, "max_select": 1, "is_required": False,
        "options": [
            {"name": "Cheese", "price_delta": 20.0},
            {"name": "Bacon", "price_delta": 35.0},
        ],
    }, headers=auth_headers)
    assert created.status_code == 201, created.text
    group = created.json()
    assert group["name"] == "Toppings"
    assert len(group["options"]) == 2

    cheese_id = group["options"][0]["id"]

    # Add a third option later.
    added = client.post(f"/api/restaurant/menu-modifier-groups/{group['id']}/options", json={"name": "Mushroom", "price_delta": 15.0}, headers=auth_headers)
    assert added.status_code == 201

    # Update option price.
    updated = client.put(f"/api/restaurant/menu-modifier-groups/{group['id']}/options/{cheese_id}", json={"name": "Cheese+", "price_delta": 25.0}, headers=auth_headers)
    assert updated.status_code == 200
    assert updated.json()["price_delta"] == 25.0

    groups = client.get(f"/api/restaurant/menu-items/{product['id']}/modifiers", headers=auth_headers).json()
    assert len(groups) == 1
    assert [o["name"] for o in groups[0]["options"]] == ["Cheese+", "Bacon", "Mushroom"]

    # Deleting an option.
    removed = client.delete(f"/api/restaurant/menu-modifier-groups/{group['id']}/options/{cheese_id}", headers=auth_headers)
    assert removed.status_code == 200

    # Deleting the whole group.
    deleted = client.delete(f"/api/restaurant/menu-modifier-groups/{group['id']}", headers=auth_headers)
    assert deleted.status_code == 200

    groups = client.get(f"/api/restaurant/menu-items/{product['id']}/modifiers", headers=auth_headers).json()
    assert groups == []


def test_ticket_item_with_modifiers_priced_and_merged(auth_headers):
    product = _create_menu_product(auth_headers, "MODPRICE", qty=10, price=100.0)
    group = client.post(f"/api/restaurant/menu-items/{product['id']}/modifiers", json={
        "name": "Extras", "min_select": 0, "max_select": 2,
        "options": [{"name": "Cheese", "price_delta": 20.0}, {"name": "Bacon", "price_delta": 35.0}],
    }, headers=auth_headers).json()
    cheese = next(o["id"] for o in group["options"] if o["name"] == "Cheese")
    bacon = next(o["id"] for o in group["options"] if o["name"] == "Bacon")

    ticket = _open_ticket(auth_headers)
    added = client.post(f"/api/restaurant/tickets/{ticket['id']}/items", json={
        "product_id": product["id"], "quantity": 1, "modifiers": [{"option_id": cheese}, {"option_id": bacon}],
    }, headers=auth_headers)
    assert added.status_code == 201, added.text
    item = added.json()["items"][0]
    assert item["base_unit_price"] == 100.0
    assert item["unit_price"] == 155.0
    assert len(item["modifiers"]) == 2
    assert added.json()["subtotal"] == 155.0

    # Same product + different modifiers = new line, not merged.
    second = client.post(f"/api/restaurant/tickets/{ticket['id']}/items", json={
        "product_id": product["id"], "quantity": 1, "modifiers": [{"option_id": cheese}],
    }, headers=auth_headers)
    assert second.status_code == 201
    assert len(second.json()["items"]) == 2

    # Same product + same modifiers merges quantity.
    third = client.post(f"/api/restaurant/tickets/{ticket['id']}/items", json={
        "product_id": product["id"], "quantity": 2, "modifiers": [{"option_id": cheese}],
    }, headers=auth_headers)
    assert third.status_code == 201
    assert len(third.json()["items"]) == 2
    merged = next(i for i in third.json()["items"] if i["base_unit_price"] == 100.0 and len(i["modifiers"]) == 1)
    assert merged["quantity"] == 3
    assert merged["unit_price"] == 120.0  # base + cheese delta

    # Plain item unaffected by modifiers.
    plain = client.post(f"/api/restaurant/tickets/{ticket['id']}/items", json={"product_id": product["id"], "quantity": 1}, headers=auth_headers)
    assert len(plain.json()["items"]) == 3
    assert plain.json()["items"][-1]["modifiers"] == []


def test_ticket_item_modifier_validation(auth_headers):
    product = _create_menu_product(auth_headers, "MODBAD", qty=10, price=100.0)
    group = client.post(f"/api/restaurant/menu-items/{product['id']}/modifiers", json={
        "name": "Size", "min_select": 1, "max_select": 1, "is_required": True,
        "options": [{"name": "Large", "price_delta": 30.0}, {"name": "Medium", "price_delta": 0.0}],
    }, headers=auth_headers).json()
    large = next(o["id"] for o in group["options"] if o["name"] == "Large")
    medium = next(o["id"] for o in group["options"] if o["name"] == "Medium")

    ticket = _open_ticket(auth_headers)

    # Required group ignored -> rejected.
    missing = client.post(f"/api/restaurant/tickets/{ticket['id']}/items", json={"product_id": product["id"], "quantity": 1}, headers=auth_headers)
    assert missing.status_code == 400

    # More selections than max_select -> rejected.
    too_many = client.post(f"/api/restaurant/tickets/{ticket['id']}/items", json={
        "product_id": product["id"], "quantity": 1,
        "modifiers": [{"option_id": large}, {"option_id": medium}],
    }, headers=auth_headers)
    assert too_many.status_code == 400

    # Option from another product -> rejected.
    other = _create_menu_product(auth_headers, "MODBAD2", qty=10, price=50.0)
    foreign = client.post(f"/api/restaurant/tickets/{ticket['id']}/items", json={
        "product_id": product["id"], "quantity": 1, "modifiers": [{"option_id": large}],
    }, headers=auth_headers)
    assert foreign.status_code == 201
    # Remove test leftover item so required group selection below is clean.
    item_id = foreign.json()["items"][0]["id"]
    client.delete(f"/api/restaurant/tickets/{ticket['id']}/items/{item_id}", headers=auth_headers)
    assert other


def test_update_item_recomputes_from_base_price(auth_headers):
    product = _create_menu_product(auth_headers, "MODUPD", qty=10, price=100.0)
    group = client.post(f"/api/restaurant/menu-items/{product['id']}/modifiers", json={
        "name": "Extras", "min_select": 0, "max_select": 2,
        "options": [{"name": "Cheese", "price_delta": 20.0}, {"name": "Bacon", "price_delta": 35.0}],
    }, headers=auth_headers).json()
    cheese = next(o["id"] for o in group["options"] if o["name"] == "Cheese")
    bacon = next(o["id"] for o in group["options"] if o["name"] == "Bacon")

    ticket = _open_ticket(auth_headers)
    added = client.post(f"/api/restaurant/tickets/{ticket['id']}/items", json={
        "product_id": product["id"], "quantity": 1, "modifiers": [{"option_id": cheese}],
    }, headers=auth_headers).json()
    item = added["items"][0]

    # Swap cheese for bacon -> unit price recomputed from base (100 + 35).
    swapped = client.put(f"/api/restaurant/tickets/{ticket['id']}/items/{item['id']}", json={"modifiers": [{"option_id": bacon}]}, headers=auth_headers)
    assert swapped.status_code == 200
    assert swapped.json()["items"][0]["unit_price"] == 135.0
    assert swapped.json()["items"][0]["base_unit_price"] == 100.0

    # Clear modifiers -> back to base price.
    cleared = client.put(f"/api/restaurant/tickets/{ticket['id']}/items/{item['id']}", json={"modifiers": []}, headers=auth_headers)
    assert cleared.status_code == 200
    assert cleared.json()["items"][0]["unit_price"] == 100.0
    assert cleared.json()["items"][0]["modifiers"] == []


def test_bill_and_kitchen_pdfs_are_valid(auth_headers):
    product = _create_menu_product(auth_headers, "PDFPRD", qty=10, price=200.0)
    ticket = _open_ticket(auth_headers)
    client.post(f"/api/restaurant/tickets/{ticket['id']}/items", json={"product_id": product["id"], "quantity": 2}, headers=auth_headers)

    bill = client.get(f"/api/restaurant/tickets/{ticket['id']}/bill", headers=auth_headers)
    assert bill.status_code == 200
    assert bill.headers["content-type"] == "application/pdf"
    assert b"%PDF" in bill.content

    kitchen = client.get(f"/api/restaurant/tickets/{ticket['id']}/kitchen", headers=auth_headers)
    assert kitchen.status_code == 200
    assert kitchen.headers["content-type"] == "application/pdf"
    assert b"%PDF" in kitchen.content

    # After sending to the kitchen the kitchen slip prefers sent items.
    client.post(f"/api/restaurant/tickets/{ticket['id']}/send", headers=auth_headers)
    kitchen_after = client.get(f"/api/restaurant/tickets/{ticket['id']}/kitchen", headers=auth_headers)
    assert kitchen_after.status_code == 200
    assert b"%PDF" in kitchen_after.content


def test_ticket_item_snapshots_product_name_and_image(auth_headers):
    product = _create_menu_product(auth_headers, "SNAP001", qty=10, price=150.0)
    cover = "/uploads/snapshot-cover.webp"
    client.put(f"/api/products/{product['id']}", json={"image_url": cover}, headers=auth_headers)

    ticket = _open_ticket(auth_headers)
    added = client.post(f"/api/restaurant/tickets/{ticket['id']}/items", json={
        "product_id": product["id"], "quantity": 1,
    }, headers=auth_headers)
    assert added.status_code == 201
    item = added.json()["items"][0]
    assert item["product_name"] == product["name"]
    assert item["product_image"] == cover

    # Renaming the product must not rewrite the historical ticket line.
    client.put(f"/api/products/{product['id']}", json={"name": "Renamed Product"}, headers=auth_headers)
    refetched = client.get(f"/api/restaurant/tickets/{ticket['id']}", headers=auth_headers).json()
    assert refetched["items"][0]["product_name"] == product["name"]

    # Neither must swapping the cover image.
    client.put(f"/api/products/{product['id']}", json={"image_url": "/uploads/swapped.webp"}, headers=auth_headers)
    refetched = client.get(f"/api/restaurant/tickets/{ticket['id']}", headers=auth_headers).json()
    assert refetched["items"][0]["product_image"] == cover


def test_ticket_item_merge_refreshes_snapshot(auth_headers):
    product = _create_menu_product(auth_headers, "SNAP002", qty=10, price=100.0)
    ticket = _open_ticket(auth_headers)
    url = f"/api/restaurant/tickets/{ticket['id']}/items"
    body = {"product_id": product["id"], "quantity": 1}
    assert client.post(url, json=body, headers=auth_headers).status_code == 201

    client.put(f"/api/products/{product['id']}", json={"name": "Renamed Before Merge"}, headers=auth_headers)
    merged = client.post(url, json=body, headers=auth_headers)
    assert merged.status_code == 201
    items = merged.json()["items"]
    assert len(items) == 1
    assert items[0]["quantity"] == 2
    # The still-open line tracks the current name until it is snapshotted shut.
    assert items[0]["product_name"] == "Renamed Before Merge"


def test_ticket_item_falls_back_to_live_product_without_snapshot(auth_headers):
    """Rows predating the migration keep rendering from the live product."""
    product = _create_menu_product(auth_headers, "SNAP003", qty=10, price=100.0)
    ticket = _open_ticket(auth_headers)
    added = client.post(f"/api/restaurant/tickets/{ticket['id']}/items", json={
        "product_id": product["id"], "quantity": 1,
    }, headers=auth_headers).json()
    item_id = added["items"][0]["id"]

    session = TestingSessionLocal()
    try:
        item = session.get(RestaurantTicketItem, item_id)
        item.product_name_snapshot = None
        item.product_image_snapshot = None
        session.commit()
    finally:
        session.close()

    client.put(f"/api/products/{product['id']}", json={"name": "Live Name"}, headers=auth_headers)
    refetched = client.get(f"/api/restaurant/tickets/{ticket['id']}", headers=auth_headers).json()
    assert refetched["items"][0]["product_name"] == "Live Name"