from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.constants import MAX_PAGE_SIZE_LOOKUP
from app.database import get_db
from app.models.promotion import Promotion
from app.schemas.promotion import PromotionCreate, PromotionListItem, PromotionOut, PromotionUpdate
from app.services.auth import require_permission
from app.services.pricing import validate_promotion, PromoError
from app.utils import get_or_404, log_activity, broadcast_change

router = APIRouter(
    prefix="/api/promotions",
    tags=["promotions"],
    dependencies=[Depends(require_permission("promotions.view"))],
)


@router.get("")
def list_promotions(
    search: str = Query(""),
    active_only: bool = Query(False),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=MAX_PAGE_SIZE_LOOKUP),
    db: Session = Depends(get_db),
):
    q = db.query(Promotion)
    if search:
        q = q.filter(Promotion.code.ilike(f"%{search}%"))
    if active_only:
        q = q.filter(Promotion.is_active == True)
    total = q.count()
    items = q.order_by(Promotion.created_at.desc()).offset(skip).limit(limit).all()
    return {
        "items": [PromotionListItem.model_validate(p) for p in items],
        "total": total,
        "page": (skip // limit) + 1,
        "pages": max(ceil(total / limit), 1),
    }


@router.get("/{promo_id}", response_model=PromotionOut)
def get_promotion(promo_id: int, db: Session = Depends(get_db)):
    return get_or_404(Promotion, promo_id, db)


@router.post("", response_model=PromotionOut, status_code=201)
def create_promotion(data: PromotionCreate, db: Session = Depends(get_db), user=Depends(require_permission("promotions.create"))):
    code = data.code.strip().upper()
    existing = db.query(Promotion).filter(Promotion.code == code).first()
    if existing:
        raise HTTPException(status_code=400, detail="A promotion with this code already exists")
    if data.discount_type == "percentage" and data.value > 100:
        raise HTTPException(status_code=400, detail="Percentage discount cannot exceed 100%")
    promo = Promotion(
        code=code,
        description=data.description,
        discount_type=data.discount_type,
        value=data.value,
        min_qty=data.min_qty,
        min_amount=data.min_amount,
        valid_from=data.valid_from,
        valid_to=data.valid_to,
        max_uses=data.max_uses,
        is_active=data.is_active,
    )
    db.add(promo)
    db.commit()
    db.refresh(promo)
    log_activity(db, user.id, user.username, "create", "promotion", promo.id, f"Created promotion '{promo.code}'")
    broadcast_change("promotion", "created")
    return PromotionOut.model_validate(promo)


@router.put("/{promo_id}", response_model=PromotionOut)
def update_promotion(promo_id: int, data: PromotionUpdate, db: Session = Depends(get_db), user=Depends(require_permission("promotions.update"))):
    promo = get_or_404(Promotion, promo_id, db)
    if data.code is not None:
        code = data.code.strip().upper()
        dup = db.query(Promotion).filter(Promotion.code == code, Promotion.id != promo_id).first()
        if dup:
            raise HTTPException(status_code=400, detail="A promotion with this code already exists")
        promo.code = code
    if data.description is not None:
        promo.description = data.description
    if data.discount_type is not None:
        promo.discount_type = data.discount_type
    if data.value is not None:
        effective_type = data.discount_type or promo.discount_type
        if effective_type == "percentage" and data.value > 100:
            raise HTTPException(status_code=400, detail="Percentage discount cannot exceed 100%")
        promo.value = data.value
    if data.min_qty is not None:
        promo.min_qty = data.min_qty
    if data.min_amount is not None:
        promo.min_amount = data.min_amount
    if "valid_from" in data.model_fields_set:
        promo.valid_from = data.valid_from
    if "valid_to" in data.model_fields_set:
        promo.valid_to = data.valid_to
    if data.max_uses is not None:
        promo.max_uses = data.max_uses
    if data.is_active is not None:
        promo.is_active = data.is_active
    db.commit()
    db.refresh(promo)
    log_activity(db, user.id, user.username, "update", "promotion", promo.id, f"Updated promotion '{promo.code}'")
    broadcast_change("promotion", "updated")
    return PromotionOut.model_validate(promo)


@router.delete("/{promo_id}")
def delete_promotion(promo_id: int, db: Session = Depends(get_db), user=Depends(require_permission("promotions.delete"))):
    promo = get_or_404(Promotion, promo_id, db)
    log_activity(db, user.id, user.username, "delete", "promotion", promo.id, f"Deleted promotion '{promo.code}'")
    db.delete(promo)
    db.commit()
    broadcast_change("promotion", "deleted")
    return {"detail": "Deleted"}


class PromoValidateRequest(BaseModel):
    code: str
    subtotal: float = 0.0
    total_qty: int = 0


@router.post("/validate")
def validate_promo_code(data: PromoValidateRequest, db: Session = Depends(get_db)):
    try:
        promo, discount = validate_promotion(db, data.code, data.subtotal, data.total_qty)
        return {
            "valid": True,
            "promo_id": promo.id,
            "code": promo.code,
            "description": promo.description,
            "discount_type": promo.discount_type,
            "value": float(promo.value),
            "discount_amount": discount,
        }
    except PromoError as exc:
        return {"valid": False, "error": str(exc)}
