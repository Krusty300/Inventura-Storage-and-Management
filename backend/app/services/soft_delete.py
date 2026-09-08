"""Central soft-delete / trash registry.

Every soft-deletable master-data entity registers a :class:`TrashEntity` entry
here. The Trash router then lists, restores, and permanently deletes soft
deleted rows through this registry without importing each resource router
directly (registration happens at import time in each router module).

Semantics
---------
* Soft delete marks ``is_deleted=True`` (+ ``deleted_at``) and, when the
  model has it, flips ``is_active`` off so existing active-only queries hide
  the row.
* Restore clears both flags (and sets ``is_active`` back on).
* Permanent delete invokes each entity's registered ``purge`` handler, which
  owns the entity-specific guards/cascades that the old hard delete used.
"""

from datetime import datetime, timezone
from typing import Callable

from sqlalchemy.orm import Session

from app.utils import broadcast_change, log_activity


class TrashEntity:
    def __init__(
        self,
        entity_type: str,
        model,
        label: Callable[[object], str],
        purge: Callable[[Session, object, object], None],
    ):
        self.entity_type = entity_type
        self.model = model
        self.label = label
        self.purge = purge


TRASH_ENTITIES: dict[str, TrashEntity] = {}


def register(entity_type: str, model, label: Callable[[object], str], purge: Callable[[Session, object, object], None]) -> None:
    """Register a soft-deletable entity type for the Trash surface."""
    TRASH_ENTITIES[entity_type] = TrashEntity(entity_type, model, label, purge)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def soft_delete(db: Session, obj, user, entity_type: str, describe: str = "") -> None:
    """Flag ``obj`` as soft-deleted and log the action."""
    obj.is_deleted = True
    obj.deleted_at = now_utc()
    if hasattr(obj, "is_active"):
        obj.is_active = False
    db.commit()
    label = describe or getattr(obj, "name", str(getattr(obj, "id", "")))
    log_activity(db, user.id, user.username, "delete", entity_type, getattr(obj, "id", None), f"Sent '{label}' to trash")
    db.commit()
    broadcast_change(entity_type, "deleted")


def restore(db: Session, entity_type: str, entity_id: int, user) -> object:
    """Bring a soft-deleted row back (including its is_active flag)."""
    entry = TRASH_ENTITIES.get(entity_type)
    if entry is None:
        raise KeyError(f"Unknown trash entity type: {entity_type}")
    obj = db.query(entry.model).filter(entry.model.id == entity_id, entry.model.is_deleted == True).first()  # noqa: E712
    if obj is None:
        raise ValueError(f"{entity_type.title()} {entity_id} is not in the trash")
    obj.is_deleted = False
    obj.deleted_at = None
    if hasattr(obj, "is_active"):
        obj.is_active = True
    db.commit()
    label = entry.label(obj)
    log_activity(db, user.id, user.username, "update", entity_type, entity_id, f"Restored '{label}' from trash")
    db.commit()
    broadcast_change(entity_type, "restored")
    return obj


def list_trash(db: Session, entity_type: str | None = None, search: str = "") -> list[dict]:
    """Return soft-deleted rows as generic trash entries regardless of type."""
    search = search.strip().lower()
    items: list[dict] = []
    for et, entry in TRASH_ENTITIES.items():
        if entity_type and et != entity_type:
            continue
        q = db.query(entry.model).filter(entry.model.is_deleted == True)  # noqa: E712
        rows = q.order_by(entry.model.deleted_at.desc()).limit(500).all()
        for row in rows:
            label = entry.label(row) or ""
            if search and search not in label.lower():
                continue
            items.append(
                {
                    "id": row.id,
                    "entity_type": et,
                    "label": label,
                    "deleted_at": row.deleted_at,
                }
            )
    items.sort(key=lambda i: i["deleted_at"] or now_utc(), reverse=True)
    return items