from datetime import datetime, timezone
from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models import Customer, Location, Product, QualityCheck, Sale, SaleItem, Shipment, ShipmentItem
from app.models.stock_movement import StockMovement
from app.models.settings import Settings
from app.schemas.sale import SaleOut
from app.schemas.shipment import ShipmentCreate, ShipmentOut, ShipmentUpdate
from app.services import inventory
from app.services.auth import get_current_user, require_permission
from app.routers.sales import generate_invoice_number, get_tax_rate
from app.services.sequences import next_document_number
from app.utils import get_or_404, log_activity, broadcast_change

router = APIRouter(prefix="/api/shipments", tags=["shipments"], dependencies=[Depends(get_current_user)])

PICKABLE_STATUSES = ("draft", "picking")
PACKABLE_STATUSES = ("picking",)
SHIPPABLE_STATUSES = ("picking", "packed")


def _load_shipment(db: Session, shipment_id: int) -> Shipment:
    return get_or_404(Shipment, shipment_id, db, options=[
        joinedload(Shipment.customer), joinedload(Shipment.creator), joinedload(Shipment.staging_location),
        joinedload(Shipment.sale), joinedload(Shipment.items).joinedload(ShipmentItem.product),
    ])


def _validate_sale(db: Session, sale_id: int, exclude_shipment_id: int | None = None) -> None:
    get_or_404(Sale, sale_id, db)
    q = db.query(Shipment).filter(Shipment.sale_id == sale_id)
    if exclude_shipment_id is not None:
        q = q.filter(Shipment.id != exclude_shipment_id)
    linked = q.first()
    if linked is not None:
        raise HTTPException(
            status_code=400,
            detail=f"Invoice is already linked to shipment '{linked.shipment_number}'",
        )


def _staging_location(db: Session) -> Location:
    loc = db.query(Location).filter(Location.location_type == "shipping").first()
    if loc is None:
        loc = Location(name="Shipping", code="SHIP", location_type="shipping")
        db.add(loc)
        db.flush()
    return loc


def _validate_items(db: Session, items) -> dict[int, int]:
    qty_by_product: dict[int, int] = {}
    for item in items:
        product = get_or_404(Product, item.product_id, db)
        if not product.is_active:
            raise HTTPException(status_code=400, detail=f"'{product.display_name}' is inactive")
        if not product.is_variant and db.query(Product).filter(
            Product.parent_id == product.id, Product.is_active == True  # noqa: E712
        ).first():
            raise HTTPException(status_code=400, detail=f"'{product.display_name}' has variants - ship a specific variant")
        qty_by_product[item.product_id] = qty_by_product.get(item.product_id, 0) + item.quantity
    for pid, qty in qty_by_product.items():
        on_hand = inventory.on_hand(db, product_id=pid, sellable_only=True)
        if on_hand < qty:
            product = get_or_404(Product, pid, db)
            raise HTTPException(status_code=400, detail=f"Insufficient stock for '{product.display_name}': have {on_hand}, need {qty}")
    return qty_by_product


def _ensure_products_active(shipment: Shipment, action: str) -> None:
    """Reject picking/shipping when an item's product has been deactivated
    after the shipment was created."""
    inactive = sorted({
        item.product.display_name
        for item in shipment.items
        if item.product and not item.product.is_active
    })
    if inactive:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot {action} shipment - product(s) inactive: {', '.join(inactive)}",
        )


def _qc_blocker(db: Session, shipment: Shipment) -> QualityCheck | None:
    """Return the quality check that should block this shipment from being
    picked or shipped, if any. A FAILED check always blocks; a PENDING check
    blocks only when the 'require QC before shipping' setting is enabled."""
    product_ids = [item.product_id for item in shipment.items if item.product_id]
    if not product_ids:
        return None
    qc = (
        db.query(QualityCheck)
        .options(joinedload(QualityCheck.product))
        .filter(
            QualityCheck.product_id.in_(product_ids),
            QualityCheck.result.in_(("pending", "fail")),
        )
        .order_by(QualityCheck.created_at.desc())
        .first()
    )
    if qc is None:
        return None
    s = db.query(Settings).first()
    if qc.result == "fail" or (s and s.require_qc_before_ship):
        return qc
    return None


