from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.constants import MAX_PAGE_SIZE_LOOKUP
from app.database import get_db
from app.models.sales_channel import SalesChannel
from app.schemas.sales_channel import SalesChannelCreate, SalesChannelOut, SalesChannelUpdate
from app.services.auth import require_permission
from app.services.soft_delete import register, soft_delete
from app.utils import get_or_404, log_activity, broadcast_change

CHANNEL_TYPES = {"store", "webstore", "marketplace", "b2b"}

router = APIRouter(
    prefix="/api/sales-channels",
    tags=["sales-channels"],
    dependencies=[Depends(require_permission("sales.view"))],
)


def _purge_channel(db: Session, ch: SalesChannel, user) -> None:
    from app.models.sale import Sale
    sale_count = db.query(Sale).filter(Sale.channel_id == ch.id).count()
    if sale_count > 0:
        raise HTTPException(status_code=400, detail=f"Cannot delete: {sale_count} sale(s) are linked to this channel. Deactivate it instead.")
    db.delete(ch)


register("sales_channel", SalesChannel, lambda ch: ch.name, _purge_channel)


@router.get("")
def list_channels(
    search: str = Query(""),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=MAX_PAGE_SIZE_LOOKUP),
    db: Session = Depends(get_db),
):
    q = db.query(SalesChannel).filter(SalesChannel.is_deleted == False)  # noqa: E712
    if search:
        q = q.filter(SalesChannel.name.ilike(f"%{search}%"))
    total = q.count()
    items = q.order_by(SalesChannel.name).offset(skip).limit(limit).all()
    return {
        "items": [SalesChannelOut.model_validate(ch) for ch in items],
        "total": total,
        "page": (skip // limit) + 1,
        "pages": max(ceil(total / limit), 1),
    }


@router.get("/all")
def list_all_active(db: Session = Depends(get_db)):
    items = db.query(SalesChannel).filter(SalesChannel.is_active == True, SalesChannel.is_deleted == False).order_by(SalesChannel.name).all()  # noqa: E712
    return [SalesChannelOut.model_validate(ch) for ch in items]


@router.get("/{channel_id}", response_model=SalesChannelOut)
def get_channel(channel_id: int, db: Session = Depends(get_db)):
    return SalesChannelOut.model_validate(get_or_404(SalesChannel, channel_id, db))


@router.post("", response_model=SalesChannelOut, status_code=201)
def create_channel(data: SalesChannelCreate, db: Session = Depends(get_db), user=Depends(require_permission("sales.create"))):
    if data.type not in CHANNEL_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid channel type '{data.type}'. Must be one of: {', '.join(sorted(CHANNEL_TYPES))}")
    existing = db.query(SalesChannel).filter(SalesChannel.name == data.name.strip(), SalesChannel.is_deleted == False).first()  # noqa: E712
    if existing:
        raise HTTPException(status_code=400, detail="A sales channel with this name already exists")
    ch = SalesChannel(name=data.name.strip(), type=data.type, is_active=data.is_active)
    db.add(ch)
    db.commit()
    db.refresh(ch)
    log_activity(db, user.id, user.username, "create", "sales_channel", ch.id, f"Created sales channel '{ch.name}'")
    broadcast_change("sales_channel", "created")
    return SalesChannelOut.model_validate(ch)


@router.put("/{channel_id}", response_model=SalesChannelOut)
def update_channel(channel_id: int, data: SalesChannelUpdate, db: Session = Depends(get_db), user=Depends(require_permission("sales.create"))):
    ch = get_or_404(SalesChannel, channel_id, db)
    if data.name is not None:
        dup = db.query(SalesChannel).filter(SalesChannel.name == data.name.strip(), SalesChannel.id != channel_id, SalesChannel.is_deleted == False).first()  # noqa: E712
        if dup:
            raise HTTPException(status_code=400, detail="A sales channel with this name already exists")
        ch.name = data.name.strip()
    if data.type is not None:
        if data.type not in CHANNEL_TYPES:
            raise HTTPException(status_code=400, detail=f"Invalid channel type '{data.type}'. Must be one of: {', '.join(sorted(CHANNEL_TYPES))}")
        ch.type = data.type
    if data.is_active is not None:
        ch.is_active = data.is_active
    db.commit()
    db.refresh(ch)
    log_activity(db, user.id, user.username, "update", "sales_channel", ch.id, f"Updated sales channel '{ch.name}'")
    broadcast_change("sales_channel", "updated")
    return SalesChannelOut.model_validate(ch)


@router.delete("/{channel_id}")
def delete_channel(channel_id: int, db: Session = Depends(get_db), user=Depends(require_permission("sales.create"))):
    ch = get_or_404(SalesChannel, channel_id, db)
    from app.models.sale import Sale
    sale_count = db.query(Sale).filter(Sale.channel_id == ch.id).count()
    if sale_count > 0:
        raise HTTPException(status_code=400, detail=f"Cannot delete: {sale_count} sale(s) are linked to this channel. Deactivate it instead.")
    soft_delete(db, ch, user, "sales_channel")
    return {"ok": True}
