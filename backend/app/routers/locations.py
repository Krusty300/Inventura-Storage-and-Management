from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models import LPN, Location, Product, SerialNumber, StockLine
from app.schemas.location import LocationCreate, LocationOut, LocationUpdate
from app.services import inventory
from app.services.auth import get_current_user, require_permission
from app.utils import get_or_404, log_activity, broadcast_change

router = APIRouter(prefix="/api/locations", tags=["locations"], dependencies=[Depends(get_current_user)])

LOCATION_TYPES = {"bin", "zone", "aisle", "shelf", "storage", "receiving", "wip", "quarantine"}


def _validate_type(location_type: str):
    if location_type not in LOCATION_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid location type '{location_type}'. Must be one of: {', '.join(sorted(LOCATION_TYPES))}",
        )


def _stats_map(db: Session) -> tuple[dict, dict, dict, dict, dict, dict]:
    line_counts = dict(
        db.query(StockLine.location_id, func.count(StockLine.id)).group_by(StockLine.location_id).all()
    )
    qty = dict(
        db.query(
            StockLine.location_id, func.coalesce(func.sum(StockLine.quantity), 0)
        ).group_by(StockLine.location_id).all()
    )
    value = dict(
        db.query(
            StockLine.location_id,
            func.coalesce(func.sum(StockLine.quantity * Product.cost_price), 0),
        )
        .join(Product, StockLine.product_id == Product.id)
        .group_by(StockLine.location_id)
        .all()
    )
    lpn_counts = dict(
        db.query(LPN.location_id, func.count(LPN.id)).group_by(LPN.location_id).all()
    )
    serial_counts = dict(
        db.query(SerialNumber.location_id, func.count(SerialNumber.id))
        .filter(SerialNumber.status == inventory.SERIAL_STATUS_IN_STOCK)
        .group_by(SerialNumber.location_id)
        .all()
    )
    serial_value = dict(
        db.query(
            SerialNumber.location_id,
            func.coalesce(func.sum(Product.cost_price), 0),
        )
        .join(Product, SerialNumber.product_id == Product.id)
        .filter(SerialNumber.status == inventory.SERIAL_STATUS_IN_STOCK)
        .group_by(SerialNumber.location_id)
        .all()
    )
    return line_counts, qty, value, lpn_counts, serial_counts, serial_value


def _with_counts(locations: list[Location], db: Session) -> list[dict]:
    line_counts, qty, value, lpn_counts, serial_counts, serial_value = _stats_map(db)
    return [{
        "id": l.id,
        "name": l.name,
        "code": l.code,
        "location_type": l.location_type,
        "parent_id": l.parent_id,
        "is_active": l.is_active,
        "created_at": l.created_at,
        "path": l.path,
        "stock_line_count": line_counts.get(l.id, 0),
        "lpn_count": lpn_counts.get(l.id, 0),
        "serial_count": serial_counts.get(l.id, 0),
        "total_quantity": qty.get(l.id, 0) + serial_counts.get(l.id, 0),
        "stock_value": float(value.get(l.id, 0.0)) + float(serial_value.get(l.id, 0.0)),
    } for l in locations]


def _is_descendant(db: Session, ancestor_id: int, node_id: int) -> bool:
    seen = set()
    current = node_id
    while current is not None and current not in seen:
        if current == ancestor_id:
            return True
        seen.add(current)
        current = db.query(Location.parent_id).filter(Location.id == current).scalar()
    return False


