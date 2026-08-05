from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.activity_log import ActivityLog
from app.models.location import Location


def get_or_404(model, id: int, db: Session, options=None):
    query = db.query(model).filter(model.id == id)
    if options:
        query = query.options(*options)
    obj = query.first()
    if not obj:
        raise HTTPException(status_code=404, detail=f"{model.__name__} not found")
    return obj


def require_active_location(db: Session, product, location_id: int | None = None) -> int:
    """Return the effective location id for `product`, raising a 400 when the
    product has no location set or that location is inactive."""
    loc_id = location_id if location_id is not None else product.location_id
    if loc_id is None:
        raise HTTPException(
            status_code=400,
            detail=f"'{product.display_name}' has no location set - assign a location to the product first",
        )
    loc = db.get(Location, loc_id)
    if loc is None:
        raise HTTPException(status_code=400, detail=f"Location for '{product.display_name}' no longer exists")
    if not loc.is_active:
        raise HTTPException(status_code=400, detail=f"Location '{loc.path}' for '{product.display_name}' is inactive")
    return loc_id


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