@router.get("")
def list_shipments(
    status: str | None = None,
    search: str = Query(""),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    db: Session = Depends(get_db),
):
    q = db.query(Shipment).options(
        joinedload(Shipment.customer), joinedload(Shipment.items), joinedload(Shipment.sale)
    )
    if status:
        q = q.filter(Shipment.status == status)
    if search:
        q = q.filter(Shipment.shipment_number.ilike(f"%{search}%"))
    total = q.count()
    items = q.order_by(Shipment.created_at.desc()).offset(skip).limit(limit).all()
    return {"items": [ShipmentOut.model_validate(s) for s in items], "total": total,
            "page": (skip // limit) + 1, "pages": max(ceil(total / limit), 1)}


@router.get("/stats")
def shipment_stats(db: Session = Depends(get_db)):
    statuses = ["draft", "picking", "packed", "shipped", "cancelled"]
    counts = {
        s: db.query(Shipment).filter(Shipment.status == s).count() for s in statuses
    }
    return {
        "counts": counts,
        "open": counts["draft"] + counts["picking"] + counts["packed"],
    }


@router.get("/{shipment_id}", response_model=ShipmentOut)
def get_shipment(shipment_id: int, db: Session = Depends(get_db)):
    return _load_shipment(db, shipment_id)


@router.post("", response_model=ShipmentOut, status_code=201)
def create_shipment(data: ShipmentCreate, db: Session = Depends(get_db), user=Depends(require_permission("shipments.create"))):
    if data.customer_id is not None:
        get_or_404(Customer, data.customer_id, db)
    if data.sale_id is not None:
        _validate_sale(db, data.sale_id)
    qty_by_product = _validate_items(db, data.items)
    shipment = Shipment(
        shipment_number=next_document_number(db, "shipment", "SHP-"),
        customer_id=data.customer_id,
        sale_id=data.sale_id,
        carrier=data.carrier,
        tracking_number=data.tracking_number,
        notes=data.notes,
        created_by=user.id,
    )
    db.add(shipment)
    db.flush()
    for product_id, qty in qty_by_product.items():
        db.add(ShipmentItem(shipment_id=shipment.id, product_id=product_id, quantity_ordered=qty))
    db.commit()
    shipment = _load_shipment(db, shipment.id)
    log_activity(db, user.id, user.username, "create", "shipment", shipment.id,
                 f"Created shipment '{shipment.shipment_number}' ({shipment.total_quantity} units)")
    db.commit()
    broadcast_change("shipment", "created")
    return shipment


@router.put("/{shipment_id}", response_model=ShipmentOut)
def update_shipment(shipment_id: int, data: ShipmentUpdate, db: Session = Depends(get_db), user=Depends(require_permission("shipments.update"))):
    shipment = _load_shipment(db, shipment_id)
    if shipment.status == "shipped":
        raise HTTPException(status_code=400, detail="Shipped shipments cannot be edited")
    updates = data.model_dump(exclude_unset=True)
    if "sale_id" in updates and updates["sale_id"] is not None:
        _validate_sale(db, updates["sale_id"], exclude_shipment_id=shipment_id)
    for k, v in updates.items():
        setattr(shipment, k, v)
    db.commit()
    shipment = _load_shipment(db, shipment.id)
    log_activity(db, user.id, user.username, "update", "shipment", shipment.id, f"Updated shipment '{shipment.shipment_number}'")
    db.commit()
    broadcast_change("shipment", "updated")
    return shipment


@router.post("/{shipment_id}/pick", response_model=ShipmentOut)
def pick_shipment(shipment_id: int, db: Session = Depends(get_db), user=Depends(require_permission("shipments.pick"))):
    shipment = _load_shipment(db, shipment_id)
    if shipment.status not in PICKABLE_STATUSES:
        raise HTTPException(status_code=400, detail=f"Only {'/'.join(PICKABLE_STATUSES)} shipments can be picked")
    _ensure_products_active(shipment, "pick")
    qc = _qc_blocker(db, shipment)
    if qc:
        raise HTTPException(
            status_code=400,
            detail=f"Quality check '{qc.qc_number}' is {qc.result} for '{qc.product_name}'. Resolve QC before picking.",
        )
    staging = _staging_location(db)
    try:
        for item in shipment.items:
            remaining = item.quantity_ordered - item.quantity_picked
            if remaining <= 0:
                continue
            product = item.product
            if product and product.is_serialized:
                serials = inventory.allocate_serials(db, product_id=item.product_id, quantity=remaining)
                for serial in serials:
                    source = serial.location_id
                    inventory.transfer_stock(
                        db, product_id=item.product_id, user_id=user.id, quantity=1,
                        from_location_id=source, to_location_id=staging.id,
                        lot_id=serial.lot_id, serial_id=serial.id,
                        transfer_id=shipment.id, reference_type="shipment", reference=shipment.shipment_number,
                        notes=f"Picked to {shipment.shipment_number}",
                    )
            else:
                allocation = inventory.allocate_lots(db, product_id=item.product_id, quantity=remaining)
                for lot_id, take, source_location, lpn_id in allocation:
                    inventory.transfer_stock(
                        db, product_id=item.product_id, user_id=user.id, quantity=take,
                        from_location_id=source_location, to_location_id=staging.id,
                        lot_id=lot_id, lpn_id=lpn_id,
                        transfer_id=shipment.id, reference_type="shipment", reference=shipment.shipment_number,
                        notes=f"Picked to {shipment.shipment_number}",
                    )
            item.quantity_picked = item.quantity_ordered
    except inventory.InventoryError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    shipment.staging_location_id = staging.id
    shipment.status = "picking"
    db.commit()
    shipment = _load_shipment(db, shipment.id)
    log_activity(db, user.id, user.username, "pick", "shipment", shipment.id,
                 f"Picked {shipment.total_quantity} units for '{shipment.shipment_number}'")
    db.commit()
    broadcast_change("shipment", "updated")
    broadcast_change("stock_movement", "created")
    return shipment


@router.post("/{shipment_id}/pack", response_model=ShipmentOut)
def pack_shipment(shipment_id: int, db: Session = Depends(get_db), user=Depends(require_permission("shipments.pick"))):
    shipment = _load_shipment(db, shipment_id)
    if shipment.status not in PACKABLE_STATUSES:
        raise HTTPException(status_code=400, detail="Only picking shipments can be packed")
    for item in shipment.items:
        item.quantity_packed = item.quantity_picked
    shipment.status = "packed"
    db.commit()
    shipment = _load_shipment(db, shipment.id)
    log_activity(db, user.id, user.username, "pack", "shipment", shipment.id, f"Packed shipment '{shipment.shipment_number}'")
    db.commit()
    broadcast_change("shipment", "updated")
    return shipment


@router.post("/{shipment_id}/ship", response_model=ShipmentOut)
def ship_shipment(
    shipment_id: int,
    carrier: str = Query(""),
    tracking_number: str = Query(""),
    db: Session = Depends(get_db),
    user=Depends(require_permission("shipments.ship")),
):
    shipment = _load_shipment(db, shipment_id)
    if shipment.status not in SHIPPABLE_STATUSES:
        raise HTTPException(status_code=400, detail=f"Only {'/'.join(SHIPPABLE_STATUSES)} shipments can be shipped")
    _ensure_products_active(shipment, "ship")
    qc = _qc_blocker(db, shipment)
    if qc:
        raise HTTPException(
            status_code=400,
            detail=f"Quality check '{qc.qc_number}' is {qc.result} for '{qc.product_name}'. Resolve QC before shipping.",
        )
    staging = shipment.staging_location_id
    if staging is None:
        raise HTTPException(status_code=400, detail="Nothing has been picked for this shipment")
    try:
        for item in shipment.items:
            to_ship = item.quantity_picked - item.quantity_shipped
            if to_ship <= 0:
                continue
            product = item.product
            if product and product.is_serialized:
                serials = inventory.allocate_serials(db, product_id=item.product_id, quantity=to_ship, location_id=staging)
                for serial in serials:
                    inventory.post_journal_entry(
                        db, product_id=item.product_id, user_id=user.id,
                        quantity_change=-1, movement_type=inventory.SHIP,
                        from_location_id=staging, lot_id=serial.lot_id, serial_id=serial.id,
                        reference_type="shipment", reference=shipment.shipment_number,
                        notes=f"Shipped on {shipment.shipment_number}",
                    )
            else:
                allocation = inventory.allocate_lots(db, product_id=item.product_id, quantity=to_ship, location_id=staging)
                for lot_id, take, source_location, lpn_id in allocation:
                    inventory.post_journal_entry(
                        db, product_id=item.product_id, user_id=user.id,
                        quantity_change=-take, movement_type=inventory.SHIP,
                        from_location_id=source_location, lot_id=lot_id, lpn_id=lpn_id,
                        reference_type="shipment", reference=shipment.shipment_number,
                        notes=f"Shipped on {shipment.shipment_number}",
                    )
            item.quantity_shipped = item.quantity_picked
    except inventory.InventoryError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    if carrier:
        shipment.carrier = carrier
    if tracking_number:
        shipment.tracking_number = tracking_number
    shipment.status = "shipped"
    shipment.ship_date = datetime.now(timezone.utc)
    shipment.shipped_at = datetime.now(timezone.utc)
    db.commit()
    shipment = _load_shipment(db, shipment.id)
    log_activity(db, user.id, user.username, "ship", "shipment", shipment.id,
                 f"Shipped '{shipment.shipment_number}' via {shipment.carrier or 'carrier'} ({shipment.tracking_number or 'no tracking'})")
    db.commit()
    broadcast_change("shipment", "updated")
    broadcast_change("stock_movement", "created")
    broadcast_change("product", "updated")
    return shipment


@router.post("/{shipment_id}/create-sale", response_model=SaleOut, status_code=201)
def create_sale_from_shipment(shipment_id: int, db: Session = Depends(get_db), user=Depends(require_permission("sales.create"))):
    shipment = _load_shipment(db, shipment_id)
    if shipment.status != "shipped":
        raise HTTPException(status_code=400, detail="Only shipped shipments can generate an invoice")
    if shipment.sale_id is not None:
        raise HTTPException(status_code=400, detail=f"Shipment already linked to invoice '{shipment.invoice_number}'")
    sale_items = []
    subtotal = 0.0
    for item in shipment.items:
        qty = item.quantity_shipped
        if qty <= 0:
            continue
        unit_price = float(item.product.unit_price or 0.0)
        subtotal += qty * unit_price
        sale_items.append({"product_id": item.product_id, "quantity": qty, "unit_price": unit_price})
    if not sale_items:
        raise HTTPException(status_code=400, detail="Shipment has no shipped quantities to invoice")
    tax_rate = get_tax_rate(db)
    tax_amount = subtotal * tax_rate / 100
    sale = Sale(
        invoice_number=generate_invoice_number(db),
        customer_id=shipment.customer_id,
        user_id=user.id,
        subtotal=round(subtotal, 2),
        tax_amount=round(tax_amount, 2),
        total_amount=round(subtotal + tax_amount, 2),
        status="completed",
        payment_method="cash",
        notes=f"Invoice created from shipment {shipment.shipment_number}",
    )
    db.add(sale)
    db.flush()
    for si in sale_items:
        db.add(SaleItem(sale_id=sale.id, product_id=si["product_id"], quantity=si["quantity"], unit_price=si["unit_price"]))
    shipment.sale_id = sale.id
    db.commit()
    sale = get_or_404(Sale, sale.id, db, options=[
        joinedload(Sale.items).joinedload(SaleItem.product),
        joinedload(Sale.customer), joinedload(Sale.user),
    ])
    log_activity(db, user.id, user.username, "create", "sale", sale.id,
                 f"Created invoice '{sale.invoice_number}' from shipment '{shipment.shipment_number}'")
    db.commit()
    broadcast_change("sale", "created")
    broadcast_change("shipment", "updated")
    return sale


@router.post("/{shipment_id}/cancel", response_model=ShipmentOut)
def cancel_shipment(shipment_id: int, db: Session = Depends(get_db), user=Depends(require_permission("shipments.cancel"))):
    shipment = _load_shipment(db, shipment_id)
    if shipment.status not in PICKABLE_STATUSES:
        raise HTTPException(status_code=400, detail="Only draft or picking shipments can be cancelled")
    try:
        legs = db.query(StockMovement).filter(
            StockMovement.reference_type == "shipment",
            StockMovement.reference == shipment.shipment_number,
            StockMovement.movement_type == inventory.TRANSFER_OUT,
        ).all()
        for leg in legs:
            inventory.transfer_stock(
                db, product_id=leg.product_id, user_id=user.id,
                quantity=-leg.quantity_change,
                from_location_id=leg.to_location_id,
                to_location_id=leg.from_location_id,
                lot_id=leg.lot_id, lpn_id=leg.lpn_id, serial_id=leg.serial_id,
                reference_type="shipment", reference=shipment.shipment_number,
                notes=f"Cancelled {shipment.shipment_number}",
            )
        for item in shipment.items:
            item.quantity_picked = 0
            item.quantity_packed = 0
        shipment.staging_location_id = None
        shipment.status = "cancelled"
    except inventory.InventoryError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    shipment = _load_shipment(db, shipment.id)
    log_activity(db, user.id, user.username, "cancel", "shipment", shipment.id, f"Cancelled shipment '{shipment.shipment_number}'")
    db.commit()
    broadcast_change("shipment", "updated")
    broadcast_change("stock_movement", "created")
    broadcast_change("product", "updated")
    return shipment


@router.delete("/{shipment_id}", status_code=204)
def delete_shipment(shipment_id: int, db: Session = Depends(get_db), user=Depends(require_permission("shipments.delete"))):
    shipment = _load_shipment(db, shipment_id)
    if shipment.status not in ("draft", "cancelled"):
        raise HTTPException(status_code=400, detail="Only draft or cancelled shipments can be deleted")
    number = shipment.shipment_number
    db.delete(shipment)
    db.commit()
    log_activity(db, user.id, user.username, "delete", "shipment", shipment_id, f"Deleted shipment '{number}'")
    db.commit()
    broadcast_change("shipment", "deleted")
    return None
