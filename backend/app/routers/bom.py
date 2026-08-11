from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from app.constants import MAX_PAGE_SIZE
from app.database import get_db
from app.models import BOM, BOMItem, Product, WorkOrder
from app.schemas.bom import BOMCreate, BOMOut, BOMUpdate
from app.services.auth import get_current_user, require_permission
from app.utils import get_or_404, log_activity, broadcast_change

router = APIRouter(prefix="/api/boms", tags=["boms"], dependencies=[Depends(get_current_user)])


def _load_bom(db: Session, bom_id: int) -> BOM:
    return get_or_404(BOM, bom_id, db, options=[
        joinedload(BOM.product), joinedload(BOM.items).joinedload(BOMItem.product),
    ])


def _validate_product(db: Session, product_id: int, *, for_bom: bool) -> Product:
    product = get_or_404(Product, product_id, db)
    if not product.is_active:
        raise HTTPException(status_code=400, detail=f"'{product.display_name}' is inactive")
    if product.is_variant or product.parent_id is not None:
        raise HTTPException(status_code=400, detail=f"'{product.display_name}' is a variant - use the parent product")
    if for_bom and product.variants:
        raise HTTPException(status_code=400, detail=f"'{product.display_name}' has variants - manufacture a specific variant")
    return product


def _has_cycle(db: Session, output_id: int, component_ids: list[int], exclude_bom_id: int | None = None) -> str | None:
    """Return the first product involved in a BOM cycle, or None.

    A cycle exists if `output_id` is required (directly or transitively) to
    produce any of `component_ids`. Walks the existing BOM graph upward from
    each component, ignoring items belonging to `exclude_bom_id` (which is
    about to be replaced).
    """
    # Build product -> direct components from existing BOM items.
    item_rows = (
        db.query(BOMItem.product_id, BOM.product_id)
        .join(BOM, BOMItem.bom_id == BOM.id)
        .filter(BOM.is_active == True)
    )
    if exclude_bom_id is not None:
        item_rows = item_rows.filter(BOM.id != exclude_bom_id)
    edges: dict[int, set[int]] = {}
    for component_id, bom_product_id in item_rows.all():
        edges.setdefault(bom_product_id, set()).add(component_id)

    for cid in component_ids:
        if cid == output_id:
            return output_id
        stack = [cid]
        visited: set[int] = set()
        while stack:
            cur = stack.pop()
            if cur == output_id:
                return cid
            if cur in visited:
                continue
            visited.add(cur)
            for nxt in edges.get(cur, ()):
                stack.append(nxt)
    return None


def _validate_bom_items(db: Session, output_id: int, items, exclude_bom_id: int | None = None) -> None:
    if not items:
        raise HTTPException(status_code=400, detail="A BOM requires at least one component")
    component_ids: list[int] = []
    seen: set[int] = set()
    for item in items:
        if item.product_id in seen:
            raise HTTPException(status_code=400, detail="Each component may only appear once in a BOM")
        seen.add(item.product_id)
        component_ids.append(item.product_id)
        _validate_product(db, item.product_id, for_bom=False)
    cycle = _has_cycle(db, output_id, component_ids, exclude_bom_id=exclude_bom_id)
    if cycle is not None:
        raise HTTPException(status_code=400, detail="BOM cycle detected - this component chain is circular")


def _save_items(db: Session, bom: BOM, items) -> None:
    bom.items.clear()
    db.flush()
    for idx, item in enumerate(items):
        db.add(BOMItem(
            bom_id=bom.id,
            product_id=item.product_id,
            quantity=item.quantity,
            position=item.position or idx,
        ))


@router.get("")
def list_boms(
    product_id: int | None = None,
    is_active: bool | None = None,
    search: str = Query(""),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=MAX_PAGE_SIZE),
    db: Session = Depends(get_db),
):
    q = db.query(BOM).options(joinedload(BOM.product), joinedload(BOM.items).joinedload(BOMItem.product))
    if product_id:
        q = q.filter(BOM.product_id == product_id)
    if is_active is not None:
        q = q.filter(BOM.is_active == is_active)
    if search:
        like = f"%{search}%"
        q = q.join(BOM.product, isouter=True).filter(
            Product.name.ilike(like) | Product.sku.ilike(like) | BOM.name.ilike(like)
        )
    total = q.count()
    items = q.order_by(BOM.created_at.desc()).offset(skip).limit(limit).all()
    return {"items": [BOMOut.model_validate(b) for b in items], "total": total,
            "page": (skip // limit) + 1, "pages": max(ceil(total / limit), 1)}


@router.get("/{bom_id}", response_model=BOMOut)
def get_bom(bom_id: int, db: Session = Depends(get_db)):
    return _load_bom(db, bom_id)


@router.post("", response_model=BOMOut, status_code=201)
def create_bom(data: BOMCreate, db: Session = Depends(get_db), user=Depends(require_permission("bom.create"))):
    output = _validate_product(db, data.product_id, for_bom=True)
    _validate_bom_items(db, data.product_id, data.items)
    bom = BOM(product_id=data.product_id, name=data.name or output.display_name, description=data.description)
    db.add(bom)
    db.flush()
    _save_items(db, bom, data.items)
    db.commit()
    bom = _load_bom(db, bom.id)
    log_activity(db, user.id, user.username, "create", "bom", bom.id, f"Created BOM for '{bom.product_name}'")
    db.commit()
    broadcast_change("bom", "created")
    return bom


@router.put("/{bom_id}", response_model=BOMOut)
def update_bom(bom_id: int, data: BOMUpdate, db: Session = Depends(get_db), user=Depends(require_permission("bom.update"))):
    bom = _load_bom(db, bom_id)
    updates = data.model_dump(exclude_unset=True)
    if "items" in updates:
        _validate_bom_items(db, bom.product_id, data.items, exclude_bom_id=bom.id)
    for k, v in updates.items():
        if k == "items":
            continue
        setattr(bom, k, v)
    if "items" in updates:
        db.flush()
        _save_items(db, bom, data.items)
    db.commit()
    bom = _load_bom(db, bom.id)
    log_activity(db, user.id, user.username, "update", "bom", bom.id, f"Updated BOM for '{bom.product_name}'")
    db.commit()
    broadcast_change("bom", "updated")
    return bom


@router.delete("/{bom_id}", status_code=204)
def delete_bom(bom_id: int, db: Session = Depends(get_db), user=Depends(require_permission("bom.delete"))):
    bom = _load_bom(db, bom_id)
    has_work_orders = db.query(WorkOrder).filter(WorkOrder.bom_id == bom.id).first() is not None
    if has_work_orders:
        raise HTTPException(status_code=400, detail="Cannot delete a BOM that is referenced by work orders")
    db.delete(bom)
    db.commit()
    log_activity(db, user.id, user.username, "delete", "bom", bom.id, f"Deleted BOM for '{bom.product_name}'")
    db.commit()
    broadcast_change("bom", "deleted")
