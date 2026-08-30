from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.notification import Notification
from app.schemas.notification import NotificationOut
from app.services.auth import get_current_user, require_permission
from app.utils import broadcast_change_user, get_or_404

router = APIRouter(prefix="/api/notifications", tags=["notifications"], dependencies=[Depends(require_permission("notifications.view"))])


@router.get("")
def list_notifications(
    skip: int = 0,
    limit: int = 50,
    unread_only: bool = False,
    type: str = "",
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    q = db.query(Notification).filter(Notification.user_id == user.id)
    if unread_only:
        q = q.filter(Notification.is_read == False)  # noqa: E712
    if type:
        q = q.filter(Notification.type == type)
    limit = min(limit, 200)
    total = q.count()
    items = (
        q.order_by(Notification.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    return {
        "items": [NotificationOut.model_validate(n) for n in items],
        "total": total,
        "page": (skip // limit) + 1 if limit else 1,
        "pages": max((total + limit - 1) // limit, 1) if limit else 1,
    }


@router.get("/unread-count", response_model=int)
def unread_count(db: Session = Depends(get_db), user=Depends(get_current_user)):
    return db.query(Notification).filter(
        Notification.user_id == user.id, Notification.is_read == False  # noqa: E712
    ).count()


@router.put("/read-all", response_model=dict)
def read_all(db: Session = Depends(get_db), user=Depends(get_current_user)):
    db.query(Notification).filter(
        Notification.user_id == user.id, Notification.is_read == False  # noqa: E712
    ).update({"is_read": True})
    db.commit()
    broadcast_change_user(user.id, "notification", "updated")
    return {"ok": True}


@router.put("/{notification_id}/read", response_model=NotificationOut)
def mark_read(notification_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    n = get_or_404(Notification, notification_id, db)
    if n.user_id != user.id:
        raise HTTPException(status_code=403, detail="Not your notification")
    n.is_read = True
    db.commit()
    db.refresh(n)
    broadcast_change_user(user.id, "notification", "updated")
    return n


@router.delete("/{notification_id}", response_model=dict)
def delete_notification(notification_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    n = get_or_404(Notification, notification_id, db)
    if n.user_id != user.id:
        raise HTTPException(status_code=403, detail="Not your notification")
    db.delete(n)
    db.commit()
    broadcast_change_user(user.id, "notification", "deleted")
    return {"ok": True}
