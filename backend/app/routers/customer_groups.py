from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.constants import MAX_PAGE_SIZE_LOOKUP
from app.database import get_db
from app.models.customer import Customer
from app.models.customer_group import CustomerGroup
from app.models.price_list import PriceList
from app.schemas.customer_group import CustomerGroupCreate, CustomerGroupOut, CustomerGroupUpdate
from app.services.auth import require_permission
from app.services.soft_delete import register, soft_delete
from app.utils import get_or_404, log_activity, broadcast_change

router = APIRouter(
    prefix="/api/customer-groups",
    tags=["customer-groups"],
    dependencies=[Depends(require_permission("customer_groups.view"))],
)


def _purge_group(db: Session, g: CustomerGroup, user) -> None:
    customer_count = db.query(func.count(Customer.id)).filter(Customer.group_id == g.id).scalar() or 0
    if customer_count > 0:
        raise HTTPException(status_code=400, detail=f"Cannot delete: {customer_count} customer(s) still assigned to this group")
    db.delete(g)


register("customer_group", CustomerGroup, lambda g: g.name, _purge_group)


@router.get("")
def list_groups(
    search: str = Query(""),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=MAX_PAGE_SIZE_LOOKUP),
    db: Session = Depends(get_db),
):
    q = db.query(CustomerGroup).filter(CustomerGroup.is_deleted == False)  # noqa: E712
    if search:
        q = q.filter(CustomerGroup.name.ilike(f"%{search}%"))
    total = q.count()
    items = q.order_by(CustomerGroup.name).offset(skip).limit(limit).all()
    result = []
    for g in items:
        count = db.query(func.count(Customer.id)).filter(Customer.group_id == g.id).scalar() or 0
        out = CustomerGroupOut.model_validate(g)
        out.customer_count = count
        result.append(out)
    return {
        "items": result,
        "total": total,
        "page": (skip // limit) + 1,
        "pages": max(ceil(total / limit), 1),
    }


@router.get("/{group_id}", response_model=CustomerGroupOut)
def get_group(group_id: int, db: Session = Depends(get_db)):
    g = get_or_404(CustomerGroup, group_id, db)
    out = CustomerGroupOut.model_validate(g)
    out.customer_count = db.query(func.count(Customer.id)).filter(Customer.group_id == g.id).scalar() or 0
    return out


@router.post("", response_model=CustomerGroupOut, status_code=201)
def create_group(data: CustomerGroupCreate, db: Session = Depends(get_db), user=Depends(require_permission("customer_groups.create"))):
    existing = db.query(CustomerGroup).filter(CustomerGroup.name == data.name.strip(), CustomerGroup.is_deleted == False).first()  # noqa: E712
    if existing:
        raise HTTPException(status_code=400, detail="A customer group with this name already exists")
    if data.price_list_id is not None:
        if not db.get(PriceList, data.price_list_id):
            raise HTTPException(status_code=400, detail=f"Price list {data.price_list_id} not found")
    g = CustomerGroup(name=data.name.strip(), description=data.description, price_list_id=data.price_list_id)
    db.add(g)
    db.commit()
    db.refresh(g)
    log_activity(db, user.id, user.username, "create", "customer_group", g.id, f"Created customer group '{g.name}'")
    broadcast_change("customer_group", "created")
    return CustomerGroupOut.model_validate(g)


@router.put("/{group_id}", response_model=CustomerGroupOut)
def update_group(group_id: int, data: CustomerGroupUpdate, db: Session = Depends(get_db), user=Depends(require_permission("customer_groups.update"))):
    g = get_or_404(CustomerGroup, group_id, db)
    if data.name is not None:
        dup = db.query(CustomerGroup).filter(CustomerGroup.name == data.name.strip(), CustomerGroup.id != group_id, CustomerGroup.is_deleted == False).first()  # noqa: E712
        if dup:
            raise HTTPException(status_code=400, detail="A customer group with this name already exists")
        g.name = data.name.strip()
    if data.description is not None:
        g.description = data.description
    if "price_list_id" in data.model_fields_set:
        if data.price_list_id is not None and not db.get(PriceList, data.price_list_id):
            raise HTTPException(status_code=400, detail=f"Price list {data.price_list_id} not found")
        g.price_list_id = data.price_list_id
    db.commit()
    db.refresh(g)
    log_activity(db, user.id, user.username, "update", "customer_group", g.id, f"Updated customer group '{g.name}'")
    broadcast_change("customer_group", "updated")
    return CustomerGroupOut.model_validate(g)


@router.delete("/{group_id}")
def delete_group(group_id: int, db: Session = Depends(get_db), user=Depends(require_permission("customer_groups.delete"))):
    g = get_or_404(CustomerGroup, group_id, db)
    customer_count = db.query(func.count(Customer.id)).filter(Customer.group_id == g.id).scalar() or 0
    if customer_count > 0:
        raise HTTPException(status_code=400, detail=f"Cannot delete: {customer_count} customer(s) still assigned to this group")
    soft_delete(db, g, user, "customer_group")
    return {"ok": True}
