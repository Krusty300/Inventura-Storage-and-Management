from math import ceil
from datetime import datetime, timezone, timedelta
from pathlib import Path
import io
import re

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session, joinedload

from app.constants import MAX_PAGE_SIZE, currency_symbol as symbol_for
from app.database import get_db
from app.models import BOM, BOMItem
from app.models.customer import Customer
from app.models.menu import MenuModifierGroup, MenuModifierOption, MenuSection
from app.models.product import Product
from app.models.restaurant import RestaurantReservation, RestaurantTable, RestaurantTicket, RestaurantTicketItem
from app.models.sale import Sale, SaleItem
from app.models.settings import Settings
from app.models.user import User
from app.schemas.menu import (
    MenuItemOut,
    MenuModifierGroupCreate,
    MenuModifierGroupOut,
    MenuModifierGroupUpdate,
    MenuModifierOptionCreate,
    MenuModifierOptionOut,
    MenuSectionCreate,
    MenuSectionOut,
    MenuSectionUpdate,
    MenuSectionWithItems,
)
from app.schemas.restaurant import (
    GuestOrderCreate,
    GuestOrderOut,
    KitchenTicketOut,
    ReservationCreate,
    ReservationOut,
    ReservationStatusUpdate,
    ReservationUpdate,
    RestaurantTableCreate,
    RestaurantTableOut,
    RestaurantTableUpdate,
    TicketCreate,
    TicketItemCreate,
    TicketItemOut,
    TicketItemStatus,
    TicketItemUpdate,
    TicketItemVoidCreate,
    TicketOut,
    TicketSettle,
    TicketSplitCreate,
    TicketUpdate,
)
from app.services import inventory
from app.services.auth import hash_password, require_permission
from app.services.cache import settings_cache
from app.services.httpratelimit import limiter
from app.services.payment_methods import resolve_payment_details
from app.services.sales_channels import (
    RESTAURANT_DINE_IN_CHANNEL,
    RESTAURANT_GUEST_ORDER_CHANNEL,
    get_or_create_channel,
)
from app.services.pdf_helpers import (
    BODY_RIGHT, FONT, MARGIN, MUTED, draw_banner_header, draw_info_block,
    draw_item_table, draw_notes, draw_page_footer, draw_signoff, draw_totals,
    money, new_canvas, render_pdf, truncate_to_width,
)
from app.services.pricing import resolve_price
from app.services.sequences import next_document_number
from app.utils import get_or_404, log_activity, broadcast_change

router = APIRouter(prefix="/api/restaurant", tags=["restaurant"], dependencies=[Depends(require_permission("restaurant.view"))])

# Public guest-facing endpoints (QR table ordering). Kept on a separate router
# because route-level `dependencies=[]` cannot override router-level auth.
public_router = APIRouter(prefix="/api/restaurant", tags=["restaurant"], dependencies=[])

CLOSED_STATUSES = ("settled", "cancelled")
KITCHEN_ITEM_STATUSES = ("queued", "preparing", "ready", "served")


def _system_user(db: Session) -> User:
    """Return the system user used to attribute guest (QR) orders, creating it on first use."""
    user = db.query(User).filter(User.username == "system").first()
    if user:
        return user
    user = User(
        username="system",
        email="system@local.invalid",
        password_hash=hash_password("system"),
        role="admin",
        is_approved=True,
        is_active=True,
    )
    db.add(user)
    db.flush()
    return user


def _normalize_phone(value: str) -> str:
    """Trim a contact phone into an E.164-ish form (leading 0 -> 254)."""
    phone = re.sub(r"[^\d+]", "", value or "")
    if phone.startswith("0"):
        phone = "254" + phone[1:]
    return phone


def _resolve_customer(db: Session, name: str, phone: str) -> int | None:
    """Find (or create) the Customer for a dine-in contact; returns its id or None.

    Phone is the authoritative key. If no exact normalized match is stored we
    fall back to the trailing digits so legacy 07xx/254xx entries still link.
    A new customer row is only created when both a phone and a name are present
    (the minimum a POS has on screen). Without a phone, name-only matching is an
    exact case-insensitive hit so we never mis-attribute a guest.
    """
    phone = _normalize_phone(phone)
    name = (name or "").strip()
    if phone:
        customer = (
            db.query(Customer)
            .filter(Customer.phone == phone, Customer.is_deleted == False)  # noqa: E712
            .first()
        )
        suffix = phone[-9:]
        if customer is None and suffix:
            customer = (
                db.query(Customer)
                .filter(
                    Customer.phone != "",
                    Customer.phone.like(f"%{suffix}"),
                    Customer.is_deleted == False,  # noqa: E712
                )
                .first()
            )
        if customer is None and name:
            customer = Customer(name=name[:200], phone=phone, email="")
            db.add(customer)
            db.flush()
        return customer.id if customer is not None else None
    if name:
        customer = (
            db.query(Customer)
            .filter(Customer.name.ilike(name), Customer.is_deleted == False)  # noqa: E712
            .first()
        )
        return customer.id if customer is not None else None
    return None


def _selected_modifiers(db: Session, product: Product, modifiers: list[dict]) -> tuple[list[dict], float]:
    """Validate a chosen set of modifier options against the product's active groups.

    Returns the canonical modifier list (group/option ids + names + price deltas)
    and the total price delta for the selection. Raises 400 on any violation.
    """
    groups = db.query(MenuModifierGroup).options(
        joinedload(MenuModifierGroup.options),
    ).filter(
        MenuModifierGroup.product_id == product.id, MenuModifierGroup.is_active == True  # noqa: E712
    ).all()
    groups_by_id = {g.id: g for g in groups}
    selected: dict[int, list[MenuModifierOption]] = {}
    seen: set[int] = set()
    for entry in modifiers:
        option_id = entry.get("option_id")
        if not isinstance(option_id, int) or option_id in seen:
            continue
        seen.add(option_id)
        option = db.get(MenuModifierOption, option_id)
        if option is None or not option.is_active:
            raise HTTPException(status_code=400, detail="Invalid modifier option selected")
        group = groups_by_id.get(option.group_id)
        if group is None:
            raise HTTPException(status_code=400, detail="Modifier option does not belong to this menu item")
        selected.setdefault(group.id, []).append(option)
    result: list[dict] = []
    total_delta = 0.0
    for group in groups:
        opts = selected.get(group.id, [])
        count = len(opts)
        if group.is_required and count == 0:
            raise HTTPException(status_code=400, detail=f"'{group.name}' is required")
        if count > group.max_select:
            raise HTTPException(status_code=400, detail=f"'{group.name}' allows at most {group.max_select} selection(s)")
        if count < group.min_select:
            raise HTTPException(status_code=400, detail=f"'{group.name}' requires at least {group.min_select} selection(s)")
        for opt in opts:
            result.append({
                "group_id": group.id, "group_name": group.name,
                "option_id": opt.id, "name": opt.name, "price": float(opt.price_delta),
            })
            total_delta += float(opt.price_delta)
    return result, round(total_delta, 2)


def _item_modifier_line(item: RestaurantTicketItem) -> str:
    mods: list[dict] = item.modifiers or []
    return ", ".join(str(m.get("name", "")) for m in mods if m.get("name"))


def _menu_item_out(product: Product) -> MenuItemOut:
    image = ""
    if product.images:
        image = product.images[0].url
    elif product.image_url:
        image = product.image_url
    return MenuItemOut(
        id=product.id, name=product.name, display_name=product.display_name,
        description=product.description, sku=product.sku,
        unit_price=float(product.unit_price),
        image_url=product.image_url, image=image,
        section_id=product.menu_section_id,
    )


def _load_modifier_group(db: Session, group_id: int) -> MenuModifierGroup:
    return get_or_404(MenuModifierGroup, group_id, db, options=[joinedload(MenuModifierGroup.options)])


def generate_ticket_number(db: Session) -> str:
    return next_document_number(db, "ticket", "T-")


def get_tax_rate(db: Session) -> float:
    cached = settings_cache.get("tax_rate")
    if cached is not None:
        return cached
    s = db.query(Settings).first()
    rate = float(s.tax_rate) if s else 0.0
    settings_cache["tax_rate"] = rate
    return rate


def get_currency_defaults(db: Session) -> tuple[str, str]:
    cached = settings_cache.get("currency_defaults")
    if cached is not None:
        return cached
    s = db.query(Settings).first()
    if s and s.currency_code:
        result = (s.currency_code, s.currency_symbol or symbol_for(s.currency_code))
    else:
        result = ("USD", "$")
    settings_cache["currency_defaults"] = result
    return result


def load_ticket(db: Session, ticket_id: int) -> RestaurantTicket:
    return get_or_404(RestaurantTicket, ticket_id, db, options=[
        joinedload(RestaurantTicket.items).joinedload(RestaurantTicketItem.product).joinedload(Product.images),
        joinedload(RestaurantTicket.table), joinedload(RestaurantTicket.user), joinedload(RestaurantTicket.sale),
    ])


def _table_occupied(db: Session, table_id: int, exclude_ticket_id: int | None = None) -> bool:
    if table_id is None:
        return False
    q = db.query(RestaurantTicket.id).filter(
        RestaurantTicket.table_id == table_id,
        ~RestaurantTicket.status.in_(CLOSED_STATUSES),
    )
    if exclude_ticket_id is not None:
        q = q.filter(RestaurantTicket.id != exclude_ticket_id)
    return q.first() is not None


def _recompute_totals(db: Session, ticket: RestaurantTicket, discount_amount: float | None = None) -> None:
    subtotal = round(sum(float(i.unit_price) * i.quantity for i in ticket.items if i.status != "voided"), 2)
    discount = float(ticket.discount_amount) if discount_amount is None else float(discount_amount)
    if discount > subtotal:
        raise HTTPException(status_code=400, detail="Discount cannot exceed the ticket subtotal")
    tax_rate = get_tax_rate(db)
    taxable = subtotal - discount
    tax = round(taxable * tax_rate / 100, 2)
    ticket.subtotal = subtotal
    ticket.discount_amount = round(discount, 2)
    ticket.tax_amount = tax
    ticket.total_amount = round(taxable + tax, 2)


def _recompute_ticket_status(ticket: RestaurantTicket) -> None:
    if ticket.status in CLOSED_STATUSES or ticket.status == "paying":
        return
    has_sent = False
    all_served = True
    any_ready = False
    any_preparing = False
    for item in ticket.items:
        if item.status == "voided":
            continue
        if item.status == "pending":
            all_served = False
            continue
        has_sent = True
        if item.status == "ready":
            any_ready = True
        elif item.status == "preparing":
            any_preparing = True
        if item.status != "served":
            all_served = False
    if not has_sent:
        ticket.status = "open"
    elif all_served:
        ticket.status = "served"
    elif any_ready:
        ticket.status = "ready"
    else:
        ticket.status = "preparing"


def _validate_menu_product(db: Session, product_id: int) -> Product:
    product = db.get(Product, product_id)
    if product is None or not product.is_active:
        raise HTTPException(status_code=404, detail=f"Product {product_id} not found")
    if not product.is_variant and db.query(Product.id).filter(
        Product.parent_id == product.id, Product.is_active == True  # noqa: E712
    ).first():
        raise HTTPException(status_code=400, detail=f"'{product.display_name}' has variants - select a specific variant")
    if product.is_serialized:
        raise HTTPException(status_code=400, detail=f"'{product.display_name}' is serialized - not supported on tickets")
    return product


