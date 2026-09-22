from math import ceil
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from app.constants import MAX_PAGE_SIZE, currency_symbol as symbol_for
from app.database import get_db
from app.models.product import Product
from app.models.restaurant import RestaurantTable, RestaurantTicket, RestaurantTicketItem
from app.models.sale import Sale, SaleItem
from app.models.settings import Settings
from app.schemas.restaurant import (
    KitchenTicketOut,
    RestaurantTableCreate,
    RestaurantTableOut,
    RestaurantTableUpdate,
    TicketCreate,
    TicketItemCreate,
    TicketItemOut,
    TicketItemStatus,
    TicketItemUpdate,
    TicketOut,
    TicketSettle,
    TicketUpdate,
)
from app.services import inventory
from app.services.auth import require_permission
from app.services.cache import settings_cache
from app.services.payment_methods import resolve_payment_details
from app.services.pricing import resolve_price
from app.services.sequences import next_document_number
from app.utils import get_or_404, log_activity, broadcast_change

router = APIRouter(prefix="/api/restaurant", tags=["restaurant"], dependencies=[Depends(require_permission("restaurant.view"))])

CLOSED_STATUSES = ("settled", "cancelled")
KITCHEN_ITEM_STATUSES = ("queued", "preparing", "ready", "served")
KITCHEN_STAGES = ("queued", "preparing", "ready")


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
    subtotal = round(sum(float(i.unit_price) * i.quantity for i in ticket.items), 2)
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


def _send_pending_items(db: Session, ticket: RestaurantTicket, user_id: int) -> None:
    """Send every pending item to the kitchen and decrement stock for it.

    Stock is consumed at send (the kitchen has started prepping) using the same
    SALE journal path as checkout. On any insufficient-stock error nothing is
    committed, so the ticket stays fully editable.
    """
    pending = [i for i in ticket.items if i.status == "pending"]
    if not pending:
        return
    for item in pending:
        try:
            allocation = inventory.allocate_lots(db, product_id=item.product_id, quantity=item.quantity)
        except inventory.InventoryError:
            db.rollback()
            raise HTTPException(status_code=400, detail=f"Insufficient stock: {item.product_name} (need {item.quantity})")
        for lot_id, take, location_id, lpn_id in allocation:
            inventory.post_journal_entry(
                db, product_id=item.product_id, user_id=user_id,
                quantity_change=-take, movement_type=inventory.SALE,
                lot_id=lot_id, from_location_id=location_id, lpn_id=lpn_id,
                reference_type="sale", reference=ticket.ticket_number,
                notes=f"{ticket.ticket_number} sent to kitchen ({ticket.table_number})",
            )
        item.status = "queued"
        item.sent_at = datetime.now(timezone.utc)


