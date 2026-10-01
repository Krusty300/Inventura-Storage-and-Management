from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models import Product, RoutingOperation, WorkCenter
from app.schemas.work_center import RoutingOperationIn, RoutingOperationOut, RoutingOut, RoutingReplace
from app.services import scheduling
from app.services.auth import require_permission
from app.utils import broadcast_change, get_or_404, log_activity

router = APIRouter(prefix="/api/routings", tags=["routings"], dependencies=[Depends(require_permission("routings.view"))])


def _load_product(db: Session, product_id: int) -> Product:
    return get_or_404(Product, product_id, db)


def _load_operations(db: Session, product_id: int) -> list[RoutingOperation]:
    return (
        db.query(RoutingOperation)
        .options(joinedload(RoutingOperation.work_center))
        .filter(RoutingOperation.product_id == product_id)
        .order_by(RoutingOperation.position)
        .all()
    )


def _load_operation(db: Session, product_id: int, op_id: int) -> RoutingOperation:
    op = (
        db.query(RoutingOperation)
        .options(joinedload(RoutingOperation.work_center))
        .filter(RoutingOperation.id == op_id, RoutingOperation.product_id == product_id)
        .first()
    )
    if op is None:
        raise HTTPException(status_code=404, detail="Routing operation not found")
    return op


def _assert_positions_unique(operations: list[RoutingOperationIn]) -> list[RoutingOperationIn]:
    positions = [int(op.position or 0) for op in operations]
    if len(set(positions)) != len(positions):
        raise HTTPException(status_code=400, detail="Each routing step needs its own position")
    return sorted(operations, key=lambda op: int(op.position or 0))


def _assert_work_center_usable(db: Session, work_center_id: int) -> WorkCenter:
    wc = db.query(WorkCenter).filter(WorkCenter.id == work_center_id, WorkCenter.is_deleted == False).first()  # noqa: E712
    if wc is None:
        raise HTTPException(status_code=404, detail="Work center not found")
    if not wc.is_active:
        raise HTTPException(status_code=400, detail=f"'{wc.name}' is inactive")
    if wc.daily_minutes <= 0:
        raise HTTPException(status_code=400, detail=f"'{wc.name}' has no daily capacity")
    return wc


def _build_routing(db: Session, product: Product) -> RoutingOut:
    operations = _load_operations(db, product.id)
    positions = sorted(op.position for op in operations)
    ideal = sum(op.standard_minutes(1) for op in operations)
    return RoutingOut(
        product_id=product.id,
        product_name=product.display_name,
        sku=product.sku,
        operation_count=len(operations),
        total_setup_minutes=sum(op.setup_minutes or 0 for op in operations),
        total_run_minutes_per_unit=round(sum(float(op.run_minutes_per_unit or 0) for op in operations), 4),
        unique_work_centers=len({op.work_center_id for op in operations}),
        ideal_minutes_per_unit=round(ideal, 4),
        adjusted_minutes_per_unit=round(sum(
            scheduling.effective_minutes(op.work_center, op.standard_minutes(1))
            for op in operations
        ), 1),
        # A gap in the sequence means a step is unaccounted for, which is what
        # "is this route ready to schedule" needs to know.
        is_complete=bool(operations) and positions == list(range(len(operations))),
        operations=[RoutingOperationOut.model_validate(op) for op in operations],
    )


def _save_operations(db: Session, product: Product, operations: list[RoutingOperationIn]) -> None:
    ordered = _assert_positions_unique(operations)
    for op in ordered:
        _assert_work_center_usable(db, op.work_center_id)
    db.query(RoutingOperation).filter(RoutingOperation.product_id == product.id).delete()
    db.flush()
    for op in ordered:
        db.add(RoutingOperation(
            product_id=product.id,
            work_center_id=op.work_center_id,
            position=int(op.position or 0),
            name=op.name,
            setup_minutes=op.setup_minutes,
            run_minutes_per_unit=op.run_minutes_per_unit,
            notes=op.notes,
            is_active=op.is_active,
        ))
    db.flush()


@router.get("/products/{product_id}", response_model=RoutingOut)
def get_routing(product_id: int, db: Session = Depends(get_db)):
    """A product's routing with the ideal and efficiency-adjusted time per unit."""
    return _build_routing(db, _load_product(db, product_id))


@router.get("/products", response_model=list[RoutingOut])
def list_routings(
    search: str = Query(""),
    only_complete: bool = False,
    db: Session = Depends(get_db),
):
    """Every manufactured product with its routing, for the routing register."""
    q = db.query(Product).filter(
        Product.is_deleted == False,  # noqa: E712
        Product.is_active == True,  # noqa: E712
        Product.parent_id.is_(None),
        Product.is_menu_item == False,  # noqa: E712
    )
    if search:
        like = f"%{search}%"
        q = q.filter(Product.name.ilike(like) | Product.sku.ilike(like))
    routings = [_build_routing(db, p) for p in q.order_by(Product.name).all()]
    if only_complete:
        routings = [r for r in routings if r.is_complete]
    routings.sort(key=lambda r: (not r.is_complete, r.product_name))
    return routings


@router.put("/products/{product_id}", response_model=RoutingOut)
def replace_routing(product_id: int, data: RoutingReplace, db: Session = Depends(get_db), user=Depends(require_permission("routings.update"))):
    """Replace a product's routing wholesale, in one transaction.

    Routings are edited as a set rather than step-by-step: reordering a route
    is a single intent, and a half-applied route would leave the scheduler
    working from steps that no longer exist.
    """
    product = _load_product(db, product_id)
    _save_operations(db, product, data.operations)
    db.commit()
    log_activity(db, user.id, user.username, "update", "routing", product.id,
                 f"Updated routing for '{product.display_name}' ({len(data.operations)} steps)")
    db.commit()
    broadcast_change("work_center", "updated")
    return _build_routing(db, product)


@router.post("/products/{product_id}/operations", response_model=RoutingOut, status_code=201)
def append_operation(product_id: int, data: RoutingOperationIn, db: Session = Depends(get_db), user=Depends(require_permission("routings.update"))):
    """Add one step to the end of a product's routing."""
    product = _load_product(db, product_id)
    _assert_work_center_usable(db, data.work_center_id)
    next_position = len(_load_operations(db, product.id))
    db.add(RoutingOperation(
        product_id=product.id,
        work_center_id=data.work_center_id,
        position=next_position,
        name=data.name,
        setup_minutes=data.setup_minutes,
        run_minutes_per_unit=data.run_minutes_per_unit,
        notes=data.notes,
        is_active=data.is_active,
    ))
    db.commit()
    log_activity(db, user.id, user.username, "create", "routing_operation", product.id,
                 f"Added routing step to '{product.display_name}'")
    db.commit()
    broadcast_change("work_center", "updated")
    return _build_routing(db, product)


@router.delete("/products/{product_id}/operations/{op_id}", response_model=RoutingOut)
def delete_operation(product_id: int, op_id: int, db: Session = Depends(get_db), user=Depends(require_permission("routings.update"))):
    """Remove a routing step and close the gap it leaves in the sequence."""
    product = _load_product(db, product_id)
    operation = _load_operation(db, product.id, op_id)
    remaining = [op for op in _load_operations(db, product.id) if op.id != operation.id]
    db.delete(operation)
    db.flush()
    for position, op in enumerate(remaining):
        op.position = position
    db.commit()
    log_activity(db, user.id, user.username, "delete", "routing_operation", product.id,
                 f"Removed routing step from '{product.display_name}'")
    db.commit()
    broadcast_change("work_center", "updated")
    return _build_routing(db, product)