def _active_bom_for(db: Session, product_id: int):
    return db.query(BOM).filter(
        BOM.product_id == product_id, BOM.is_active == True, BOM.is_deleted == False  # noqa: E712
    ).order_by(BOM.id.desc()).first()


def _blowdown_rows(db: Session, item: RestaurantTicketItem) -> list[tuple[int, int]]:
    """Return [(product_id, quantity)] stock to consume for a ticket item.

    When the menu item has an active BOM (recipe), the dish's own quantity is
    ignored on-purpose and the component quantities are consumed instead.
    """
    bom = _active_bom_for(db, item.product_id)
    if bom is None:
        return [(item.product_id, item.quantity)]
    rows = []
    for comp in bom.items:
        component = comp.product
        rows.append((component.id, comp.quantity * item.quantity))
    return rows


def _send_item_stock(db: Session, item: RestaurantTicketItem, user_id: int, location_label: str) -> None:
    """Consume stock for one ticket item, honoring its recipe (BOM) if present."""
    for product_id, need in _blowdown_rows(db, item):
        try:
            allocation = inventory.allocate_lots(db, product_id=product_id, quantity=need)
        except inventory.InventoryError:
            db.rollback()
            product = db.get(Product, product_id)
            raise HTTPException(status_code=400, detail=f"Insufficient stock: {product.display_name if product else f'Product {product_id}'} (need {need})")
        for lot_id, take, location_id, lpn_id in allocation:
            inventory.post_journal_entry(
                db, product_id=product_id, user_id=user_id,
                quantity_change=-take, movement_type=inventory.SALE,
                lot_id=lot_id, from_location_id=location_id, lpn_id=lpn_id,
                reference_type="sale", reference=item.ticket.ticket_number,
                notes=f"{item.ticket.ticket_number} sent to kitchen ({location_label})",
            )


def _send_pending_items(db: Session, ticket: RestaurantTicket, user_id: int) -> None:
    """Send every pending item to the kitchen and decrement stock for it.

    Stock is consumed at send (the kitchen has started prepping) using the same
    SALE journal path as checkout. On any insufficient-stock error nothing is
    committed, so the ticket stays fully editable.
    """
    pending = [i for i in ticket.items if i.status == "pending"]
    if not pending:
        return
    location_label = ticket.table_number
    for item in pending:
        _send_item_stock(db, item, user_id, location_label)
        item.status = "queued"
        item.sent_at = datetime.now(timezone.utc)


def _restore_item_stock(db: Session, ticket: RestaurantTicket, item: RestaurantTicketItem, user_id: int, reason: str) -> None:
    """Reverse the SALE movements belonging to a single voided item.

    Rebuilds the item's blowdown rows and reverses matching outgoing sale
    movements for the ticket so stock returns to the exact lots/locations the
    kitchen consumed (BOM-aware). Voided movements are cut out of the ticket's
    reference (full rows re-referenced, partial rows split) so a later cancel,
    settle, or refund never restores the same stock twice.
    """
    ref = f"{reason} {ticket.ticket_number}"
    rows = _blowdown_rows(db, item) if item.status in KITCHEN_ITEM_STATUSES else [(item.product_id, item.quantity)]
    by_product: dict[int, int] = {}
    for product_id, need in rows:
        by_product[product_id] = by_product.get(product_id, 0) + need
    movements = db.query(inventory.StockMovement).filter(
        inventory.StockMovement.reference_type == "sale",
        inventory.StockMovement.reference == ticket.ticket_number,
        inventory.StockMovement.quantity_change < 0,
    ).order_by(inventory.StockMovement.id).all()
    if not movements:
        # Legacy fallback: no movements recorded (pre-blowdown data). Restore
        # the item's own product quantity so a void never loses stock.
        inventory.post_journal_entry(
            db, product_id=item.product_id, user_id=user_id,
            quantity_change=item.quantity, movement_type=inventory.SALE_RETURN,
            reference_type="sale_return", reference=ref,
            notes=f"Ticket {reason.lower()} - stock restored",
        )
        return
    for m in movements:
        need = by_product.get(m.product_id)
        if need is None or need <= 0:
            continue
        take = min(need, -m.quantity_change)
        if -m.quantity_change == take:
            m.reference = ref
        else:
            # Partial row split: keep the ticket's share, move the voided share
            # to the void reference so neither cancel nor settle double-counts.
            m.quantity_change = m.quantity_change + take
            db.add(inventory.StockMovement(
                product_id=m.product_id, user_id=user_id,
                quantity_change=-take, movement_type=inventory.SALE,
                from_location_id=m.from_location_id, to_location_id=m.to_location_id,
                lot_id=m.lot_id, lpn_id=m.lpn_id, serial_id=m.serial_id,
                reference_type="sale", reference=ref,
                notes=f"Ticket {reason.lower()} - voided portion",
            ))
        inventory.post_journal_entry(
            db, product_id=m.product_id, user_id=user_id,
            quantity_change=take, movement_type=inventory.SALE_RETURN,
            from_location_id=m.from_location_id,
            lot_id=m.lot_id, lpn_id=m.lpn_id,
            reference_type="sale_return", reference=ref,
            notes=f"Ticket {reason.lower()} - stock restored",
        )
        by_product[m.product_id] = need - take
    for product_id, remaining in by_product.items():
        if remaining > 0:
            inventory.post_journal_entry(
                db, product_id=product_id, user_id=user_id,
                quantity_change=remaining, movement_type=inventory.SALE_RETURN,
                reference_type="sale_return", reference=ref,
                notes=f"Ticket {reason.lower()} - stock restored",
            )


def _restore_ticket_stock(db: Session, ticket: RestaurantTicket, user_id: int, reason: str) -> None:
    """Reverse SALE movements posted for a cancelled ticket (sale not yet created).

    Reverses every outgoing sale movement for the ticket (handles recipe/BOM
    blowdowns where components - not the menu product - were consumed).
    """
    ref = f"{reason} {ticket.ticket_number}"
    movements = db.query(inventory.StockMovement).filter(
        inventory.StockMovement.reference_type == "sale",
        inventory.StockMovement.reference == ticket.ticket_number,
        inventory.StockMovement.quantity_change < 0,
    ).order_by(inventory.StockMovement.id).all()
    if not movements and ticket.items:
        # Legacy fallback: no movements recorded (pre-blowdown data). Restore
        # each sent item's own product quantity so a cancel never loses stock.
        for item in ticket.items:
            if item.status == "pending" or item.status == "voided":
                continue
            inventory.post_journal_entry(
                db, product_id=item.product_id, user_id=user_id,
                quantity_change=item.quantity, movement_type=inventory.SALE_RETURN,
                reference_type="sale_return", reference=ref,
                notes=f"Ticket {reason.lower()} - stock restored",
            )
        return
    for m in movements:
        restore = -m.quantity_change
        inventory.post_journal_entry(
            db, product_id=m.product_id, user_id=user_id,
            quantity_change=restore, movement_type=inventory.SALE_RETURN,
            from_location_id=m.from_location_id,
            lot_id=m.lot_id, lpn_id=m.lpn_id,
            reference_type="sale_return", reference=ref,
            notes=f"Ticket {reason.lower()} - stock restored",
        )


def _retag_ticket_movements(db: Session, ticket: RestaurantTicket, invoice_number: str) -> None:
    """Re-point ticket stock movements at the sale invoice so refunds/cancellations
    processed through the sales machinery restore exactly what the ticket consumed."""
    db.query(inventory.StockMovement).filter(
        inventory.StockMovement.reference_type == "sale",
        inventory.StockMovement.reference == ticket.ticket_number,
    ).update({"reference": invoice_number}, synchronize_session=False)


def confirm_ticket_payment(db: Session, sale_id: int) -> None:
    """Mark a ticket settled once its linked sale's mobile money payment completes.

    Called from the STK callback and the mock-confirm endpoint after the sale is
    marked paid, so the kitchen/floor views stop showing the ticket without the
    client round-tripping through a restaurant endpoint.
    """
    ticket = db.query(RestaurantTicket).filter(
        RestaurantTicket.sale_id == sale_id,
        RestaurantTicket.status == "paying",
    ).first()
    if ticket is None:
        return
    ticket.status = "settled"
    ticket.settled_at = datetime.now(timezone.utc)
    completed = _complete_seated_reservations(db, ticket)
    db.commit()
    log_activity(db, 0, "system", "update", "restaurant_ticket", ticket.id,
                 f"Ticket {ticket.ticket_number} settled after mobile money payment")
    broadcast_change("restaurant_ticket", "updated")
    if completed is not None:
        broadcast_change("restaurant_reservation", "updated")


def fail_ticket_payment(db: Session, sale_id: int, reason: str = "payment failure") -> None:
    """Revert a 'paying' ticket to 'open' after its mobile money payment failed.

    The linked sale has already been cancelled and its stock restored by the
    sales machinery, so unsend the ticket's items to keep the ledger coherent
    and let the order be edited or re-settled.
    """
    ticket = db.query(RestaurantTicket).filter(
        RestaurantTicket.sale_id == sale_id,
        RestaurantTicket.status == "paying",
    ).first()
    if ticket is None:
        return
    for item in ticket.items:
        item.status = "pending"
        item.sent_at = None
    ticket.status = "open"
    _recompute_ticket_status(ticket)
    db.commit()
    log_activity(db, 0, "system", "update", "restaurant_ticket", ticket.id,
                 f"Ticket {ticket.ticket_number} released to 'open' after {reason}")
    broadcast_change("restaurant_ticket", "updated")


# ---------------------------------------------------------------------------
# Menu
# ---------------------------------------------------------------------------

@router.post("/menu-sections", response_model=MenuSectionOut, status_code=201)
def create_menu_section(data: MenuSectionCreate, db: Session = Depends(get_db), user=Depends(require_permission("restaurant.create"))):
    name = data.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Section name is required")
    if db.query(MenuSection.id).filter(MenuSection.name == name).first():
        raise HTTPException(status_code=400, detail=f"Menu section '{name}' already exists")
    section = MenuSection(**data.model_dump(exclude=["name"]), name=name)
    db.add(section)
    db.flush()
    log_activity(db, user.id, user.username, "create", "menu_section", section.id, f"Created menu section '{name}'")
    db.commit()
    broadcast_change("restaurant_menu", "created")
    return section