def _restore_ticket_stock(db: Session, ticket: RestaurantTicket, user_id: int, reason: str) -> None:
    """Reverse SALE movements posted for a cancelled ticket (sale not yet created)."""
    ref = f"{reason} {ticket.ticket_number}"
    for item in ticket.items:
        if item.status == "pending":
            continue
        movements = db.query(inventory.StockMovement).filter(
            inventory.StockMovement.reference_type == "sale",
            inventory.StockMovement.reference == ticket.ticket_number,
            inventory.StockMovement.product_id == item.product_id,
            inventory.StockMovement.quantity_change < 0,
        ).order_by(inventory.StockMovement.id).all()
        restored = 0
        for m in movements:
            if restored >= item.quantity:
                break
            take = min(-m.quantity_change, item.quantity - restored)
            inventory.post_journal_entry(
                db, product_id=item.product_id, user_id=user_id,
                quantity_change=take, movement_type=inventory.SALE_RETURN,
                from_location_id=m.from_location_id,
                lot_id=m.lot_id, lpn_id=m.lpn_id,
                reference_type="sale_return", reference=ref,
                notes=f"Ticket {reason.lower()} - stock restored",
            )
            restored += take
        if restored < item.quantity:
            inventory.post_journal_entry(
                db, product_id=item.product_id, user_id=user_id,
                quantity_change=item.quantity - restored, movement_type=inventory.SALE_RETURN,
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
    db.commit()
    log_activity(db, 0, "system", "update", "restaurant_ticket", ticket.id,
                 f"Ticket {ticket.ticket_number} settled after mobile money payment")
    broadcast_change("restaurant_ticket", "updated")


# ---------------------------------------------------------------------------
# Tables
# ---------------------------------------------------------------------------

@router.get("/tables", response_model=list[RestaurantTableOut])
def list_tables(db: Session = Depends(get_db)):
    tables = db.query(RestaurantTable).options(
        joinedload(RestaurantTable.tickets),
    ).order_by(RestaurantTable.number).all()
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
        notes=data.notes,
    )
    db.add(ticket)
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
    if data.unit_price and data.unit_price > 0:
        unit_price = data.unit_price
    else:
        unit_price = resolve_price(db, product.id, None, quantity)
    existing = next((i for i in ticket.items if i.product_id == product.id and i.status == "pending" and i.notes == data.notes), None)
    if existing is not None:
        existing.quantity += quantity
        existing.unit_price = unit_price
    else:
        ticket.items.append(RestaurantTicketItem(
            product_id=product.id, quantity=quantity,
            unit_price=unit_price, notes=data.notes, status="pending",
        ))
    _recompute_totals(db, ticket)
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
    for k, v in updates.items():
        setattr(item, k, v)
    _recompute_totals(db, ticket)
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
    db.commit()
    ticket = load_ticket(db, ticket.id)
    log_activity(db, user.id, user.username, "update", "restaurant_ticket", ticket.id,
                 f"Removed '{name}' from {ticket.ticket_number}")
    db.commit()
    broadcast_change("restaurant_ticket", "updated")
    return ticket


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

    discount = float(ticket.discount_amount) if data.discount_amount is None else float(data.discount_amount)
    _recompute_totals(db, ticket, discount_amount=discount)

    method = data.payment_method
    provider = (data.payment_provider or "").strip() if method == "mobile_money" else None
    try:
        validate_payment(method, provider)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    default_currency, default_symbol = get_currency_defaults(db)
    payment = resolve_payment_details(
        method, provider, None, None, None,
        default_currency=default_currency, default_symbol=default_symbol,
    )

    is_mobile = method == "mobile_money"
    from app.routers.sales import generate_invoice_number
    sale = Sale(
        invoice_number=generate_invoice_number(db),
        user_id=user.id,
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
    for item in ticket.items:
        db.add(SaleItem(sale_id=sale.id, product_id=item.product_id, quantity=item.quantity, unit_price=item.unit_price))
    _retag_ticket_movements(db, ticket, sale.invoice_number)
    ticket.sale_id = sale.id
    if is_mobile:
        ticket.status = "paying"
    else:
        ticket.status = "settled"
        ticket.settled_at = datetime.now(timezone.utc)
    db.commit()
    ticket = load_ticket(db, ticket.id)
    log_activity(db, user.id, user.username, "update", "restaurant_ticket", ticket.id,
                 f"Settled {ticket.ticket_number} via {method}{f' ({provider})' if provider else ''} -> {sale.invoice_number}")
    db.commit()
    broadcast_change("restaurant_ticket", "updated")
    broadcast_change("sale", "created")
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
    db.commit()
    ticket = load_ticket(db, ticket.id)
    log_activity(db, user.id, user.username, "update", "restaurant_ticket", ticket.id,
                 f"Cancelled ticket {ticket.ticket_number}" + (" - linked sale cancelled" if sale is not None and sale.status == "cancelled" else " - stock restored"))
    db.commit()
    broadcast_change("restaurant_ticket", "updated")
    broadcast_change("stock_movement", "created")
    broadcast_change("product", "updated")
    return ticket


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
            guest_count=t.guest_count, status=t.status,
            earliest_sent_at=earliest, items=[TicketItemOut.model_validate(i) for i in t.items],
        )
        out.stage = stage
        outs.append(out)
    return outs