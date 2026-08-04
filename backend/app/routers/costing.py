from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models import Product, WorkOrder, WorkOrderItem
from app.services import costing
from app.services.auth import get_current_user
from app.utils import get_or_404

router = APIRouter(prefix="/api/costing", tags=["costing"], dependencies=[Depends(get_current_user)])


def _load_wo(db: Session, wo_id: int) -> WorkOrder:
    return get_or_404(WorkOrder, wo_id, db, options=[
        joinedload(WorkOrder.product),
        joinedload(WorkOrder.items).joinedload(WorkOrderItem.product),
    ])


@router.get("/products/{product_id}")
def product_cost(product_id: int, db: Session = Depends(get_db)):
    """Itemized rolled-up BOM cost for a product."""
    product = get_or_404(Product, product_id, db)
    bom_map = costing.active_bom_map(db)
    return {
        "product_id": product.id,
        "product_name": product.display_name,
        "sku": product.sku,
        "unit_cost": costing.unit_cost(db, product.id, bom_map),
        "direct_cost": float(product.cost_price or 0),
        "has_bom": product.id in bom_map,
        "items": costing.itemized_bom_cost(db, product.id),
    }


@router.get("/work-orders/{wo_id}")
def work_order_cost(wo_id: int, db: Session = Depends(get_db)):
    """Actual material cost of a work order vs the standard rolled-up cost."""
    wo = _load_wo(db, wo_id)
    rows = []
    material_cost = 0.0
    for item in wo.items:
        unit_cost = float(item.product.cost_price or 0) if item.product else 0.0
        issued_cost = item.quantity_issued * unit_cost
        material_cost += issued_cost
        rows.append({
            "product_id": item.product_id,
            "product_name": item.product_name,
            "quantity_required": item.quantity_required,
            "quantity_issued": item.quantity_issued,
            "unit_cost": unit_cost,
            "issued_cost": round(issued_cost, 2),
            "required_cost": round(item.quantity_required * unit_cost, 2),
        })
    standard_unit_cost = costing.unit_cost(db, wo.product_id)
    actual_unit_cost = round(material_cost / wo.quantity, 2) if wo.quantity else 0.0
    return {
        "wo_number": wo.wo_number,
        "product_id": wo.product_id,
        "product_name": wo.product_name,
        "status": wo.status,
        "quantity": wo.quantity,
        "material_cost": round(material_cost, 2),
        "standard_unit_cost": standard_unit_cost,
        "actual_unit_cost": actual_unit_cost,
        "variance": round(actual_unit_cost - standard_unit_cost, 2),
        "rows": rows,
    }


@router.get("/report")
def manufacturing_cost_report(db: Session = Depends(get_db)):
    """Manufacturing cost summary for all completed work orders."""
    wos = (
        db.query(WorkOrder)
        .options(joinedload(WorkOrder.product), joinedload(WorkOrder.items).joinedload(WorkOrderItem.product))
        .filter(WorkOrder.status == "completed")
        .order_by(WorkOrder.completed_at.desc())
        .all()
    )
    items = []
    total_material = 0.0
    total_standard = 0.0
    for wo in wos:
        material = 0.0
        for item in wo.items:
            unit_cost = float(item.product.cost_price or 0) if item.product else 0.0
            material += item.quantity_issued * unit_cost
        standard = costing.unit_cost(db, wo.product_id)
        actual_unit = round(material / wo.quantity, 2) if wo.quantity else 0.0
        items.append({
            "wo_id": wo.id,
            "wo_number": wo.wo_number,
            "product_name": wo.product_name,
            "quantity": wo.quantity,
            "completed_at": wo.completed_at,
            "material_cost": round(material, 2),
            "standard_cost": round(standard * wo.quantity, 2),
            "actual_unit_cost": actual_unit,
            "standard_unit_cost": standard,
            "variance": round(actual_unit - standard, 2),
        })
        total_material += material
        total_standard += standard * wo.quantity
    return {
        "items": items,
        "total_material_cost": round(total_material, 2),
        "total_standard_cost": round(total_standard, 2),
        "total_variance": round(total_material - total_standard, 2),
        "completed_orders": len(items),
    }