@router.put("/menu-sections/{section_id}", response_model=MenuSectionOut)
def update_menu_section(section_id: int, data: MenuSectionUpdate, db: Session = Depends(get_db), user=Depends(require_permission("restaurant.update"))):
    section = get_or_404(MenuSection, section_id, db)
    updates = data.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    if "name" in updates:
        name = (updates["name"] or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Section name is required")
        dup = db.query(MenuSection.id).filter(MenuSection.name == name, MenuSection.id != section_id).first()
        if dup:
            raise HTTPException(status_code=400, detail=f"Menu section '{name}' already exists")
        updates["name"] = name
    for k, v in updates.items():
        setattr(section, k, v)
    db.commit()
    db.refresh(section)
    log_activity(db, user.id, user.username, "update", "menu_section", section.id,
                 f"Updated menu section '{section.name}'")
    db.commit()
    broadcast_change("restaurant_menu", "updated")
    return section


@router.delete("/menu-sections/{section_id}")
def delete_menu_section(section_id: int, db: Session = Depends(get_db), user=Depends(require_permission("restaurant.delete"))):
    section = get_or_404(MenuSection, section_id, db)
    db.query(Product).filter(Product.menu_section_id == section.id).update({"menu_section_id": None})
    log_activity(db, user.id, user.username, "delete", "menu_section", section.id,
                 f"Deleted menu section '{section.name}'")
    db.delete(section)
    db.commit()
    broadcast_change("restaurant_menu", "deleted")
    broadcast_change("product", "updated")
    return {"ok": True}


@router.get("/menu-sections", response_model=list[MenuSectionOut])
def list_menu_sections(db: Session = Depends(get_db)):
    sections = db.query(MenuSection).options(joinedload(MenuSection.products)).order_by(
        MenuSection.sort_order, MenuSection.name
    ).all()
    return sections


@router.get("/menu", response_model=list[MenuSectionWithItems])
def get_menu(db: Session = Depends(get_db)):
    products = db.query(Product).options(
        joinedload(Product.category), joinedload(Product.images), joinedload(Product.menu_section),
    ).filter(
        Product.is_active == True, Product.is_menu_item == True  # noqa: E712
    ).order_by(Product.name).all()
    sections = db.query(MenuSection).filter(
        MenuSection.is_active == True  # noqa: E712
    ).order_by(MenuSection.sort_order, MenuSection.name).all()
    by_section: dict[int | None, list[MenuItemOut]] = {}
    for p in products:
        sid = p.menu_section_id if p.menu_section and p.menu_section.is_active else None
        by_section.setdefault(sid, []).append(_menu_item_out(p))
    result = []
    for s in sections:
        items = by_section.get(s.id, [])
        result.append(MenuSectionWithItems(id=s.id, name=s.name, description=s.description, item_count=len(items), items=items))
    unassigned = by_section.get(None, [])
    if unassigned:
        result.insert(0, MenuSectionWithItems(id=None, name="Uncategorized", description="Menu items without a section", item_count=len(unassigned), items=unassigned))
    return result


# ---------------------------------------------------------------------------
# Menu modifiers
# ---------------------------------------------------------------------------

@router.get("/menu-items/{product_id}/modifiers", response_model=list[MenuModifierGroupOut])
def list_modifier_groups(product_id: int, db: Session = Depends(get_db)):
    get_or_404(Product, product_id, db)
    return db.query(MenuModifierGroup).options(
        joinedload(MenuModifierGroup.options),
    ).filter(MenuModifierGroup.product_id == product_id).order_by(MenuModifierGroup.sort_order, MenuModifierGroup.id).all()


@router.post("/menu-items/{product_id}/modifiers", response_model=MenuModifierGroupOut, status_code=201)
def create_modifier_group(product_id: int, data: MenuModifierGroupCreate, db: Session = Depends(get_db), user=Depends(require_permission("restaurant.create"))):
    product = get_or_404(Product, product_id, db)
    name = data.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Group name is required")
    if data.max_select < data.min_select:
        raise HTTPException(status_code=400, detail="max_select cannot be less than min_select")
    group = MenuModifierGroup(
        product_id=product.id, name=name, min_select=data.min_select,
        max_select=data.max_select, is_required=data.is_required,
        sort_order=data.sort_order, is_active=data.is_active,
    )
    db.add(group)
    db.flush()
    for opt in data.options:
        opt_name = opt.name.strip()
        if not opt_name:
            raise HTTPException(status_code=400, detail="Modifier option name is required")
        group.options.append(MenuModifierOption(
            name=opt_name, price_delta=opt.price_delta, sort_order=opt.sort_order, is_active=opt.is_active,
        ))
    log_activity(db, user.id, user.username, "create", "menu_modifier_group", group.id,
                 f"Created modifier group '{name}' for '{product.display_name}'")
    db.commit()
    broadcast_change("restaurant_menu", "updated")
    return _load_modifier_group(db, group.id)


@router.put("/menu-modifier-groups/{group_id}", response_model=MenuModifierGroupOut)
def update_modifier_group(group_id: int, data: MenuModifierGroupUpdate, db: Session = Depends(get_db), user=Depends(require_permission("restaurant.update"))):
    group = _load_modifier_group(db, group_id)
    updates = data.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    if "name" in updates:
        name = (updates["name"] or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Group name is required")
        updates["name"] = name
    if "min_select" in updates and "max_select" in updates and updates["max_select"] < updates["min_select"]:
        raise HTTPException(status_code=400, detail="max_select cannot be less than min_select")
    for k, v in updates.items():
        setattr(group, k, v)
    db.commit()
    log_activity(db, user.id, user.username, "update", "menu_modifier_group", group.id,
                 f"Updated modifier group '{group.name}'")
    db.commit()
    broadcast_change("restaurant_menu", "updated")
    return _load_modifier_group(db, group.id)


@router.delete("/menu-modifier-groups/{group_id}")
def delete_modifier_group(group_id: int, db: Session = Depends(get_db), user=Depends(require_permission("restaurant.delete"))):
    group = get_or_404(MenuModifierGroup, group_id, db)
    name = group.name
    log_activity(db, user.id, user.username, "delete", "menu_modifier_group", group_id,
                 f"Deleted modifier group '{name}'")
    db.delete(group)
    db.commit()
    broadcast_change("restaurant_menu", "updated")
    return {"ok": True}


@router.post("/menu-modifier-groups/{group_id}/options", response_model=MenuModifierOptionOut, status_code=201)
def create_modifier_option(group_id: int, data: MenuModifierOptionCreate, db: Session = Depends(get_db), user=Depends(require_permission("restaurant.create"))):
    group = get_or_404(MenuModifierGroup, group_id, db)
    name = data.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Option name is required")
    option = MenuModifierOption(name=name, price_delta=data.price_delta, sort_order=data.sort_order, is_active=data.is_active)
    group.options.append(option)
    db.flush()
    log_activity(db, user.id, user.username, "create", "menu_modifier_option", option.id,
                 f"Added modifier option '{name}' to '{group.name}'")
    db.commit()
    broadcast_change("restaurant_menu", "updated")
    return option


@router.put("/menu-modifier-groups/{group_id}/options/{option_id}", response_model=MenuModifierOptionOut)
def update_modifier_option(group_id: int, option_id: int, data: MenuModifierOptionCreate, db: Session = Depends(get_db), user=Depends(require_permission("restaurant.update"))):
    option = get_or_404(MenuModifierOption, option_id, db, options=[joinedload(MenuModifierOption.group)])
    if option.group_id != group_id:
        raise HTTPException(status_code=400, detail="Option does not belong to this group")
    name = data.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Option name is required")
    option.name = name
    option.price_delta = data.price_delta
    option.sort_order = data.sort_order
    option.is_active = data.is_active
    db.commit()
    log_activity(db, user.id, user.username, "update", "menu_modifier_option", option.id,
                 f"Updated modifier option '{name}'")
    db.commit()
    broadcast_change("restaurant_menu", "updated")
    return option


@router.delete("/menu-modifier-groups/{group_id}/options/{option_id}")
def delete_modifier_option(group_id: int, option_id: int, db: Session = Depends(get_db), user=Depends(require_permission("restaurant.delete"))):
    option = get_or_404(MenuModifierOption, option_id, db, options=[joinedload(MenuModifierOption.group)])
    if option.group_id != group_id:
        raise HTTPException(status_code=400, detail="Option does not belong to this group")
    name = option.name
    log_activity(db, user.id, user.username, "delete", "menu_modifier_option", option_id,
                 f"Deleted modifier option '{name}'")
    db.delete(option)
    db.commit()
    broadcast_change("restaurant_menu", "updated")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Tables
# ---------------------------------------------------------------------------

@router.get("/tables", response_model=list[RestaurantTableOut])
def list_tables(db: Session = Depends(get_db)):
    tables = db.query(RestaurantTable).options(
        joinedload(RestaurantTable.tickets),
    ).all()
    def _natural_key(t: RestaurantTable) -> tuple:
        match = re.match(r"^(\d+)(.*)$", t.number or "")
        if match:
            return (0, int(match.group(1)), match.group(2).lower())
        return (1, 0, (t.number or "").lower())
    tables.sort(key=_natural_key)
    outs = [RestaurantTableOut.model_validate(t) for t in tables]
    for t, out in zip(tables, outs):
        active = t.active_ticket
        if active is not None:
            out.status = "occupied"
            out.active_ticket_id = active.id
            out.active_ticket_number = active.ticket_number
    return outs


@router.post("/tables", response_model=RestaurantTableOut, status_code=201)
def create_table(data: RestaurantTableCreate, db: Session = Depends(get_db), user=Depends(require_permission("restaurant.create"))):
    number = data.number.strip()
    if not number:
        raise HTTPException(status_code=400, detail="Table number is required")
    if db.query(RestaurantTable.id).filter(RestaurantTable.number == number).first():
        raise HTTPException(status_code=400, detail=f"Table '{number}' already exists")
    table = RestaurantTable(**data.model_dump(exclude=["number"]), number=number)
    db.add(table)
    db.commit()
    db.refresh(table)
    log_activity(db, user.id, user.username, "create", "restaurant_table", table.id, f"Created restaurant table '{table.number}'")
    db.commit()
    broadcast_change("restaurant_table", "created")
    return table


@router.put("/tables/{table_id}", response_model=RestaurantTableOut)
def update_table(table_id: int, data: RestaurantTableUpdate, db: Session = Depends(get_db), user=Depends(require_permission("restaurant.update"))):
    table = get_or_404(RestaurantTable, table_id, db, options=[joinedload(RestaurantTable.tickets)])
    updates = data.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    if "number" in updates:
        number = (updates["number"] or "").strip()
        if not number:
            raise HTTPException(status_code=400, detail="Table number is required")
        dup = db.query(RestaurantTable.id).filter(
            RestaurantTable.number == number, RestaurantTable.id != table_id
        ).first()
        if dup:
            raise HTTPException(status_code=400, detail=f"Table '{number}' already exists")
        updates["number"] = number
    for k, v in updates.items():
        setattr(table, k, v)
    db.commit()
    db.refresh(table)
    log_activity(db, user.id, user.username, "update", "restaurant_table", table.id,
                 f"Updated restaurant table '{table.number}'")
    db.commit()
    broadcast_change("restaurant_table", "updated")
    out = RestaurantTableOut.model_validate(table)
    active = table.active_ticket
    if active is not None:
        out.status = "occupied"
        out.active_ticket_id = active.id
        out.active_ticket_number = active.ticket_number
    return out


@router.delete("/tables/{table_id}")
def delete_table(table_id: int, db: Session = Depends(get_db), user=Depends(require_permission("restaurant.delete"))):
    table = get_or_404(RestaurantTable, table_id, db, options=[joinedload(RestaurantTable.tickets)])
    if table.tickets:
        raise HTTPException(status_code=400, detail="Cannot delete a table that has been used - deactivate it instead")
    log_activity(db, user.id, user.username, "delete", "restaurant_table", table.id, f"Deleted restaurant table '{table.number}'")
    db.delete(table)
    db.commit()
    broadcast_change("restaurant_table", "deleted")
    return {"ok": True}


RESERVATION_STATUSES = ("pending", "confirmed", "seated", "completed", "cancelled", "no_show")
RESERVATION_ACTIVE = ("pending", "confirmed", "seated")
RESERVATION_CLOSED = ("completed", "cancelled", "no_show")


def _apply_reservation_status(reservation: RestaurantReservation, target: str) -> None:
    """Apply the permitted reservation state transitions, raising 400 on any violation."""
    if target not in RESERVATION_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid reservation status '{target}'")
    current = reservation.status
    if current in RESERVATION_CLOSED:
        raise HTTPException(status_code=400, detail="Reservation already closed")
    if current == target:
        return
    if current == "seated" and target not in ("seated", "cancelled"):
        raise HTTPException(status_code=400, detail="Seated guests can only be cancelled")
    reservation.status = target


def _require_seated_table_free(db: Session, reservation: RestaurantReservation) -> None:
    """A table can only be seated once - reject seating onto a table with an unrelated open ticket."""
    if reservation.table_id is None:
        return
    if _table_occupied(db, reservation.table_id, exclude_ticket_id=reservation.ticket_id):
        raise HTTPException(status_code=400, detail="Table already has an open ticket")


def _complete_seated_reservations(db: Session, ticket: RestaurantTicket) -> RestaurantReservation | None:
    """Close out the seated reservation once its ticket is settled or cancelled."""
    if not ticket.id:
        return None
    reservation = db.query(RestaurantReservation).filter(
        RestaurantReservation.ticket_id == ticket.id,
        RestaurantReservation.status == "seated",
    ).first()
    if reservation is None:
        return None
    reservation.status = "completed"
    db.add(reservation)
    return reservation


def _reservation_loaded(db: Session, reservation_id: int) -> RestaurantReservation:
    return get_or_404(RestaurantReservation, reservation_id, db, options=[
        joinedload(RestaurantReservation.table), joinedload(RestaurantReservation.user),
    ])


def _reservation_conflict(
    db: Session, table_id: int | None, reserved_at: datetime,
    duration_minutes: int, exclude_id: int | None = None,
) -> RestaurantReservation | None:
    """Return the first reservation overlapping the same table and time window."""
    if table_id is None:
        return None
    start = reserved_at
    end = reserved_at + timedelta(minutes=duration_minutes)
    q = db.query(RestaurantReservation).filter(
        RestaurantReservation.table_id == table_id,
        RestaurantReservation.status.in_(RESERVATION_ACTIVE),
    )
    if exclude_id is not None:
        q = q.filter(RestaurantReservation.id != exclude_id)
    for other in q.all():
        o_start = other.reserved_at
        o_end = other.reserved_at + timedelta(minutes=other.duration_minutes)
        if start < o_end and o_start < end:
            return other
    return None


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


# ---------------------------------------------------------------------------
# Reservations
# ---------------------------------------------------------------------------

@router.get("/reservations")
def list_reservations(
    date: str | None = Query(None, description="YYYY-MM-DD in UTC"),
    status: str | None = Query(None),
    table_id: int | None = Query(None),
    search: str = Query(""),
    upcoming_only: bool = Query(False),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=MAX_PAGE_SIZE),
    db: Session = Depends(get_db),
):
    q = db.query(RestaurantReservation).options(
        joinedload(RestaurantReservation.table), joinedload(RestaurantReservation.user),
    )
    if date:
        try:
            day_start = _as_utc(datetime.strptime(date, "%Y-%m-%d"))
        except ValueError:
            raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
        day_end = day_start + timedelta(days=1)
        q = q.filter(RestaurantReservation.reserved_at >= day_start, RestaurantReservation.reserved_at < day_end)
    if upcoming_only:
        q = q.filter(RestaurantReservation.reserved_at >= datetime.now(timezone.utc))
    if status:
        q = q.filter(RestaurantReservation.status == status)
    if table_id:
        q = q.filter(RestaurantReservation.table_id == table_id)
    if search:
        needle = f"%{search.strip()}%"
        q = q.filter(
            RestaurantReservation.guest_name.ilike(needle)
            | RestaurantReservation.guest_phone.ilike(needle)
            | RestaurantReservation.reservation_number.ilike(needle)
        )
    total = q.count()
    items = q.order_by(RestaurantReservation.reserved_at.desc()).offset(skip).limit(limit).all()
    return {"items": [ReservationOut.model_validate(r) for r in items], "total": total,
            "page": (skip // limit) + 1, "pages": max(ceil(total / limit), 1)}


@router.get("/reservations/sheet")
def reservations_day_sheet(date: str = Query("", description="YYYY-MM-DD in UTC"), db: Session = Depends(get_db)):
    default_currency, default_symbol = get_currency_defaults(db)
    store_name, store_lines, s = _store_header_lines(db)

    q = db.query(RestaurantReservation).options(
        joinedload(RestaurantReservation.table), joinedload(RestaurantReservation.user),
    )
    if date:
        try:
            day_start = _as_utc(datetime.strptime(date, "%Y-%m-%d"))
        except ValueError:
            raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
        day_end = day_start + timedelta(days=1)
        q = q.filter(RestaurantReservation.reserved_at >= day_start, RestaurantReservation.reserved_at < day_end)
    reservations = q.order_by(RestaurantReservation.reserved_at.asc()).all()

    c, buf = new_canvas(f"Reservations {date or 'All'}")
    base_dir = Path(__file__).resolve().parent.parent
    meta = [
        ("Date", day_start.strftime("%b %d, %Y") if date else "All dates / upcoming"),
        ("Bookings", str(len(reservations))),
    ]
    body_y = draw_banner_header(c, "RESERVATIONS SHEET", meta, store_lines,
                                logo_url=(s.logo_url if s else ""), base_dir=base_dir)

    headers = ["Time", "Guest", "Party", "Table", "Phone", "Status"]
    aligns = ["l", "l", "r", "l", "l", "l"]
    col_widths = [70.0, 130.0, 45.0, 55.0, 90.0, 100.0]
    rows = []
    status_labels = {
        "pending": "Pending", "confirmed": "Confirmed", "seated": "Seated",
        "completed": "Completed", "cancelled": "Cancelled", "no_show": "No-show",
    }
    for r in reservations:
        rows.append([
            r.reserved_at.strftime("%H:%M"),
            truncate_to_width(r.guest_name, 126.0),
            str(r.guest_count),
            r.table_number or "\u2014",
            truncate_to_width(r.guest_phone or "\u2014", 86.0),
            status_labels.get(r.status, r.status),
        ])
    y = draw_item_table(
        c, MARGIN, body_y, headers, aligns, col_widths, rows,
        on_page_break=lambda c: draw_banner_header(c, "RESERVATIONS SHEET", meta, store_lines,
                                                   logo_url=(s.logo_url if s else ""), base_dir=base_dir),
    )
    draw_signoff(c, y, "Take a moment to confirm the evening's bookings")
    draw_page_footer(c, 1, tax_id=(s.tax_id if s else ""))
    return Response(render_pdf(c, buf), media_type="application/pdf", headers={
        "Content-Disposition": f"inline; filename=reservations-{date or 'all'}.pdf"
    })


@router.get("/reservations/{reservation_id}", response_model=ReservationOut)
def get_reservation(reservation_id: int, db: Session = Depends(get_db)):
    return _reservation_loaded(db, reservation_id)


@router.post("/reservations", response_model=ReservationOut, status_code=201)
def create_reservation(data: ReservationCreate, db: Session = Depends(get_db), user=Depends(require_permission("restaurant.create"))):
    guest_name = data.guest_name.strip()
    if not guest_name:
        raise HTTPException(status_code=400, detail="Guest name is required")
    reserved_at = _as_utc(data.reserved_at)
    if data.table_id is not None:
        table = get_or_404(RestaurantTable, data.table_id, db)
        if not table.is_active:
            raise HTTPException(status_code=400, detail=f"Table '{table.number}' is inactive")
    conflict = _reservation_conflict(db, data.table_id, reserved_at, data.duration_minutes)
    if conflict is not None:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Table already booked for {conflict.guest_name} "
                f"({conflict.reserved_at.strftime('%H:%M')}–"
                f"{(conflict.reserved_at + timedelta(minutes=conflict.duration_minutes)).strftime('%H:%M')})"
            ),
        )
    reservation = RestaurantReservation(
        reservation_number=next_document_number(db, "reservation", "R-"),
        table_id=data.table_id,
        user_id=user.id,
        guest_name=guest_name,
        guest_phone=data.guest_phone.strip(),
        guest_count=data.guest_count,
        reserved_at=reserved_at,
        duration_minutes=data.duration_minutes,
        notes=data.notes,
    )
    db.add(reservation)
    db.flush()
    log_activity(db, user.id, user.username, "create", "restaurant_reservation", reservation.id,
                 f"Booked {reservation.reservation_number} for {guest_name} ({reservation.guest_count} guests)")
    db.commit()
    reservation = _reservation_loaded(db, reservation.id)
    broadcast_change("restaurant_reservation", "created")
    return reservation


@router.put("/reservations/{reservation_id}", response_model=ReservationOut)
def update_reservation(reservation_id: int, data: ReservationUpdate, db: Session = Depends(get_db), user=Depends(require_permission("restaurant.update"))):
    reservation = _reservation_loaded(db, reservation_id)
    if reservation.status in RESERVATION_CLOSED:
        raise HTTPException(status_code=400, detail="Cannot edit a closed reservation")
    updates = data.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    status = updates.get("status", reservation.status)
    if updates.get("guest_name") is not None:
        guest_name = updates["guest_name"].strip()
        if not guest_name:
            raise HTTPException(status_code=400, detail="Guest name is required")
        updates["guest_name"] = guest_name
    if updates.get("guest_phone") is not None:
        updates["guest_phone"] = updates["guest_phone"].strip()
    reserved_at = _as_utc(updates.get("reserved_at", reservation.reserved_at))
    duration_minutes = updates.get("duration_minutes", reservation.duration_minutes)
    table_id = updates.get("table_id", reservation.table_id)
    if table_id is not None and (table_id != reservation.table_id or status not in RESERVATION_ACTIVE):
        table = get_or_404(RestaurantTable, table_id, db)
        if not table.is_active:
            raise HTTPException(status_code=400, detail=f"Table '{table.number}' is inactive")
    if status in RESERVATION_ACTIVE:
        conflict = _reservation_conflict(db, table_id, reserved_at, duration_minutes, exclude_id=reservation.id)
        if conflict is not None:
            raise HTTPException(status_code=400, detail="Table already has a booking in that time window")
    _apply_reservation_status(reservation, status)
    for k, v in updates.items():
        setattr(reservation, k, v)
    reservation.reserved_at = reserved_at
    if status == "seated":
        _require_seated_table_free(db, reservation)
    db.commit()
    reservation = _reservation_loaded(db, reservation.id)
    log_activity(db, user.id, user.username, "update", "restaurant_reservation", reservation.id,
                 f"Updated {reservation.reservation_number}: {', '.join(f'{k}={v}' for k, v in updates.items())}")
    db.commit()
    broadcast_change("restaurant_reservation", "updated")
    return reservation


@router.post("/reservations/{reservation_id}/status", response_model=ReservationOut)
def update_reservation_status(reservation_id: int, data: ReservationStatusUpdate, db: Session = Depends(get_db), user=Depends(require_permission("restaurant.update"))):
    reservation = _reservation_loaded(db, reservation_id)
    target = data.status
    _apply_reservation_status(reservation, target)
    if target == "seated":
        _require_seated_table_free(db, reservation)
    db.commit()
    reservation = _reservation_loaded(db, reservation.id)
    log_activity(db, user.id, user.username, "update", "restaurant_reservation", reservation.id,
                 f"{reservation.reservation_number} marked {target}")
    db.commit()
    broadcast_change("restaurant_reservation", "updated")
    return reservation


@router.delete("/reservations/{reservation_id}")
def delete_reservation(reservation_id: int, db: Session = Depends(get_db), user=Depends(require_permission("restaurant.delete"))):
    reservation = _reservation_loaded(db, reservation_id)
    if reservation.status == "seated" and reservation.ticket_id is not None:
        raise HTTPException(status_code=400, detail="Cannot delete a seated reservation that has a ticket")
    log_activity(db, user.id, user.username, "delete", "restaurant_reservation", reservation.id,
                 f"Deleted {reservation.reservation_number} for {reservation.guest_name}")
    db.delete(reservation)
    db.commit()
    broadcast_change("restaurant_reservation", "deleted")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Tickets
# ---------------------------------------------------------------------------

@router.get("/tickets")
def list_tickets(
    search: str = Query(""),
    status: str | None = Query(None),
    table_id: int | None = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=MAX_PAGE_SIZE),
    db: Session = Depends(get_db),
):
    q = db.query(RestaurantTicket).options(
        joinedload(RestaurantTicket.table), joinedload(RestaurantTicket.user),
    )
    if search:
        q = q.filter(RestaurantTicket.ticket_number.ilike(f"%{search}%"))
    if status:
        q = q.filter(RestaurantTicket.status == status)
    if table_id:
        q = q.filter(RestaurantTicket.table_id == table_id)
    total = q.count()
    items = q.order_by(RestaurantTicket.id.desc()).offset(skip).limit(limit).all()
    return {"items": [TicketOut.model_validate(t) for t in items], "total": total,
            "page": (skip // limit) + 1, "pages": max(ceil(total / limit), 1)}


@router.get("/tickets/{ticket_id}", response_model=TicketOut)
def get_ticket(ticket_id: int, db: Session = Depends(get_db)):
    return load_ticket(db, ticket_id)


@router.post("/tickets", response_model=TicketOut, status_code=201)
def create_ticket(data: TicketCreate, db: Session = Depends(get_db), user=Depends(require_permission("restaurant.create"))):
    if data.table_id is not None:
        table = get_or_404(RestaurantTable, data.table_id, db)
        if not table.is_active:
            raise HTTPException(status_code=400, detail=f"Table '{table.number}' is inactive")
        if _table_occupied(db, data.table_id):
            raise HTTPException(status_code=400, detail=f"Table '{table.number}' already has an open ticket")
    ticket = RestaurantTicket(
        ticket_number=generate_ticket_number(db),
        table_id=data.table_id,
        user_id=user.id,
        status="open",
        guest_count=data.guest_count,
        customer_name=data.customer_name.strip(),
        customer_phone=(data.customer_phone or "").strip(),
        notes=data.notes,
    )
    db.add(ticket)
    db.flush()
    if data.reservation_id is not None:
        reservation = get_or_404(RestaurantReservation, data.reservation_id, db)
        if reservation.status not in ("pending", "confirmed", "seated"):
            raise HTTPException(status_code=400, detail="Reservation is no longer active")
        if data.table_id is not None and reservation.table_id not in (None, data.table_id):
            raise HTTPException(status_code=400, detail="Reservation is booked for a different table")
        ticket.table_id = reservation.table_id if reservation.table_id is not None else data.table_id
        ticket.guest_count = max(ticket.guest_count, reservation.guest_count)
        if not ticket.customer_name:
            ticket.customer_name = reservation.guest_name
        if not ticket.customer_phone and reservation.guest_phone:
            ticket.customer_phone = reservation.guest_phone
        if not ticket.notes and reservation.notes:
            ticket.notes = reservation.notes
        reservation.status = "seated"
        reservation.ticket_id = ticket.id
        db.add(reservation)
    if ticket.table_id is not None and _table_occupied(db, ticket.table_id, exclude_ticket_id=ticket.id):
        table = get_or_404(RestaurantTable, ticket.table_id, db)
        raise HTTPException(status_code=400, detail=f"Table '{table.number}' already has an open ticket")
    db.commit()
    ticket = load_ticket(db, ticket.id)
    log_activity(db, user.id, user.username, "create", "restaurant_ticket", ticket.id,
                 f"Opened ticket {ticket.ticket_number} ({ticket.table_number}, {ticket.guest_count} guests)")
    db.commit()
    broadcast_change("restaurant_ticket", "created")
    return ticket


@router.put("/tickets/{ticket_id}", response_model=TicketOut)
def update_ticket(ticket_id: int, data: TicketUpdate, db: Session = Depends(get_db), user=Depends(require_permission("restaurant.update"))):
    ticket = load_ticket(db, ticket_id)
    if ticket.status in CLOSED_STATUSES or ticket.status == "paying":
        raise HTTPException(status_code=400, detail=f"Cannot edit a ticket with status '{ticket.status}'")
    updates = data.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    if "table_id" in updates:
        new_table_id = updates["table_id"]
        if new_table_id is not None:
            table = get_or_404(RestaurantTable, new_table_id, db)
            if not table.is_active:
                raise HTTPException(status_code=400, detail=f"Table '{table.number}' is inactive")
            if _table_occupied(db, new_table_id, exclude_ticket_id=ticket.id):
                raise HTTPException(status_code=400, detail=f"Table '{table.number}' already has an open ticket")
    if updates.get("customer_name") is not None:
        updates["customer_name"] = updates["customer_name"].strip()
    if updates.get("customer_phone") is not None:
        updates["customer_phone"] = updates["customer_phone"].strip()
    for k, v in updates.items():
        setattr(ticket, k, v)
    _recompute_totals(db, ticket, discount_amount=data.discount_amount)
    db.commit()
    ticket = load_ticket(db, ticket.id)
    log_activity(db, user.id, user.username, "update", "restaurant_ticket", ticket.id,
                 f"Updated ticket {ticket.ticket_number}: {', '.join(f'{k}={v}' for k, v in updates.items())}")
    db.commit()
    broadcast_change("restaurant_ticket", "updated")
    return ticket


@router.post("/tickets/{ticket_id}/items", response_model=TicketOut, status_code=201)
def add_ticket_item(ticket_id: int, data: TicketItemCreate, db: Session = Depends(get_db), user=Depends(require_permission("restaurant.create"))):
    ticket = load_ticket(db, ticket_id)
    if ticket.status in CLOSED_STATUSES or ticket.status == "paying":
        raise HTTPException(status_code=400, detail=f"Cannot add items to a ticket with status '{ticket.status}'")
    product = _validate_menu_product(db, data.product_id)
    quantity = data.quantity
    mods, delta = _selected_modifiers(db, product, data.modifiers)
    if data.unit_price and data.unit_price > 0:
        base_price = data.unit_price
    else:
        base_price = resolve_price(db, product.id, None, quantity)
    unit_price = round(base_price + delta, 2)
    existing = next((
        i for i in ticket.items
        if i.product_id == product.id and i.status == "pending"
        and i.notes == data.notes and (i.modifiers or []) == mods
    ), None)
    if existing is not None:
        existing.quantity += quantity
        existing.unit_price = unit_price
        existing.base_unit_price = base_price
    else:
        ticket.items.append(RestaurantTicketItem(
            product_id=product.id, quantity=quantity,
            unit_price=unit_price, base_unit_price=base_price,
            modifiers=mods or None, notes=data.notes, status="pending",
        ))
    _recompute_totals(db, ticket)
    _recompute_ticket_status(ticket)
    db.commit()
    ticket = load_ticket(db, ticket.id)
    log_activity(db, user.id, user.username, "update", "restaurant_ticket", ticket.id,
                 f"Added {quantity} x '{product.display_name}' to {ticket.ticket_number}")
    db.commit()
    broadcast_change("restaurant_ticket", "updated")
    return ticket


@router.put("/tickets/{ticket_id}/items/{item_id}", response_model=TicketOut)
def update_ticket_item(ticket_id: int, item_id: int, data: TicketItemUpdate, db: Session = Depends(get_db), user=Depends(require_permission("restaurant.update"))):
    ticket = load_ticket(db, ticket_id)
    if ticket.status in CLOSED_STATUSES or ticket.status == "paying":
        raise HTTPException(status_code=400, detail=f"Cannot edit items on a ticket with status '{ticket.status}'")
    item = next((i for i in ticket.items if i.id == item_id), None)
    if item is None:
        raise HTTPException(status_code=404, detail="Ticket item not found")
    if item.status != "pending":
        raise HTTPException(status_code=400, detail="Only unsent items can be edited - the rest is with the kitchen")
    updates = data.model_dump(exclude_unset=True)
    if "modifiers" in updates:
        if updates["modifiers"] is not None:
            mods, delta = _selected_modifiers(db, item.product, updates["modifiers"])
            updates["modifiers"] = mods or None
            base = float(item.base_unit_price or resolve_price(db, item.product_id, None, item.quantity))
            updates["base_unit_price"] = base
            updates["unit_price"] = round(base + delta, 2)
        else:
            updates["modifiers"] = None
            base = float(item.base_unit_price or item.unit_price)
            updates["base_unit_price"] = base
            updates["unit_price"] = round(base, 2)
    elif "unit_price" in updates:
        updates["base_unit_price"] = updates["unit_price"]
    for k, v in updates.items():
        setattr(item, k, v)
    _recompute_totals(db, ticket)
    _recompute_ticket_status(ticket)
    db.commit()
    ticket = load_ticket(db, ticket.id)
    log_activity(db, user.id, user.username, "update", "restaurant_ticket", ticket.id,
                 f"Updated item {item_id} on {ticket.ticket_number}")
    db.commit()
    broadcast_change("restaurant_ticket", "updated")
    return ticket


@router.delete("/tickets/{ticket_id}/items/{item_id}", response_model=TicketOut)
def remove_ticket_item(ticket_id: int, item_id: int, db: Session = Depends(get_db), user=Depends(require_permission("restaurant.update"))):
    ticket = load_ticket(db, ticket_id)
    if ticket.status in CLOSED_STATUSES or ticket.status == "paying":
        raise HTTPException(status_code=400, detail=f"Cannot edit items on a ticket with status '{ticket.status}'")
    item = next((i for i in ticket.items if i.id == item_id), None)
    if item is None:
        raise HTTPException(status_code=404, detail="Ticket item not found")
    if item.status != "pending":
        raise HTTPException(status_code=400, detail="Only unsent items can be removed - the rest is with the kitchen")
    name = item.product_name
    db.delete(item)
    _recompute_totals(db, ticket)
    _recompute_ticket_status(ticket)
    db.commit()
    ticket = load_ticket(db, ticket.id)
    log_activity(db, user.id, user.username, "update", "restaurant_ticket", ticket.id,
                 f"Removed '{name}' from {ticket.ticket_number}")
    db.commit()
    broadcast_change("restaurant_ticket", "updated")
    return ticket


@router.post("/tickets/{ticket_id}/items/{item_id}/void", response_model=TicketOut)
def void_ticket_item(ticket_id: int, item_id: int, data: TicketItemVoidCreate, db: Session = Depends(get_db), user=Depends(require_permission("restaurant.update"))):
    ticket = load_ticket(db, ticket_id)
    if ticket.status in CLOSED_STATUSES or ticket.status == "paying":
        raise HTTPException(status_code=400, detail=f"Cannot void items on a ticket with status '{ticket.status}'")
    item = next((i for i in ticket.items if i.id == item_id), None)
    if item is None:
        raise HTTPException(status_code=404, detail="Ticket item not found")
    if item.status == "voided":
        raise HTTPException(status_code=400, detail="Item is already voided")
    reason = (data.reason or "").strip()
    was_sent = item.status in KITCHEN_ITEM_STATUSES
    if was_sent:
        _restore_item_stock(db, ticket, item, user.id, reason="Void")
    item.status = "voided"
    item.voided_by = user.id
    item.voided_at = datetime.now(timezone.utc)
    item.void_reason = reason or None
    _recompute_totals(db, ticket)
    _recompute_ticket_status(ticket)
    db.commit()
    ticket = load_ticket(db, ticket.id)
    log_activity(db, user.id, user.username, "update", "restaurant_ticket", ticket.id,
                 f"Voided '{item.product_name}' from {ticket.ticket_number}"
                 + (f" ({item.quantity}) - {reason}" if reason else ""))
    db.commit()
    broadcast_change("restaurant_ticket", "updated")
    if was_sent:
        broadcast_change("product", "updated")
        broadcast_change("stock_movement", "created")
    return ticket


@router.post("/tickets/{ticket_id}/split", response_model=TicketOut, status_code=201)
def split_ticket(ticket_id: int, data: TicketSplitCreate, db: Session = Depends(get_db), user=Depends(require_permission("restaurant.update"))):
    ticket = load_ticket(db, ticket_id)
    if ticket.status in CLOSED_STATUSES or ticket.status == "paying":
        raise HTTPException(status_code=400, detail=f"Cannot split a ticket with status '{ticket.status}'")
    if not data.item_ids:
        raise HTTPException(status_code=400, detail="Select at least one item to move to the new bill")
    allowed = {i.id for i in ticket.items if i.status != "voided"}
    moving = set(data.item_ids)
    unknown = moving - allowed
    if unknown:
        raise HTTPException(status_code=400, detail=f"Item(s) {sorted(unknown)} are not on this ticket")
    if len(moving) >= len(allowed):
        raise HTTPException(status_code=400, detail="Keep at least one item on the original bill")
    if data.table_id is not None and data.table_id != ticket.table_id and _table_occupied(db, data.table_id):
        raise HTTPException(status_code=400, detail="Target table already has an open ticket")

    table_id = data.table_id if data.table_id is not None else ticket.table_id
    guest_count = data.guest_count if data.guest_count is not None else ticket.guest_count
    customer_name = (data.customer_name or "").strip() or ticket.customer_name
    customer_phone = (data.customer_phone or "").strip() or ticket.customer_phone
    parent = ticket.split_parent  # if this ticket is already a split
    root = ticket if ticket.split_parent_id is None else parent
    split_group = root.split_group or f"SPL-{root.id}"
    root.split_group = split_group

    child = RestaurantTicket(
        ticket_number=generate_ticket_number(db),
        table_id=table_id,
        user_id=user.id,
        status="open",
        guest_count=guest_count,
        customer_name=customer_name,
        customer_phone=customer_phone,
        notes=(data.notes or "").strip() or f"Split of {ticket.ticket_number}",
        split_group=split_group,
        split_parent_id=root.id,
    )
    db.add(child)
    db.flush()
    for item in ticket.items:
        if item.id in moving:
            child.items.append(item)
    parent_subtotal = round(sum(float(i.unit_price) * i.quantity for i in ticket.items if i.id not in moving and i.status != "voided"), 2)
    if float(ticket.discount_amount) > parent_subtotal:
        ticket.discount_amount = parent_subtotal
    _recompute_totals(db, ticket)
    _recompute_ticket_status(ticket)
    _recompute_totals(db, child)
    _recompute_ticket_status(child)
    db.commit()
    ticket = load_ticket(db, ticket.id)
    child = load_ticket(db, child.id)
    log_activity(db, user.id, user.username, "update", "restaurant_ticket", ticket.id,
                 f"Split {ticket.ticket_number}: moved {len(moving)} item(s) to {child.ticket_number}")
    log_activity(db, user.id, user.username, "create", "restaurant_ticket", child.id,
                 f"Created {child.ticket_number} as split of {ticket.ticket_number}")
    db.commit()
    broadcast_change("restaurant_ticket", "updated")
    return child


@router.post("/tickets/{ticket_id}/send", response_model=TicketOut)
def send_ticket_to_kitchen(ticket_id: int, db: Session = Depends(get_db), user=Depends(require_permission("restaurant.create"))):
    ticket = load_ticket(db, ticket_id)
    if ticket.status in CLOSED_STATUSES or ticket.status == "paying":
        raise HTTPException(status_code=400, detail=f"Cannot send a ticket with status '{ticket.status}'")
    pending = [i for i in ticket.items if i.status == "pending"]
    if not pending:
        raise HTTPException(status_code=400, detail="No unsent items to send")
    _send_pending_items(db, ticket, user.id)
    _recompute_ticket_status(ticket)
    db.commit()
    ticket = load_ticket(db, ticket.id)
    log_activity(db, user.id, user.username, "update", "restaurant_ticket", ticket.id,
                 f"Sent {len(pending)} item(s) to kitchen for {ticket.ticket_number}")
    db.commit()
    broadcast_change("restaurant_ticket", "updated")
    broadcast_change("stock_movement", "created")
    broadcast_change("product", "updated")
    return ticket


@router.put("/tickets/{ticket_id}/items/{item_id}/status", response_model=TicketOut)
def update_item_status(ticket_id: int, item_id: int, data: TicketItemStatus, db: Session = Depends(get_db), user=Depends(require_permission("restaurant.kitchen"))):
    ticket = load_ticket(db, ticket_id)
    if ticket.status in CLOSED_STATUSES or ticket.status == "paying":
        raise HTTPException(status_code=400, detail=f"Ticket is '{ticket.status}' - cannot update statuses")
    item = next((i for i in ticket.items if i.id == item_id), None)
    if item is None:
        raise HTTPException(status_code=404, detail="Ticket item not found")
    if item.status not in KITCHEN_ITEM_STATUSES:
        raise HTTPException(status_code=400, detail=f"Cannot update status of unsent item")
    transitions = {"queued": {"preparing"}, "preparing": {"ready"}, "ready": {"served"}}
    allowed = transitions.get(item.status, set())
    if data.status not in allowed:
        raise HTTPException(status_code=400, detail=f"Invalid transition '{item.status}' -> '{data.status}'")
    item.status = data.status
    _recompute_ticket_status(ticket)
    db.commit()
    ticket = load_ticket(db, ticket.id)
    log_activity(db, user.id, user.username, "update", "restaurant_ticket", ticket.id,
                 f"'{item.product_name}' on {ticket.ticket_number} -> {data.status}")
    db.commit()
    broadcast_change("restaurant_ticket", "updated")
    return ticket


@router.post("/tickets/{ticket_id}/serve", response_model=TicketOut)
def serve_ticket(ticket_id: int, db: Session = Depends(get_db), user=Depends(require_permission("restaurant.update"))):
    ticket = load_ticket(db, ticket_id)
    if ticket.status in CLOSED_STATUSES or ticket.status == "paying":
        raise HTTPException(status_code=400, detail=f"Cannot serve a ticket with status '{ticket.status}'")
    ready = [i for i in ticket.items if i.status == "ready"]
    if not ready:
        raise HTTPException(status_code=400, detail="No ready items to serve")
    for item in ready:
        item.status = "served"
    _recompute_ticket_status(ticket)
    db.commit()
    ticket = load_ticket(db, ticket.id)
    log_activity(db, user.id, user.username, "update", "restaurant_ticket", ticket.id,
                 f"Served {len(ready)} item(s) on {ticket.ticket_number}")
    db.commit()
    broadcast_change("restaurant_ticket", "updated")
    return ticket


@router.post("/tickets/{ticket_id}/settle", response_model=TicketOut)
def settle_ticket(ticket_id: int, data: TicketSettle, db: Session = Depends(get_db), user=Depends(require_permission("restaurant.settle"))):
    from app.services.payment_methods import validate_payment
    ticket = load_ticket(db, ticket_id)
    if ticket.status in CLOSED_STATUSES:
        raise HTTPException(status_code=400, detail=f"Ticket is already {ticket.status}")
    if ticket.status == "paying":
        raise HTTPException(status_code=400, detail="Ticket is already being paid - waiting for mobile money confirmation")
    if not ticket.items:
        raise HTTPException(status_code=400, detail="Cannot settle an empty ticket")

    # Every remaining unsent item joins the sale (stock consumed at settlement).
    _send_pending_items(db, ticket, user.id)

    billable = [i for i in ticket.items if i.status != "voided"]
    if not billable:
        raise HTTPException(status_code=400, detail="Cannot settle a ticket with only voided items")

    discount = float(ticket.discount_amount) if data.discount_amount is None else float(data.discount_amount)
    _recompute_totals(db, ticket, discount_amount=discount)

    method = data.payment_method
    provider = (data.payment_provider or "").strip() if method == "mobile_money" else None
    try:
        validate_payment(method, provider)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    default_currency, default_symbol = get_currency_defaults(db)
    try:
        payment = resolve_payment_details(
            method, provider, None, None, None,
            default_currency=default_currency, default_symbol=default_symbol,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    is_mobile = method == "mobile_money"
    from app.routers.sales import generate_invoice_number

    # Attribute the sale to a customer + restaurant channel when we can.
    customer_phone = (data.customer_phone or "").strip() or (data.payment_phone or "").strip() or ticket.customer_phone
    if not customer_phone and ticket.id:
        reservation = db.query(RestaurantReservation).filter(
            RestaurantReservation.ticket_id == ticket.id,
            RestaurantReservation.status.in_(("seated", "confirmed", "completed")),
        ).first()
        if reservation is not None and reservation.guest_phone:
            customer_phone = reservation.guest_phone
    customer_name = (ticket.customer_name or "").strip()
    customer_id = None
    if data.customer_id is not None:
        linked = db.get(Customer, data.customer_id)
        if linked is None or linked.is_deleted or not linked.is_active:
            raise HTTPException(status_code=400, detail="Selected customer is unavailable")
        customer_id = linked.id
    else:
        customer_id = _resolve_customer(db, customer_name, customer_phone)
    if customer_phone:
        ticket.customer_phone = customer_phone
    is_guest_order = ticket.user_id == _system_user(db).id
    channel = get_or_create_channel(
        db,
        name=RESTAURANT_GUEST_ORDER_CHANNEL if is_guest_order else RESTAURANT_DINE_IN_CHANNEL,
        type="restaurant",
    )

    sale = Sale(
        invoice_number=generate_invoice_number(db),
        user_id=user.id,
        customer_id=customer_id,
        channel_id=channel.id,
        subtotal=ticket.subtotal,
        discount_amount=ticket.discount_amount,
        tax_amount=ticket.tax_amount,
        total_amount=ticket.total_amount,
        status="pending" if is_mobile else "completed",
        payment_method=method,
        payment_provider=payment["provider"],
        payment_phone=(data.payment_phone or "").strip() or None,
        payment_status="pending" if is_mobile else None,
        currency=payment["currency"],
        currency_symbol=payment["currency_symbol"],
        notes=(data.notes or "").strip() or f"Restaurant {ticket.ticket_number} - table {ticket.table_number}",
    )
    db.add(sale)
    db.flush()
    completed = None
    for item in ticket.items:
        if item.status == "voided":
            continue
        db.add(SaleItem(sale_id=sale.id, product_id=item.product_id, quantity=item.quantity, unit_price=item.unit_price))
    _retag_ticket_movements(db, ticket, sale.invoice_number)
    ticket.sale_id = sale.id
    ticket.tip_amount = round(float(data.tip_amount or 0.0), 2)
    if is_mobile:
        ticket.status = "paying"
    else:
        ticket.status = "settled"
        ticket.settled_at = datetime.now(timezone.utc)
        completed = _complete_seated_reservations(db, ticket)
    db.commit()
    ticket = load_ticket(db, ticket.id)
    log_activity(db, user.id, user.username, "update", "restaurant_ticket", ticket.id,
                 f"Settled {ticket.ticket_number} via {method}{f' ({provider})' if provider else ''} -> {sale.invoice_number}")
    db.commit()
    broadcast_change("restaurant_ticket", "updated")
    broadcast_change("sale", "created")
    if completed is not None:
        broadcast_change("restaurant_reservation", "updated")
    if is_mobile:
        from app.services.notify import notify_admins
        notify_admins(db, f"Ticket {ticket.ticket_number} awaiting payment",
                      f"{payment['currency_symbol']}{ticket.total_amount:.2f} via {provider}", type="info",
                      link=f"/sales/{sale.id}", exclude_user_id=user.id)
        db.commit()
    return ticket


@router.post("/tickets/{ticket_id}/cancel", response_model=TicketOut)
def cancel_ticket(ticket_id: int, db: Session = Depends(get_db), user=Depends(require_permission("restaurant.cancel"))):
    ticket = load_ticket(db, ticket_id)
    if ticket.status == "settled":
        raise HTTPException(status_code=400, detail="Ticket is already settled - process a refund on the linked sale instead")
    if ticket.status == "cancelled":
        raise HTTPException(status_code=400, detail="Ticket is already cancelled")
    sale = ticket.sale
    if sale is not None:
        if sale.status == "completed":
            raise HTTPException(status_code=400, detail="Ticket already paid - refund sale on the Sales page instead")
        if sale.status != "cancelled":
            from app.routers.sales import _restore_stock_for_sale
            _restore_stock_for_sale(db, sale, reason="Ticket cancellation")
            sale.status = "cancelled"
            sale.payment_status = "cancelled"
    else:
        _restore_ticket_stock(db, ticket, user.id, reason="Cancellation")
    ticket.status = "cancelled"
    completed = _complete_seated_reservations(db, ticket)
    db.commit()
    ticket = load_ticket(db, ticket.id)
    log_activity(db, user.id, user.username, "update", "restaurant_ticket", ticket.id,
                 f"Cancelled ticket {ticket.ticket_number}" + (" - linked sale cancelled" if sale is not None and sale.status == "cancelled" else " - stock restored"))
    db.commit()
    broadcast_change("restaurant_ticket", "updated")
    broadcast_change("stock_movement", "created")
    broadcast_change("product", "updated")
    if completed is not None:
        broadcast_change("restaurant_reservation", "updated")
    return ticket


# ---------------------------------------------------------------------------
# Printing
# ---------------------------------------------------------------------------

def _store_header_lines(db: Session) -> tuple[str, list[str], "Settings | None"]:
    s = db.query(Settings).first()
    store_name = (s.store_name if s else None) or "My Store"
    store_lines = [store_name] + [ln for ln in (
        (s.address if s else None),
        (s.phone if s else None),
        (s.email if s else None),
    ) if ln]
    return store_name, store_lines, s


@router.get("/tickets/{ticket_id}/bill")
def ticket_bill_pdf(ticket_id: int, db: Session = Depends(get_db)):
    ticket = load_ticket(db, ticket_id)
    default_currency, default_symbol = get_currency_defaults(db)
    store_name, store_lines, s = _store_header_lines(db)
    currency = (s.currency_symbol if s and s.currency_symbol else default_symbol) or default_symbol

    c, buf = new_canvas(f"Bill {ticket.ticket_number}")
    base_dir = Path(__file__).resolve().parent.parent
    meta = [
        ("Ticket", ticket.ticket_number),
        ("Date", ticket.opened_at.strftime("%b %d, %Y %H:%M")),
        ("Server", ticket.username or "\u2014"),
    ]
    body_y = draw_banner_header(c, "RESTAURANT BILL", meta, store_lines,
                                logo_url=(s.logo_url if s else ""), base_dir=base_dir)

    info_lines = [ticket.table_number]
    if ticket.customer_name:
        info_lines.append(ticket.customer_name)
    info_y = draw_info_block(c, MARGIN, body_y, "Table", info_lines)
    guests_y = draw_info_block(c, BODY_RIGHT - 240, body_y, "Guests", [str(ticket.guest_count)])
    y = min(info_y, guests_y)

    headers = ["Item", "Qty", "Price", "Amount"]
    aligns = ["l", "r", "r", "r"]
    col_widths = [190.0, 40.0, 80.0, 90.0]
    rows = []
    for item in ticket.items:
        if item.status == "voided":
            continue
        name = item.product_name
        detail = _item_modifier_line(item)
        if detail:
            name = f"{name} / {detail}"
        rows.append([
            truncate_to_width(name, 186.0),
            str(item.quantity),
            money(currency, item.unit_price),
            money(currency, item.line_total),
        ])

    y = draw_item_table(
        c, MARGIN, y, headers, aligns, col_widths, rows,
        on_page_break=lambda c: draw_banner_header(c, "RESTAURANT BILL", meta, store_lines,
                                                   logo_url=(s.logo_url if s else ""), base_dir=base_dir),
    )

    tax_rate = get_tax_rate(db)
    totals = [("Subtotal", money(currency, ticket.subtotal))]
    if ticket.discount_amount:
        totals.append(("Discount", money(currency, -float(ticket.discount_amount))))
    totals.append((f"Tax ({tax_rate}%)", money(currency, ticket.tax_amount)))
    if float(ticket.tip_amount or 0.0):
        totals.append(("Tip", money(currency, float(ticket.tip_amount))))
    payable = float(ticket.total_amount) + float(ticket.tip_amount or 0.0)
    y = draw_totals(c, BODY_RIGHT, y, totals, "Total", money(currency, payable))

    status_notes = {
        "open": "Open ticket \u2014 not yet settled",
        "paying": "Awaiting mobile money payment",
        "settled": "Paid",
        "cancelled": "Cancelled",
    }
    note = status_notes.get(ticket.status, ticket.status.title())
    if ticket.status == "settled" and ticket.settled_at:
        note += f" on {ticket.settled_at.strftime('%b %d, %Y %H:%M')}"
    c.setFont(FONT, 9)
    c.setFillColor(MUTED)
    c.drawString(MARGIN, y, note)
    y -= 14
    draw_signoff(c, y, "Thank you for dining with us!")
    draw_page_footer(c, 1, tax_id=(s.tax_id if s else ""))
    return Response(render_pdf(c, buf), media_type="application/pdf", headers={
        "Content-Disposition": f"inline; filename=bill-{ticket.ticket_number}.pdf"
    })


@router.get("/tickets/{ticket_id}/kitchen")
def kitchen_ticket_pdf(ticket_id: int, item_ids: str = Query("", description="Comma-separated item ids to reprint only"), db: Session = Depends(get_db)):
    ticket = load_ticket(db, ticket_id)
    store_name, store_lines, s = _store_header_lines(db)

    c, buf = new_canvas(f"Kitchen {ticket.ticket_number}")
    base_dir = Path(__file__).resolve().parent.parent
    meta = [
        ("Table", ticket.table_number),
        ("Guests", str(ticket.guest_count)),
        ("Server", ticket.username or "\u2014"),
    ]
    body_y = draw_banner_header(c, "KITCHEN TICKET", meta, store_lines,
                                logo_url=(s.logo_url if s else ""), base_dir=base_dir)

    candidates = [i for i in ticket.items if i.status in KITCHEN_ITEM_STATUSES] or \
        [i for i in ticket.items if i.status == "pending"]
    if item_ids:
        wanted = {int(x) for x in item_ids.split(",") if x.strip().isdigit()}
        candidates = [i for i in candidates if i.id in wanted]
    items = candidates

    headers = ["Qty", "Item", "Notes"]
    aligns = ["r", "l", "l"]
    col_widths = [36.0, 240.0, 124.0]
    rows = []
    for item in items:
        notes = item.notes
        detail = _item_modifier_line(item)
        if notes and detail:
            notes = f"{notes}; {detail}"
        elif detail:
            notes = detail
        rows.append([
            str(item.quantity),
            truncate_to_width(item.product_name, 236.0),
            truncate_to_width(notes or "\u2014", 120.0),
        ])

    y = draw_item_table(
        c, MARGIN, body_y, headers, aligns, col_widths, rows,
        on_page_break=lambda c: draw_banner_header(c, "KITCHEN TICKET", meta, store_lines,
                                                   logo_url=(s.logo_url if s else ""), base_dir=base_dir),
    )
    if ticket.notes:
        draw_notes(c, MARGIN, y, ticket.notes)
        y -= 18
    draw_signoff(c, y, "Fire the order")
    draw_page_footer(c, 1, tax_id=(s.tax_id if s else ""))
    return Response(render_pdf(c, buf), media_type="application/pdf", headers={
        "Content-Disposition": f"inline; filename=kitchen-{ticket.ticket_number}.pdf"
    })


@router.get("/kitchen/board", response_model=list[KitchenTicketOut])
def kitchen_board(db: Session = Depends(get_db)):
    tickets = db.query(RestaurantTicket).options(
        joinedload(RestaurantTicket.items).joinedload(RestaurantTicketItem.product),
        joinedload(RestaurantTicket.table),
    ).filter(RestaurantTicket.status.in_(("preparing", "ready"))).order_by(RestaurantTicket.id.asc()).all()
    outs: list[KitchenTicketOut] = []
    for t in tickets:
        sent = [i for i in t.items if i.status in KITCHEN_ITEM_STATUSES]
        if not sent:
            continue
        stage = "queued"
        for i in sent:
            if i.status == "ready":
                stage = "ready"
                break
            if i.status == "preparing":
                stage = "preparing"
        earliest = min((i.sent_at for i in sent if i.sent_at is not None), default=None)
        out = KitchenTicketOut(
            id=t.id, ticket_number=t.ticket_number, table_number=t.table_number,
            guest_count=t.guest_count, status=t.status, notes=t.notes,
            earliest_sent_at=earliest, items=[TicketItemOut.model_validate(i) for i in t.items if i.status != "voided"],
        )
        out.stage = stage
        outs.append(out)
    return outs


# ---------------------------------------------------------------------------
# QR ordering (public guest flow)
# ---------------------------------------------------------------------------

def _guest_ticket_base(db: Session, table_id: int | None) -> RestaurantTicket | None:
    """Return the live (usable) ticket for a table, or None.

    With split bills a table may hold several open tickets; the root ticket
    (split_parent_id IS NULL) remains the canonical bill for guest (QR)
    ordering so new orders keep landing on the master bill, not a slice.
    """
    if table_id is None:
        return None
    root = db.query(RestaurantTicket).filter(
        RestaurantTicket.table_id == table_id,
        RestaurantTicket.split_parent_id.is_(None),
        ~RestaurantTicket.status.in_(CLOSED_STATUSES),
        RestaurantTicket.status != "paying",
    ).order_by(RestaurantTicket.id.desc()).first()
    if root is not None:
        return root
    return db.query(RestaurantTicket).filter(
        RestaurantTicket.table_id == table_id,
        ~RestaurantTicket.status.in_(CLOSED_STATUSES),
        RestaurantTicket.status != "paying",
    ).order_by(RestaurantTicket.id.desc()).first()


def _guest_out(ticket: RestaurantTicket) -> GuestOrderOut:
    return GuestOrderOut(
        id=ticket.id, ticket_number=ticket.ticket_number,
        table_id=ticket.table_id, table_number=ticket.table_number,
        status=ticket.status, guest_count=ticket.guest_count,
        guest_name=ticket.customer_name, guest_phone=ticket.customer_phone,
        subtotal=float(ticket.subtotal),
        total_amount=float(ticket.total_amount), opened_at=ticket.opened_at,
        items=[TicketItemOut.model_validate(i) for i in ticket.items if i.status in KITCHEN_ITEM_STATUSES],
    )


@public_router.get("/public/menu", response_model=list[MenuSectionWithItems])
def public_menu(db: Session = Depends(get_db)):
    return get_menu(db)


@public_router.get("/public/menu-items/{product_id}/modifiers", response_model=list[MenuModifierGroupOut])
def public_menu_item_modifiers(product_id: int, db: Session = Depends(get_db)):
    product = get_or_404(Product, product_id, db)
    if not product.is_menu_item or not product.is_active:
        raise HTTPException(status_code=404, detail=f"Menu item '{product.display_name}' is not available")
    return db.query(MenuModifierGroup).options(
        joinedload(MenuModifierGroup.options),
    ).filter(
        MenuModifierGroup.product_id == product_id, MenuModifierGroup.is_active == True  # noqa: E712
    ).order_by(MenuModifierGroup.sort_order, MenuModifierGroup.id).all()


@public_router.get("/public/tables/{table_id}", response_model=RestaurantTableOut)
def public_table(table_id: int, db: Session = Depends(get_db)):
    table = get_or_404(RestaurantTable, table_id, db)
    if not table.is_active:
        raise HTTPException(status_code=404, detail=f"Table '{table.number}' is inactive")
    out = RestaurantTableOut.model_validate(table)
    active = table.active_ticket
    if active is not None:
        out.status = "occupied"
        out.active_ticket_id = active.id
        out.active_ticket_number = active.ticket_number
    return out


@public_router.post("/public/orders", response_model=GuestOrderOut, status_code=201)
@limiter.limit("30/minute")
def guest_create_order(request: Request, data: GuestOrderCreate, db: Session = Depends(get_db)):
    system = _system_user(db)

    if data.table_id is None:
        raise HTTPException(status_code=400, detail="A table is required to place a guest order")
    table = get_or_404(RestaurantTable, data.table_id, db)
    if not table.is_active:
        raise HTTPException(status_code=400, detail=f"Table '{table.number}' is inactive")

    # Modifier validation happens once per product before any ticket is touched.
    for item in data.items:
        product = _validate_menu_product(db, item.product_id)
        _selected_modifiers(db, product, item.modifiers)

    ticket = _guest_ticket_base(db, table.id)
    if ticket is None:
        ticket = RestaurantTicket(
            ticket_number=generate_ticket_number(db),
            table_id=table.id, user_id=system.id, status="open",
            guest_count=data.guest_count, customer_name=data.guest_name.strip(),
            customer_phone=(data.guest_phone or "").strip(),
            notes=data.notes,
        )
        db.add(ticket)
        db.flush()
    elif (ticket.customer_name or "").strip() == "" and data.guest_name.strip():
        ticket.customer_name = data.guest_name.strip()
    if (data.guest_phone or "").strip():
        ticket.customer_phone = (data.guest_phone or "").strip()

    for item in data.items:
        product = _validate_menu_product(db, item.product_id)
        mods, delta = _selected_modifiers(db, product, item.modifiers)
        base_price = resolve_price(db, product.id, None, item.quantity)
        unit_price = round(base_price + delta, 2)
        existing = next((
            i for i in ticket.items
            if i.product_id == product.id and i.status == "pending"
            and i.notes == item.notes and (i.modifiers or []) == mods
        ), None)
        if existing is not None:
            existing.quantity += item.quantity
            existing.unit_price = unit_price
            existing.base_unit_price = base_price
        else:
            ticket.items.append(RestaurantTicketItem(
                product_id=product.id, quantity=item.quantity,
                unit_price=unit_price, base_unit_price=base_price,
                modifiers=mods or None, notes=item.notes, status="pending",
            ))
    db.flush()

    _recompute_totals(db, ticket)
    _send_items_for_guest = [i for i in ticket.items if i.status == "pending"]
    _send_pending_items(db, ticket, system.id)
    _recompute_ticket_status(ticket)
    db.commit()

    ticket = load_ticket(db, ticket.id)
    log_activity(db, system.id, "system", "create", "restaurant_ticket", ticket.id,
                 f"Guest order {ticket.ticket_number} placed at table {ticket.table_number} ({len(_send_items_for_guest)} item(s))")
    db.commit()
    broadcast_change("restaurant_ticket", "updated")
    broadcast_change("stock_movement", "created")
    broadcast_change("product", "updated")
    return _guest_out(ticket)


@public_router.get("/public/orders/{ticket_id}", response_model=GuestOrderOut)
def guest_order_status(ticket_id: int, db: Session = Depends(get_db)):
    ticket = load_ticket(db, ticket_id)
    return _guest_out(ticket)


# ---------------------------------------------------------------------------
# Recipes (menu-item BOMs)
# ---------------------------------------------------------------------------

@router.get("/recipes")
def list_menu_recipes(db: Session = Depends(get_db)):
    """Recipe summary for every active menu item (matching staff menu view).

    recipe_cost is the per-unit ingredient cost from the item's active BOM, or
    0 when no recipe is attached. Margin % is vs the menu sale price.
    """
    products = db.query(Product).filter(
        Product.is_active == True, Product.is_menu_item == True  # noqa: E712
    ).order_by(Product.name).all()
    boms = db.query(BOM).options(
        joinedload(BOM.items).joinedload(BOMItem.product),
    ).filter(BOM.is_active == True, BOM.is_deleted == False).all()  # noqa: E712
    by_product: dict[int, BOM] = {}
    for b in boms:
        by_product.setdefault(b.product_id, b)

    results = []
    for p in products:
        bom = by_product.get(p.id)
        unit_cost = 0.0
        components = []
        if bom is not None and not bom.items:
            bom = None
        if bom is not None:
            unit_cost = bom.total_cost
            components = [{
                "id": i.id, "product_id": i.product_id,
                "product_name": i.product_name, "quantity": i.quantity,
            } for i in bom.items]
        price = float(p.unit_price or 0.0)
        margin = price - unit_cost
        margin_pct = round(margin / unit_cost * 100, 1) if unit_cost > 0 else 0.0
        results.append({
            "product_id": p.id,
            "name": p.display_name,
            "sku": p.sku,
            "price": price,
            "has_recipe": bom is not None,
            "recipe_id": bom.id if bom else None,
            "recipe_name": bom.name if bom else "",
            "recipe_cost": round(unit_cost, 2),
            "margin": round(margin, 2),
            "margin_pct": margin_pct,
            "component_count": len(components),
            "components": components,
        })
    return results


# ---------------------------------------------------------------------------
# QR sheet (staff print)
# ---------------------------------------------------------------------------

@router.get("/qr-sheet")
def qr_sheet(base: str = Query("", description="Public base URL for guest ordering (e.g. https://menu.example.com)"), db: Session = Depends(get_db)):
    """Render a print-ready sheet of QR codes, one per active table."""
    tables = db.query(RestaurantTable).order_by(RestaurantTable.number).all()
    active_tables = [t for t in tables if t.is_active]
    if not active_tables:
        raise HTTPException(status_code=400, detail="No active tables to print QR codes for")

    store_name, store_lines, settings = _store_header_lines(db)
    base_url = (base or "").rstrip("/")

    from reportlab.lib.units import inch
    from reportlab.graphics import renderPDF
    import qrcode as qr_pkg
    import qrcode.image.svg
    from svglib.svglib import svg2rlg

    c, buf = new_canvas("QR Codes")
    base_dir = Path(__file__).resolve().parent.parent
    body_y = draw_banner_header(c, "TABLE QR CODES", [
        ("Venue", store_name), ("Tables", str(len(active_tables))),
    ], store_lines, logo_url=(settings.logo_url if settings else ""), base_dir=base_dir)

    from app.services.pdf_helpers import BODY_LEFT, BODY_CENTER, BODY_RIGHT, BOLD, FAINT, FONT, INK, MUTED

    cell_w = 1.9 * inch
    cell_h = 2.1 * inch
    gap = 0.35 * inch
    left = BODY_LEFT + 0.1 * inch
    page_h = 11 * inch
    bottom = 0.9 * inch
    grid_w = BODY_RIGHT - left
    cols = max(int(grid_w // (cell_w + gap)), 1)
    usable_rows = int((body_y - bottom) // (cell_h + gap))
    if usable_rows < 1:
        raise HTTPException(status_code=500, detail="Page too small to render QR codes")

    def _draw_qr(url: str, x: float, y: float, size: float) -> None:
        try:
            img = qr_pkg.make(url, image_factory=qrcode.image.svg.SvgPathImage)
            drawing = svg2rlg(io.BytesIO(img.to_string().encode("utf-8")))
            scale = min(size / drawing.width, size / drawing.height) * 0.92
            drawing.scale(scale, scale)
            c.saveState()
            c.translate(x, y)
            renderPDF.draw(drawing, c, 0, 0)
            c.restoreState()
        except Exception:
            c.setFont(FONT, 7)
            c.setFillColor(MUTED)
            c.drawString(x, y + size / 4, "QR unavailable")

    for idx, t in enumerate(active_tables):
        row = idx // cols
        col = idx % cols
        cell_page = row // usable_rows
        cell_row = row % usable_rows
        x = left + col * (cell_w + gap)
        y_top = body_y - cell_row * (cell_h + gap)
        if cell_page == 0:
            y = y_top
        else:
            c.showPage()
            body_y = draw_banner_header(c, "TABLE QR CODES", [
                ("Venue", store_name), ("Tables", str(len(active_tables))),
            ], store_lines, logo_url=(settings.logo_url if settings else ""), base_dir=base_dir)
            y = body_y - cell_row * (cell_h + gap)

        if not base_url:
            url = f"/order/table/{t.id}"
        else:
            url = f"{base_url}/order/table/{t.id}"

        # Card outline.
        c.setStrokeColor(FAINT)
        c.setLineWidth(1)
        c.roundRect(x, y - cell_h, cell_w - 0.1 * inch, cell_h - 0.15 * inch, 6, stroke=1, fill=0)

        c.setFont(BOLD, 11)
        c.setFillColor(INK)
        c.drawString(x + 0.12 * inch, y - 0.32 * inch, f"Table {t.number}")

        qr_size = 1.25 * inch
        qx = x + (cell_w - 0.1 * inch - qr_size) / 2
        _draw_qr(url, qx, y - 0.5 * inch - qr_size, qr_size)

        c.setFont(FONT, 7)
        c.setFillColor(MUTED)
        c.drawCentredString(x + (cell_w - 0.1 * inch) / 2, y - cell_h + 0.16 * inch, f"/order/table/{t.id}")

    pdf = render_pdf(c, buf)
    return Response(pdf, media_type="application/pdf", headers={
        "Content-Disposition": "inline; filename=table-qr-codes.pdf"
    })