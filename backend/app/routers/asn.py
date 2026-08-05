from datetime import datetime, timezone
from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models import ASN, ASNItem, Location, Lot, Product, SerialNumber, Supplier
from app.schemas.asn import ASNCreate, ASNOut, ASNReceiveRequest, ASNUpdate
from app.services import inventory
from app.services.auth import get_current_user, require_permission
from app.services.notify import notify_low_stock
from app.services.sequences import next_document_number
from app.utils import get_or_404, log_activity, broadcast_change, require_active_location

router = APIRouter(prefix="/api/asns", tags=["asns"], dependencies=[Depends(get_current_user)])


def _load_asn(db: Session, asn_id: int) -> ASN:
    return get_or_404(ASN, asn_id, db, options=[
        joinedload(ASN.items).joinedload(ASNItem.product),
        joinedload(ASN.items).joinedload(ASNItem.location),
        joinedload(ASN.supplier), joinedload(ASN.user),
    ])


@router.get("")
def list_asns(
    search: str = Query(""),
    status: str | None = None,
    supplier_id: int | None = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    db: Session = Depends(get_db),
):
    q = db.query(ASN).options(joinedload(ASN.items), joinedload(ASN.supplier), joinedload(ASN.user))
    if search:
        like = f"%{search}%"
        q = q.filter(ASN.asn_number.ilike(like) | ASN.notes.ilike(like))
    if status:
        q = q.filter(ASN.status == status)
    if supplier_id:
        q = q.filter(ASN.supplier_id == supplier_id)
    total = q.count()
    items = q.order_by(ASN.created_at.desc()).offset(skip).limit(limit).all()
    return {"items": [ASNOut.model_validate(a) for a in items], "total": total,
            "page": (skip // limit) + 1, "pages": max(ceil(total / limit), 1)}


@router.get("/{asn_id}", response_model=ASNOut)
def get_asn(asn_id: int, db: Session = Depends(get_db)):
    return _load_asn(db, asn_id)


@router.post("", response_model=ASNOut, status_code=201)
def create_asn(data: ASNCreate, db: Session = Depends(get_db), user=Depends(require_permission("asns.create"))):
    if data.supplier_id is not None:
        get_or_404(Supplier, data.supplier_id, db)
    asn = ASN(
        asn_number=next_document_number(db, "asn", "ASN-"),
        supplier_id=data.supplier_id,
        user_id=user.id,
        expected_arrival=data.expected_arrival,
        notes=data.notes,
    )
    db.add(asn)
    db.flush()
    for item in data.items:
        product = get_or_404(Product, item.product_id, db)
        if not product.is_active:
            raise HTTPException(status_code=400, detail=f"'{product.display_name}' is inactive")
        if not product.is_variant and db.query(Product).filter(Product.parent_id == product.id, Product.is_active == True).first():
            raise HTTPException(status_code=400, detail=f"'{product.display_name}' has variants - ASN items must reference a specific variant")
        if item.location_id is not None:
            get_or_404(Location, item.location_id, db)
        db.add(ASNItem(
            asn_id=asn.id,
            product_id=item.product_id,
            expected_qty=item.expected_qty,
            unit_cost=item.unit_cost,
            location_id=item.location_id or product.location_id,
        ))
    db.commit()
    asn = _load_asn(db, asn.id)
    log_activity(db, user.id, user.username, "create", "asn", asn.id, f"Created ASN '{asn.asn_number}'")
    db.commit()
    broadcast_change("asn", "created")
    return asn


@router.put("/{asn_id}", response_model=ASNOut)
def update_asn(asn_id: int, data: ASNUpdate, db: Session = Depends(get_db), user=Depends(require_permission("asns.update"))):
    asn = _load_asn(db, asn_id)
    updates = data.model_dump(exclude_unset=True)
    if "status" in updates and updates["status"] not in ("pending", "cancelled"):
        raise HTTPException(status_code=400, detail="Status can only be set to pending or cancelled here (use receive to complete)")
    if updates.get("status") == "cancelled" and asn.status != "pending":
        raise HTTPException(status_code=400, detail="Only pending ASNs can be cancelled")
    for k, v in updates.items():
        setattr(asn, k, v)
    db.commit()
    asn = _load_asn(db, asn.id)
    log_activity(db, user.id, user.username, "update", "asn", asn.id, f"Updated ASN '{asn.asn_number}' (status={asn.status})")
    db.commit()
    broadcast_change("asn", "updated")
    return asn


@router.delete("/{asn_id}")
def delete_asn(asn_id: int, db: Session = Depends(get_db), user=Depends(require_permission("asns.update"))):
    asn = _load_asn(db, asn_id)
    if asn.status != "pending":
        raise HTTPException(status_code=400, detail="Only pending ASNs can be deleted")
    db.delete(asn)
    db.commit()
    log_activity(db, user.id, user.username, "delete", "asn", asn_id, f"Deleted ASN '{asn.asn_number}'")
    db.commit()
    broadcast_change("asn", "deleted")
    return {"deleted": asn_id}


@router.post("/{asn_id}/receive", response_model=ASNOut)
def receive_asn(asn_id: int, data: ASNReceiveRequest, db: Session = Depends(get_db), user=Depends(require_permission("asns.receive"))):
    asn = _load_asn(db, asn_id)
    if asn.status == "received":
        raise HTTPException(status_code=400, detail="ASN is already fully received")
    if asn.status == "cancelled":
        raise HTTPException(status_code=400, detail="Cannot receive a cancelled ASN")

    by_product = {item.product_id: item for item in asn.items}
    try:
        for line in data.items:
            asn_item = by_product.get(line.product_id)
            if asn_item is None:
                raise HTTPException(status_code=400, detail=f"Product {line.product_id} is not on this ASN")
            remaining = asn_item.expected_qty - asn_item.received_qty
            if line.received_qty > remaining:
                raise HTTPException(status_code=400, detail=f"Received quantity {line.received_qty} exceeds remaining expected {remaining} for '{asn_item.product_name}'")
            product = get_or_404(Product, line.product_id, db)
            if not product.is_active:
                raise HTTPException(status_code=400, detail=f"'{product.display_name}' is inactive")
            if line.location_id is not None:
                line_loc = get_or_404(Location, line.location_id, db)
                if not line_loc.is_active:
                    raise HTTPException(status_code=400, detail=f"Location '{line_loc.path}' is inactive")
            require_active_location(db, product)

            lot = None
            if line.lot_number:
                lot = db.query(Lot).filter(
                    Lot.product_id == product.id, Lot.lot_number == line.lot_number
                ).first()
                if lot is None:
                    lot = Lot(
                        product_id=product.id,
                        lot_number=line.lot_number,
                        expiry_date=line.expiry_date,
                        supplier_id=asn.supplier_id,
                    )
                    db.add(lot)
                    db.flush()
                elif line.expiry_date is not None and lot.expiry_date is None:
                    lot.expiry_date = line.expiry_date

            if product.is_serialized:
                if not line.serial_numbers:
                    raise HTTPException(status_code=400, detail=f"'{product.display_name}' is serialized - serial numbers are required")
                seen: set[str] = set()
                for sn in line.serial_numbers:
                    if sn in seen:
                        raise HTTPException(status_code=400, detail=f"Duplicate serial number '{sn}' in this receive")
                    seen.add(sn)
                    if db.query(SerialNumber).filter(
                        SerialNumber.product_id == product.id, SerialNumber.serial_number == sn
                    ).first():
                        raise HTTPException(status_code=400, detail=f"Serial number '{sn}' is already registered for '{product.display_name}'")
                for sn in line.serial_numbers:
                    serial = SerialNumber(
                        product_id=product.id,
                        serial_number=sn,
                        lot_id=lot.id if lot else None,
                        location_id=line.location_id or product.location_id,
                    )
                    db.add(serial)
                    db.flush()
                    inventory.post_journal_entry(
                        db, product_id=product.id, user_id=user.id,
                        quantity_change=1, movement_type=inventory.RECEIVE,
                        to_location_id=line.location_id or product.location_id,
                        lot_id=lot.id if lot else None,
                        serial_id=serial.id,
                        reference_type="asn", reference=asn.asn_number,
                        notes=data.notes or asn.notes,
                    )
                received = line.received_qty
            else:
                if line.serial_numbers:
                    raise HTTPException(status_code=400, detail=f"'{product.display_name}' is not serialized - remove serial numbers")
                inventory.post_journal_entry(
                    db, product_id=product.id, user_id=user.id,
                    quantity_change=line.received_qty, movement_type=inventory.RECEIVE,
                    to_location_id=line.location_id or product.location_id,
                    lot_id=lot.id if lot else None,
                    reference_type="asn", reference=asn.asn_number,
                    notes=data.notes or asn.notes,
                )
                received = line.received_qty

            asn_item.received_qty += received
            if line.unit_cost and asn_item.unit_cost == 0:
                asn_item.unit_cost = line.unit_cost
            if line.location_id is not None:
                asn_item.location_id = line.location_id
    except inventory.InventoryError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

    if all(i.received_qty >= i.expected_qty for i in asn.items):
        asn.status = "received"
        asn.received_at = datetime.now(timezone.utc)

    db.commit()
    asn = _load_asn(db, asn.id)
    log_activity(db, user.id, user.username, "create", "receipt", asn.id,
                 f"Received ASN '{asn.asn_number}' ({asn.total_received} unit(s))")
    for item in asn.items:
        if item.product:
            notify_low_stock(db, item.product)
    db.commit()
    broadcast_change("asn", "updated")
    broadcast_change("stock_movement", "created")
    return asn