@router.get("")
def list_locations(
    search: str = Query(""),
    location_type: str = Query(""),
    is_active: bool | None = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=5000),
    db: Session = Depends(get_db),
):
    q = db.query(Location).options(joinedload(Location.parent))
    if search:
        like = f"%{search}%"
        q = q.filter(Location.name.ilike(like) | Location.code.ilike(like))
    if location_type:
        q = q.filter(Location.location_type == location_type)
    if is_active is not None:
        q = q.filter(Location.is_active == is_active)
    total = q.count()
    locations = q.order_by(Location.name).offset(skip).limit(limit).all()
    return {"items": _with_counts(locations, db), "total": total,
            "page": (skip // limit) + 1, "pages": max(ceil(total / limit), 1)}


@router.get("/tree")
def location_tree(db: Session = Depends(get_db)):
    locations = db.query(Location).options(joinedload(Location.parent)).all()
    line_counts, qty, value, lpn_counts, serial_counts, serial_value = _stats_map(db)
    nodes = {l.id: {**dict(
        id=l.id, name=l.name, code=l.code, location_type=l.location_type,
        parent_id=l.parent_id, is_active=l.is_active, created_at=l.created_at,
        path=l.path,
    ), "stock_line_count": line_counts.get(l.id, 0), "lpn_count": lpn_counts.get(l.id, 0),
        "serial_count": serial_counts.get(l.id, 0),
        "total_quantity": qty.get(l.id, 0) + serial_counts.get(l.id, 0),
        "stock_value": float(value.get(l.id, 0.0)) + float(serial_value.get(l.id, 0.0)),
        "children": []} for l in locations}
    roots = []
    for node in nodes.values():
        if node["parent_id"] is not None and node["parent_id"] in nodes:
            nodes[node["parent_id"]]["children"].append(node)
        else:
            roots.append(node)
    return roots


@router.get("/summary")
def location_summary(db: Session = Depends(get_db)):
    total = db.query(func.count(Location.id)).scalar() or 0
    active = db.query(func.count(Location.id)).filter(Location.is_active == True).scalar() or 0
    total_stock_lines = db.query(func.count(StockLine.id)).scalar() or 0
    total_lpns = db.query(func.count(LPN.id)).scalar() or 0
    total_quantity = db.query(func.coalesce(func.sum(StockLine.quantity), 0)).scalar() or 0
    total_value = db.query(
        func.coalesce(func.sum(StockLine.quantity * Product.cost_price), 0)
    ).join(Product, StockLine.product_id == Product.id).scalar() or 0.0
    total_serial_qty = db.query(func.count(SerialNumber.id)).filter(
        SerialNumber.status == inventory.SERIAL_STATUS_IN_STOCK
    ).scalar() or 0
    total_serial_value = db.query(
        func.coalesce(func.sum(Product.cost_price), 0)
    ).select_from(SerialNumber).join(Product, SerialNumber.product_id == Product.id).filter(
        SerialNumber.status == inventory.SERIAL_STATUS_IN_STOCK
    ).scalar() or 0.0
    return {
        "total": total,
        "active": active,
        "inactive": total - active,
        "total_stock_lines": total_stock_lines,
        "total_lpns": total_lpns,
        "total_quantity": total_quantity + total_serial_qty,
        "total_value": float(total_value) + float(total_serial_value),
        "total_serials": total_serial_qty,
    }


@router.get("/{location_id}", response_model=LocationOut)
def get_location(location_id: int, db: Session = Depends(get_db)):
    loc = get_or_404(Location, location_id, db, options=[joinedload(Location.parent)])
    return _with_counts([loc], db)[0]


@router.get("/{location_id}/detail")
def location_detail(location_id: int, db: Session = Depends(get_db)):
    loc = get_or_404(Location, location_id, db)
    stock_lines = (
        db.query(StockLine)
        .options(joinedload(StockLine.product), joinedload(StockLine.lot), joinedload(StockLine.lpn))
        .filter(StockLine.location_id == location_id)
        .order_by(StockLine.id)
        .all()
    )
    lpns = (
        db.query(LPN)
        .options(joinedload(LPN.stock_lines))
        .filter(LPN.location_id == location_id)
        .order_by(LPN.lpn_number)
        .all()
    )
    serials = (
        db.query(SerialNumber)
        .options(joinedload(SerialNumber.product), joinedload(SerialNumber.lot))
        .filter(
            SerialNumber.location_id == location_id,
            SerialNumber.status == inventory.SERIAL_STATUS_IN_STOCK,
        )
        .order_by(SerialNumber.serial_number)
        .all()
    )
    scrapped = (
        db.query(SerialNumber)
        .options(joinedload(SerialNumber.product), joinedload(SerialNumber.lot))
        .filter(
            SerialNumber.location_id == location_id,
            SerialNumber.status == inventory.SERIAL_STATUS_SCRAPPED,
        )
        .order_by(SerialNumber.serial_number)
        .all()
    )

    def _serial_payload(s: SerialNumber) -> dict:
        return {
            "id": s.id,
            "product_id": s.product_id,
            "product_name": s.product.display_name if s.product else "",
            "sku": s.product.sku if s.product else "",
            "serial_number": s.serial_number,
            "lot_number": s.lot.lot_number if s.lot else "",
            "status": s.status,
            "unit_cost": float(s.product.cost_price) if s.product and s.product.cost_price else 0.0,
            "value": float(s.product.cost_price or 0) if s.product else 0.0,
        }

    return {
        "location": _with_counts([loc], db)[0],
        "stock_lines": [{
            "id": sl.id,
            "product_id": sl.product_id,
            "product_name": sl.product.display_name if sl.product else "",
            "sku": sl.product.sku if sl.product else "",
            "lot_number": sl.lot.lot_number if sl.lot else "",
            "lpn_number": sl.lpn.lpn_number if sl.lpn else "",
            "quantity": sl.quantity,
            "unit_cost": float(sl.product.cost_price) if sl.product and sl.product.cost_price else 0.0,
            "value": float(sl.quantity * (sl.product.cost_price or 0)) if sl.product else 0.0,
        } for sl in stock_lines],
        "lpns": [{
            "id": l.id,
            "lpn_number": l.lpn_number,
            "lpn_type": l.lpn_type,
            "status": l.status,
            "total_quantity": sum(sl.quantity for sl in l.stock_lines),
        } for l in lpns],
        "serials": [_serial_payload(s) for s in serials],
        "scrapped_serials": [_serial_payload(s) for s in scrapped],
    }


@router.post("", response_model=LocationOut, status_code=201)
def create_location(data: LocationCreate, db: Session = Depends(get_db), user=Depends(require_permission("locations.create"))):
    if data.parent_id is not None:
        get_or_404(Location, data.parent_id, db)
    _validate_type(data.location_type)
    if data.code:
        existing = db.query(Location).filter(Location.code == data.code).first()
        if existing:
            raise HTTPException(status_code=400, detail=f"Location code '{data.code}' already exists")
    loc = Location(
        name=data.name.strip(),
        code=data.code.strip() if data.code else None,
        location_type=data.location_type,
        parent_id=data.parent_id,
        is_active=data.is_active,
    )
    db.add(loc)
    db.commit()
    db.refresh(loc)
    log_activity(db, user.id, user.username, "create", "location", loc.id, f"Created location '{loc.path}'")
    db.commit()
    broadcast_change("location", "created")
    return _with_counts([loc], db)[0]


@router.put("/{location_id}", response_model=LocationOut)
def update_location(location_id: int, data: LocationUpdate, db: Session = Depends(get_db), user=Depends(require_permission("locations.update"))):
    loc = get_or_404(Location, location_id, db)
    updates = data.model_dump(exclude_unset=True)
    if "parent_id" in updates and updates["parent_id"] is not None:
        if updates["parent_id"] == loc.id:
            raise HTTPException(status_code=400, detail="A location cannot be its own parent")
        get_or_404(Location, updates["parent_id"], db)
        if _is_descendant(db, loc.id, updates["parent_id"]):
            raise HTTPException(status_code=400, detail="Cannot move a location under one of its own descendants")
    if "location_type" in updates:
        _validate_type(updates["location_type"])
    if "code" in updates and updates["code"]:
        existing = db.query(Location).filter(Location.code == updates["code"], Location.id != loc.id).first()
        if existing:
            raise HTTPException(status_code=400, detail=f"Location code '{updates['code']}' already exists")
    for k, v in updates.items():
        setattr(loc, k, v)
    db.commit()
    db.refresh(loc)
    log_activity(db, user.id, user.username, "update", "location", loc.id, f"Updated location '{loc.path}'")
    db.commit()
    broadcast_change("location", "updated")
    return _with_counts([loc], db)[0]


@router.delete("/{location_id}")
def delete_location(location_id: int, db: Session = Depends(get_db), user=Depends(require_permission("locations.delete"))):
    loc = get_or_404(Location, location_id, db)
    has_children = db.query(Location).filter(Location.parent_id == loc.id).first() is not None
    if has_children:
        raise HTTPException(status_code=400, detail="Cannot delete a location that has child locations")
    has_stock = db.query(StockLine).filter(StockLine.location_id == loc.id).first() is not None
    if has_stock:
        raise HTTPException(status_code=400, detail="Cannot delete a location that has stock on hand")
    has_lpns = db.query(LPN).filter(LPN.location_id == loc.id).first() is not None
    if has_lpns:
        raise HTTPException(status_code=400, detail="Cannot delete a location that has LPNs")
    has_serials = db.query(SerialNumber).filter(
        SerialNumber.location_id == loc.id, SerialNumber.status == inventory.SERIAL_STATUS_IN_STOCK
    ).first() is not None
    if has_serials:
        raise HTTPException(status_code=400, detail="Cannot delete a location that has serialized items on hand")
    path = loc.path
    db.delete(loc)
    db.commit()
    log_activity(db, user.id, user.username, "delete", "location", location_id, f"Deleted location '{path}'")
    db.commit()
    broadcast_change("location", "deleted")
    return {"deleted": location_id}
