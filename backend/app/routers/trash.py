"""Trash endpoints: list, restore, and permanently delete soft-deleted rows.

The Trash surface is generic: every soft-deletable entity registers a
:class:`TrashEntity` in ``app.services.soft_delete`` and the routes here
operate on that registry, so no resource router needs to know about the Trash.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.auth import require_permission
from app.services.soft_delete import TRASH_ENTITIES, list_trash, restore
from app.utils import broadcast_change, log_activity

router = APIRouter(
    prefix="/api/trash",
    tags=["trash"],
    dependencies=[Depends(require_permission("trash.view"))],
)


@router.get("")
def get_trash(
    entity_type: str = Query("", description="Filter to a single entity type"),
    search: str = Query("", description="Case-insensitive search on item labels"),
    db: Session = Depends(get_db),
):
    items = list_trash(db, entity_type=entity_type or None, search=search)
    counts: dict[str, int] = {}
    for et, entry in TRASH_ENTITIES.items():
        counts[et] = (
            db.query(func.count())
            .select_from(entry.model)
            .filter(entry.model.is_deleted == True)  # noqa: E712
            .scalar()
            or 0
        )
    return {"items": items, "counts": counts}


@router.post("/{entity_type}/{item_id}/restore")
def restore_item(
    entity_type: str,
    item_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_permission("trash.restore")),
):
    if entity_type not in TRASH_ENTITIES:
        raise HTTPException(status_code=404, detail=f"Unknown trash entity type: {entity_type}")
    try:
        obj = restore(db, entity_type, item_id, user)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return {"ok": True, "entity_type": entity_type, "id": obj.id}


@router.delete("/{entity_type}/{item_id}")
def permanent_delete(
    entity_type: str,
    item_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_permission("trash.delete")),
):
    entry = TRASH_ENTITIES.get(entity_type)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"Unknown trash entity type: {entity_type}")
    obj = (
        db.query(entry.model)
        .filter(entry.model.id == item_id, entry.model.is_deleted == True)  # noqa: E712
        .first()
    )
    if obj is None:
        raise HTTPException(status_code=404, detail="Item is not in the trash")
    label = entry.label(obj) or str(obj.id)
    try:
        entry.purge(db, obj, user)
        db.commit()
    except HTTPException as exc:
        db.rollback()
        raise exc
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail="Cannot permanently delete: it is still referenced by other records",
        )
    log_activity(db, user.id, user.username, "delete", entity_type, item_id, f"Permanently deleted '{label}'")
    db.commit()
    broadcast_change(entity_type, "deleted")
    return {"ok": True}