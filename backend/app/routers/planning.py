from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload
from fastapi import APIRouter, Depends, Query

from app.database import get_db
from app.models import BOM, BOMItem, Product, WorkOrder
from app.services import inventory
from app.services.auth import get_current_user
from app.utils import get_or_404

router = APIRouter(prefix="/api/planning", tags=["planning"], dependencies=[Depends(get_current_user)])

OPEN_WO_STATUSES = ("planned", "released", "in_progress")


def _active_bom_components(db: Session) -> dict[int, tuple[int, list[tuple[Product, int]]]]:
    """product_id -> (bom_id, [(component Product, qty)]) for active BOMs
    (first active BOM per product)."""
    boms = (
        db.query(BOM)
        .options(joinedload(BOM.items).joinedload(BOMItem.product))
        .filter(BOM.is_active == True)
        .all()
    )
    out: dict[int, tuple[int, list[tuple[Product, int]]]] = {}
    for bom in boms:
        if bom.product_id not in out:
            out[bom.product_id] = (bom.id, [(item.product, item.quantity) for item in bom.items])
    return out


def _scheduled_receipts(db: Session) -> dict[int, int]:
    """Open work order quantities per product (planned/released/in_progress)."""
    rows = (
        db.query(WorkOrder.product_id, func.sum(WorkOrder.quantity))
        .filter(WorkOrder.status.in_(OPEN_WO_STATUSES))
        .group_by(WorkOrder.product_id)
        .all()
    )
    return {int(pid): int(qty or 0) for pid, qty in rows}


@router.get("/mrp")
def mrp(
    product_id: int,
    quantity: int = Query(..., gt=0),
    db: Session = Depends(get_db),
):
    """Material requirements plan for a forecasted demand of `quantity` units.

    Explodes the active BOM tree top-down, nets gross requirements against
    sellable on-hand plus open work orders, and suggests a manufacture (active
    BOM exists) or purchase action for every shortage.
    """
    demand = get_or_404(Product, product_id, db)
    bom_components = _active_bom_components(db)
    scheduled = _scheduled_receipts(db)

    gross: dict[int, int] = {}
    levels: dict[int, int] = {}
    via: dict[int, str] = {}

    def explode(pid: int, qty: int, level: int, via_name: str) -> None:
        gross[pid] = gross.get(pid, 0) + qty
        levels[pid] = min(levels.get(pid, 10**9), level)
        via[pid] = via_name
        entry = bom_components.get(pid)
        if entry is not None:
            parent = db.get(Product, pid)
            parent_name = parent.display_name if parent else via_name
            for component, cqty in entry[1]:
                explode(component.id, qty * cqty, level + 1, parent_name)

    explode(demand.id, quantity, 1, demand.display_name)

    bom_by_product = {pid: entry[0] for pid, entry in bom_components.items()}

    items = []
    for pid in sorted(gross, key=lambda p: (levels[p], p)):
        product = db.get(Product, pid)
        gross_qty = gross[pid]
        on_hand = inventory.on_hand(db, product_id=pid)
        recv = scheduled.get(pid, 0)
        net = gross_qty - on_hand - recv
        action = "none" if net <= 0 else ("manufacture" if pid in bom_components else "purchase")
        items.append({
            "product_id": pid,
            "product_name": product.display_name if product else "",
            "sku": product.sku if product else "",
            "level": levels[pid],
            "component_of": via[pid],
            "bom_id": bom_by_product.get(pid),
            "has_bom": pid in bom_components,
            "gross_requirement": gross_qty,
            "on_hand": on_hand,
            "scheduled_receipts": recv,
            "available": on_hand + recv,
            "net_requirement": max(net, 0),
            "action": action,
            "suggested_quantity": max(net, 0),
        })

    return {
        "demand_product_id": demand.id,
        "demand_product_name": demand.display_name,
        "demand_quantity": quantity,
        "items": items,
    }
