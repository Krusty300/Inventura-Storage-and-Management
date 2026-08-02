from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.activity_log import ActivityLog


def get_or_404(model, id: int, db: Session, options=None):
    query = db.query(model).filter(model.id == id)
    if options:
        query = query.options(*options)
    obj = query.first()
    if not obj:
        raise HTTPException(status_code=404, detail=f"{model.__name__} not found")
    return obj


def log_activity(db: Session, user_id: int, username: str, action: str, entity_type: str, entity_id: int | None = None, description: str = "", details: str = ""):
    entry = ActivityLog(
        user_id=user_id,
        username=username,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        description=description,
        details=details,
    )
    db.add(entry)


def broadcast_change(entity_type: str, action: str):
    from app.ws_manager import manager
    manager.broadcast_sync({"event": "entity_changed", "entity": entity_type, "action": action})
