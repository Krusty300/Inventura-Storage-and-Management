from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from app.constants import MAX_PAGE_SIZE_LOOKUP
from app.database import get_db
from app.models.price_list import PriceList, PriceListItem
from app.schemas.price_list import (
    PriceListCreate,
    PriceListListItem,
    PriceListOut,
    PriceListUpdate,
)
from app.services.auth import require_permission
from app.services.pricing import resolve_price
from app.services.soft_delete import register, soft_delete
from app.utils import get_or_404, log_activity, broadcast_change

router = APIRouter(
    prefix="/api/price-lists",
    tags=["price-lists"],
    dependencies=[Depends(require_permission("price_lists.view"))],
)


def _purge_price_list(db: Session, pl: PriceList, user) -> None:
    if pl.is_default:
        raise HTTPException(status_code=400, detail="Cannot delete the default price list")
    db.delete(pl)


register("price_list", PriceList, lambda p: p.name, _purge_price_list)


def _item_count(db: Session, pl: PriceList) -> int:
    return db.query(PriceListItem).filter(PriceListItem.price_list_id == pl.id).count()


def _load_options():
    return [joinedload(PriceList.items).joinedload(PriceListItem.product)]


@router.get("")
def list_price_lists(
    search: str = Query(""),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=MAX_PAGE_SIZE_LOOKUP),
    db: Session = Depends(get_db),
):
    q = db.query(PriceList).filter(PriceList.is_deleted == False)  # noqa: E712
    if search:
        q = q.filter(PriceList.name.ilike(f"%{search}%"))
    total = q.count()
    items = q.order_by(PriceList.is_default.desc(), PriceList.name).offset(skip).limit(limit).all()
    result = []
    for pl in items:
        out = PriceListListItem.model_validate(pl)
        out.item_count = _item_count(db, pl)
        result.append(out)
    return {
        "items": result,
        "total": total,
        "page": (skip // limit) + 1,
        "pages": max(ceil(total / limit), 1),
    }


@router.get("/{pl_id}", response_model=PriceListOut)
def get_price_list(pl_id: int, db: Session = Depends(get_db)):
    pl = get_or_404(PriceList, pl_id, db, options=_load_options())
    return PriceListOut.model_validate(pl)


@router.post("", response_model=PriceListOut, status_code=201)
def create_price_list(data: PriceListCreate, db: Session = Depends(get_db), user=Depends(require_permission("price_lists.create"))):
    existing = db.query(PriceList).filter(PriceList.name == data.name.strip()).first()
    if existing:
        raise HTTPException(status_code=400, detail="A price list with this name already exists")
    if data.is_default:
        db.query(PriceList).filter(PriceList.is_default == True).update({"is_default": False})
    pl = PriceList(
        name=data.name.strip(),
        description=data.description,
        valid_from=data.valid_from,
        valid_to=data.valid_to,
        is_default=data.is_default,
    )
    db.add(pl)
    db.flush()
    for item in data.items:
        db.add(PriceListItem(price_list_id=pl.id, product_id=item.product_id, price=item.price, min_qty=item.min_qty))
    db.commit()
    pl = get_or_404(PriceList, pl.id, db, options=_load_options())
    log_activity(db, user.id, user.username, "create", "price_list", pl.id, f"Created price list '{pl.name}'")
    broadcast_change("price_list", "created")
    return PriceListOut.model_validate(pl)


@router.put("/{pl_id}", response_model=PriceListOut)
def update_price_list(pl_id: int, data: PriceListUpdate, db: Session = Depends(get_db), user=Depends(require_permission("price_lists.update"))):
    pl = get_or_404(PriceList, pl_id, db, options=[joinedload(PriceList.items)])
    if data.name is not None:
        dup = db.query(PriceList).filter(PriceList.name == data.name.strip(), PriceList.id != pl_id).first()
        if dup:
            raise HTTPException(status_code=400, detail="A price list with this name already exists")
        pl.name = data.name.strip()
    if data.description is not None:
        pl.description = data.description
    if "valid_from" in data.model_fields_set:
        pl.valid_from = data.valid_from
    if "valid_to" in data.model_fields_set:
        pl.valid_to = data.valid_to
    if data.is_default is not None:
        if data.is_default:
            db.query(PriceList).filter(PriceList.is_default == True, PriceList.id != pl_id).update({"is_default": False})
        pl.is_default = data.is_default
    if data.is_active is not None:
        pl.is_active = data.is_active
    if data.items is not None:
        db.query(PriceListItem).filter(PriceListItem.price_list_id == pl_id).delete()
        for item in data.items:
            db.add(PriceListItem(price_list_id=pl_id, product_id=item.product_id, price=item.price, min_qty=item.min_qty))
    db.commit()
    pl = get_or_404(PriceList, pl_id, db, options=_load_options())
    log_activity(db, user.id, user.username, "update", "price_list", pl.id, f"Updated price list '{pl.name}'")
    broadcast_change("price_list", "updated")
    return PriceListOut.model_validate(pl)


@router.delete("/{pl_id}")
def delete_price_list(pl_id: int, db: Session = Depends(get_db), user=Depends(require_permission("price_lists.delete"))):
    pl = get_or_404(PriceList, pl_id, db)
    soft_delete(db, pl, user, "price_list")
    return {"ok": True}


class PriceResolveRequest(BaseModel):
    product_id: int
    customer_id: int | None = None
    qty: int = 1


class PriceResolveBulkRequest(BaseModel):
    items: list[PriceResolveRequest]


@router.post("/resolve")
def resolve_prices(data: PriceResolveBulkRequest, db: Session = Depends(get_db)):
    results = []
    for item in data.items:
        price = resolve_price(db, item.product_id, item.customer_id, item.qty)
        results.append({"product_id": item.product_id, "price": price})
    return {"items": results}
