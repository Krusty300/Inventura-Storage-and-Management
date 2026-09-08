from datetime import datetime, timedelta, timezone
from math import ceil
from pathlib import Path
import os
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from pydantic import BaseModel
from sqlalchemy import distinct, func, or_
from sqlalchemy.orm import Session, joinedload

from app.constants import MAX_PAGE_SIZE_LOOKUP
from app.database import get_db
from app.models.note import Note, NoteLink, NoteTag, NoteTagLink, NoteTemplate
from app.models.user import User
from app.schemas.note import (
    NoteAssign,
    NoteCreate,
    NoteLinkCreate,
    NoteTagCreate,
    NoteTagOut,
    NoteTemplateCreate,
    NoteTemplateOut,
    NoteUpdate,
)
from app.services.auth import get_current_user, require_permission
from app.services.notify import create_notification, notify_note_assigned
from app.services.soft_delete import register, soft_delete
from app.models.notification import Notification
from app.utils import broadcast_change, get_or_404, log_activity

router = APIRouter(
    prefix="/api/notes",
    tags=["notes"],
    dependencies=[Depends(require_permission("notes.view"))],
)

VALID_CATEGORIES = {"note", "reminder", "todo"}
VALID_PRIORITIES = {"low", "normal", "high", "urgent"}
VALID_RECURRENCE = {"none", "daily", "weekly", "monthly"}


def _purge_note(db: Session, note: Note, user) -> None:
    if note.image_url:
        old_path = UPLOAD_DIR / Path(note.image_url).name
        try:
            if old_path.exists():
                old_path.unlink()
        except Exception:
            pass
    db.delete(note)


register("note", Note, lambda n: n.title, _purge_note)

UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
JPEG_EXTENSIONS = {".jpg", ".jpeg"}
MAX_UPLOAD_SIZE = 10 * 1024 * 1024


def _detect_image_ext(data: bytes) -> str | None:
    from app.utils import detect_image_ext
    return detect_image_ext(data)


# Maps NoteLink entity_type → (SQLAlchemy model class, label column name)
_ENTITY_MODELS: dict[str, tuple[type, str]] = {}


def _get_entity_models() -> dict[str, tuple[type, str]]:
    if _ENTITY_MODELS:
        return _ENTITY_MODELS
    from app.models import (
        ASN, BOM, Customer, CycleCount, Location, Lot, LPN,
        Order, Product, QualityCheck, Receipt, Sale, SerialNumber,
        Shipment, Supplier, WorkOrder,
    )
    _ENTITY_MODELS.update({
        "product": (Product, "name"),
        "order": (Order, "order_number"),
        "sale": (Sale, "invoice_number"),
        "supplier": (Supplier, "name"),
        "customer": (Customer, "name"),
        "location": (Location, "name"),
        "shipment": (Shipment, "shipment_number"),
        "work_order": (WorkOrder, "wo_number"),
        "cycle_count": (CycleCount, "cc_number"),
        "receipt": (Receipt, "receipt_number"),
        "bom": (BOM, "name"),
        "lot": (Lot, "lot_number"),
        "lpn": (LPN, "lpn_number"),
        "serial_number": (SerialNumber, "serial_number"),
        "quality_check": (QualityCheck, "qc_number"),
        "asn": (ASN, "asn_number"),
    })
    return _ENTITY_MODELS


def resolve_entity_label(db: Session, entity_type: str, entity_id: int) -> str:
    models = _get_entity_models()
    entry = models.get(entity_type)
    if not entry:
        return ""
    model_cls, col_name = entry
    obj = db.get(model_cls, entity_id)
    if not obj:
        return ""
    return getattr(obj, col_name, "") or ""


def _serialize_note(note: Note) -> dict:
    return {
        "id": note.id,
        "title": note.title,
        "body": note.body,
        "category": note.category,
        "priority": note.priority,
        "is_pinned": note.is_pinned,
        "is_completed": note.is_completed,
        "is_archived": note.is_archived,
        "due_date": note.due_date,
        "recurrence": note.recurrence,
        "recurrence_end": note.recurrence_end,
        "sort_order": note.sort_order,
        "image_url": note.image_url or "",
        "user_id": note.user_id,
        "assigned_to_id": note.assigned_to_id,
        "created_at": note.created_at,
        "updated_at": note.updated_at,
        "username": note.user.username if note.user else "",
        "assigned_to_name": note.assigned_to.username if note.assigned_to else None,
        "tags": [{"id": t.id, "name": t.name, "color": t.color} for t in note.tags],
        "links": [{"id": l.id, "entity_type": l.entity_type, "entity_id": l.entity_id, "entity_label": l.entity_label or ""} for l in note.links],
    }


def _apply_filters(q, search, category, priority, is_pinned, is_completed, assigned_to, tag_id, due_before, due_after, is_archived):
    q = q.filter(Note.is_deleted == False)  # noqa: E712
    if is_archived is not None:
        q = q.filter(Note.is_archived == is_archived)
    else:
        q = q.filter(Note.is_archived == False)  # noqa: E712
    if search:
        pattern = f"%{search}%"
        q = q.filter(or_(Note.title.ilike(pattern), Note.body.ilike(pattern)))
    if category and category in VALID_CATEGORIES:
        q = q.filter(Note.category == category)
    if priority and priority in VALID_PRIORITIES:
        q = q.filter(Note.priority == priority)
    if is_pinned is not None:
        q = q.filter(Note.is_pinned == is_pinned)
    if is_completed is not None:
        q = q.filter(Note.is_completed == is_completed)
    if assigned_to is not None:
        q = q.filter(Note.assigned_to_id == assigned_to)
    if tag_id is not None:
        q = q.join(NoteTagLink).filter(NoteTagLink.tag_id == tag_id)
    if due_before:
        try:
            dt = datetime.fromisoformat(due_before)
            q = q.filter(Note.due_date <= dt)
        except ValueError:
            pass
    if due_after:
        try:
            dt = datetime.fromisoformat(due_after)
            q = q.filter(Note.due_date >= dt)
        except ValueError:
            pass
    return q


def _check_note_due_date_notifications(db: Session) -> None:
    now = datetime.now(timezone.utc)
    overdue_notes = (
        db.query(Note)
        .filter(
            Note.is_completed == False,  # noqa: E712
            Note.is_archived == False,  # noqa: E712
            Note.due_date.isnot(None),
            Note.due_date <= now,
        )
        .all()
    )
    for note in overdue_notes:
        target_user_id = note.assigned_to_id or note.user_id
        title = f"Overdue: {note.title}"
        existing = db.query(Notification).filter(
            Notification.user_id == target_user_id,
            Notification.title == title,
            Notification.is_read == False,  # noqa: E712
        ).first()
        if not existing:
            create_notification(db, target_user_id, title, f"Due on {note.due_date.strftime('%Y-%m-%d')}", type="warning", link="/notes")
    db.commit()


@router.get("")
def list_notes(
    search: str = Query(""),
    category: str = Query(""),
    priority: str = Query(""),
    is_pinned: bool | None = Query(None),
    is_completed: bool | None = Query(None),
    is_archived: bool | None = Query(None),
    assigned_to: int | None = Query(None),
    tag_id: int | None = Query(None),
    due_before: str = Query(""),
    due_after: str = Query(""),
    sort: str = Query("created_at"),
    order: str = Query("desc"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=MAX_PAGE_SIZE_LOOKUP),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _check_note_due_date_notifications(db)

    q = db.query(Note).options(
        joinedload(Note.user),
        joinedload(Note.assigned_to),
        joinedload(Note.tags),
        joinedload(Note.links),
    )
    q = _apply_filters(q, search, category, priority, is_pinned, is_completed, assigned_to, tag_id, due_before, due_after, is_archived)

    sort_col = {
        "created_at": Note.created_at,
        "updated_at": Note.updated_at,
        "due_date": Note.due_date,
        "title": Note.title,
        "priority": Note.priority,
    }.get(sort, Note.created_at)
    if order == "asc":
        q = q.order_by(sort_col.asc().nullslast())
    else:
        q = q.order_by(sort_col.desc().nullslast())

    count_q = db.query(func.count(distinct(Note.id)))
    count_q = _apply_filters(count_q, search, category, priority, is_pinned, is_completed, assigned_to, tag_id, due_before, due_after, is_archived)
    total = count_q.scalar() or 0
    items = q.offset(skip).limit(limit).all()
    return {
        "items": [_serialize_note(n) for n in items],
        "total": total,
        "page": (skip // limit) + 1,
        "pages": max(ceil(total / limit), 1),
    }


@router.get("/tags", response_model=list[NoteTagOut])
def list_tags(db: Session = Depends(get_db)):
    return db.query(NoteTag).order_by(NoteTag.name).all()


@router.post("/tags", response_model=NoteTagOut, status_code=201)
def create_tag(data: NoteTagCreate, db: Session = Depends(get_db), user: User = Depends(require_permission("notes.create"))):
    if db.query(NoteTag).filter(NoteTag.name == data.name).first():
        raise HTTPException(status_code=400, detail="Tag already exists")
    tag = NoteTag(name=data.name, color=data.color)
    db.add(tag)
    db.commit()
    db.refresh(tag)
    broadcast_change("note", "updated")
    return tag


@router.delete("/tags/{tag_id}")
def delete_tag(tag_id: int, db: Session = Depends(get_db), user: User = Depends(require_permission("notes.delete"))):
    tag = get_or_404(NoteTag, tag_id, db)
    db.delete(tag)
    db.commit()
    broadcast_change("note", "updated")
    return {"ok": True}


@router.get("/overdue-count", response_model=int)
def overdue_count(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    return (
        db.query(Note)
        .filter(
            Note.is_completed == False,  # noqa: E712
            Note.is_archived == False,  # noqa: E712
            Note.due_date.isnot(None),
            Note.due_date <= now,
        )
        .count()
    )


@router.post("", status_code=201)
def create_note(data: NoteCreate, db: Session = Depends(get_db), user: User = Depends(require_permission("notes.create"))):
    if data.category not in VALID_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Invalid category: {data.category}")
    if data.priority not in VALID_PRIORITIES:
        raise HTTPException(status_code=400, detail=f"Invalid priority: {data.priority}")
    if data.recurrence not in VALID_RECURRENCE:
        raise HTTPException(status_code=400, detail=f"Invalid recurrence: {data.recurrence}")

    note = Note(
        title=data.title,
        body=data.body,
        category=data.category,
        priority=data.priority,
        is_pinned=data.is_pinned,
        due_date=data.due_date,
        recurrence=data.recurrence,
        recurrence_end=data.recurrence_end,
        user_id=user.id,
        assigned_to_id=data.assigned_to_id,
    )
    db.add(note)
    db.flush()

    for tag_id in data.tag_ids:
        tag = db.get(NoteTag, tag_id)
        if tag:
            db.add(NoteTagLink(note_id=note.id, tag_id=tag_id))

    for link_data in data.links:
        label = link_data.entity_label or resolve_entity_label(db, link_data.entity_type, link_data.entity_id)
        db.add(NoteLink(note_id=note.id, entity_type=link_data.entity_type, entity_id=link_data.entity_id, entity_label=label))

    db.commit()
    db.refresh(note)
    log_activity(db, user.id, user.username, "create", "note", note.id, f"Created note '{note.title}'")
    db.commit()
    broadcast_change("note", "created")
    return _serialize_note(note)


@router.get("/assignable-users")
def list_assignable_users(db: Session = Depends(get_db)):
    users = db.query(User).filter(User.is_active == True).order_by(User.username).all()  # noqa: E712
    return [{"id": u.id, "username": u.username} for u in users]


@router.get("/templates", response_model=list[NoteTemplateOut])
def list_templates(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return db.query(NoteTemplate).filter(NoteTemplate.user_id == user.id).order_by(NoteTemplate.name).all()


@router.post("/templates", response_model=NoteTemplateOut, status_code=201)
def create_template(data: NoteTemplateCreate, db: Session = Depends(get_db), user: User = Depends(require_permission("notes.create"))):
    if data.category not in VALID_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Invalid category: {data.category}")
    if data.priority not in VALID_PRIORITIES:
        raise HTTPException(status_code=400, detail=f"Invalid priority: {data.priority}")
    if data.recurrence not in VALID_RECURRENCE:
        raise HTTPException(status_code=400, detail=f"Invalid recurrence: {data.recurrence}")
    template = NoteTemplate(
        name=data.name, category=data.category, priority=data.priority,
        body=data.body, recurrence=data.recurrence, user_id=user.id,
    )
    db.add(template)
    db.commit()
    db.refresh(template)
    broadcast_change("note", "created")
    return template


@router.put("/templates/{template_id}", response_model=NoteTemplateOut)
def update_template(template_id: int, data: NoteTemplateCreate, db: Session = Depends(get_db), user: User = Depends(require_permission("notes.create"))):
    template = db.get(NoteTemplate, template_id)
    if not template or template.user_id != user.id:
        raise HTTPException(status_code=404, detail="Template not found")
    if data.category not in VALID_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Invalid category: {data.category}")
    if data.priority not in VALID_PRIORITIES:
        raise HTTPException(status_code=400, detail=f"Invalid priority: {data.priority}")
    if data.recurrence not in VALID_RECURRENCE:
        raise HTTPException(status_code=400, detail=f"Invalid recurrence: {data.recurrence}")
    template.name = data.name
    template.category = data.category
    template.priority = data.priority
    template.body = data.body
    template.recurrence = data.recurrence
    db.commit()
    db.refresh(template)
    broadcast_change("note", "updated")
    return template


@router.delete("/templates/{template_id}")
def delete_template(template_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    template = db.get(NoteTemplate, template_id)
    if not template or template.user_id != user.id:
        raise HTTPException(status_code=404, detail="Template not found")
    db.delete(template)
    db.commit()
    broadcast_change("note", "deleted")
    return {"ok": True}


@router.get("/{note_id}")
def get_note(note_id: int, db: Session = Depends(get_db)):
    note = db.query(Note).options(
        joinedload(Note.user),
        joinedload(Note.assigned_to),
        joinedload(Note.tags),
        joinedload(Note.links),
    ).filter(Note.id == note_id, Note.is_deleted == False).first()  # noqa: E712
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    return _serialize_note(note)


@router.put("/{note_id}")
def update_note(note_id: int, data: NoteUpdate, db: Session = Depends(get_db), user: User = Depends(require_permission("notes.update"))):
    note = get_or_404(Note, note_id, db)
    update_data = data.model_dump(exclude_unset=True)

    tag_ids = update_data.pop("tag_ids", None)

    if "category" in update_data and update_data["category"] not in VALID_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Invalid category: {update_data['category']}")
    if "priority" in update_data and update_data["priority"] not in VALID_PRIORITIES:
        raise HTTPException(status_code=400, detail=f"Invalid priority: {update_data['priority']}")
    if "recurrence" in update_data and update_data["recurrence"] not in VALID_RECURRENCE:
        raise HTTPException(status_code=400, detail=f"Invalid recurrence: {update_data['recurrence']}")

    if "image_url" in update_data and not update_data["image_url"] and note.image_url:
        old_path = UPLOAD_DIR / Path(note.image_url).name
        try:
            if old_path.exists():
                old_path.unlink()
        except Exception:
            pass

    for k, v in update_data.items():
        setattr(note, k, v)

    if tag_ids is not None:
        db.query(NoteTagLink).filter(NoteTagLink.note_id == note.id).delete()
        for tag_id in tag_ids:
            tag = db.get(NoteTag, tag_id)
            if tag:
                db.add(NoteTagLink(note_id=note.id, tag_id=tag_id))

    db.commit()
    db.refresh(note)
    note = db.query(Note).options(
        joinedload(Note.user),
        joinedload(Note.assigned_to),
        joinedload(Note.tags),
        joinedload(Note.links),
    ).filter(Note.id == note.id).first()
    log_activity(db, user.id, user.username, "update", "note", note.id, f"Updated note '{note.title}'")
    db.commit()
    broadcast_change("note", "updated")
    return _serialize_note(note)


@router.delete("/{note_id}")
def delete_note(note_id: int, db: Session = Depends(get_db), user: User = Depends(require_permission("notes.delete"))):
    note = get_or_404(Note, note_id, db)
    soft_delete(db, note, user, "note")
    return {"ok": True}


@router.patch("/{note_id}/complete")
def toggle_complete(note_id: int, db: Session = Depends(get_db), user: User = Depends(require_permission("notes.update"))):
    note = get_or_404(Note, note_id, db)
    note.is_completed = not note.is_completed

    if note.is_completed and note.recurrence != "none" and note.recurrence_end:
        now = datetime.now(timezone.utc)
        if note.recurrence_end > now:
            delta = {"daily": timedelta(days=1), "weekly": timedelta(weeks=1), "monthly": timedelta(days=30)}.get(note.recurrence)
            new_due = (note.due_date + delta) if note.due_date and delta else None
            new_note = Note(
                title=note.title, body=note.body, category=note.category,
                priority=note.priority, recurrence=note.recurrence,
                recurrence_end=note.recurrence_end, due_date=new_due,
                user_id=note.user_id, assigned_to_id=note.assigned_to_id,
            )
            db.add(new_note)
            db.flush()
            for link in note.links:
                db.add(NoteLink(note_id=new_note.id, entity_type=link.entity_type, entity_id=link.entity_id, entity_label=link.entity_label or ""))
            log_activity(db, user.id, user.username, "create", "note", new_note.id, f"Recurring note '{new_note.title}' created")

    db.commit()
    db.refresh(note)
    log_activity(db, user.id, user.username, "complete" if note.is_completed else "uncomplete", "note", note.id,
                 f"{'Completed' if note.is_completed else 'Uncompleted'} note '{note.title}'")
    db.commit()
    broadcast_change("note", "updated")
    return _serialize_note(note)


@router.patch("/{note_id}/pin")
def toggle_pin(note_id: int, db: Session = Depends(get_db), user: User = Depends(require_permission("notes.update"))):
    note = get_or_404(Note, note_id, db)
    note.is_pinned = not note.is_pinned
    db.commit()
    db.refresh(note)
    log_activity(db, user.id, user.username, "pin" if note.is_pinned else "unpin", "note", note.id,
                 f"{'Pinned' if note.is_pinned else 'Unpinned'} note '{note.title}'")
    db.commit()
    broadcast_change("note", "updated")
    return _serialize_note(note)


class BulkArchiveRequest(BaseModel):
    ids: list[int]
    archive: bool


class BulkUpdateRequest(BaseModel):
    ids: list[int]
    priority: str | None = None
    is_completed: bool | None = None


@router.post("/bulk-archive")
def bulk_archive(data: BulkArchiveRequest, db: Session = Depends(get_db), user: User = Depends(require_permission("notes.update"))):
    notes = db.query(Note).filter(Note.id.in_(data.ids)).all()
    for note in notes:
        note.is_archived = data.archive
    db.commit()
    action = "archive" if data.archive else "unarchive"
    for note in notes:
        log_activity(db, user.id, user.username, action, "note", note.id,
                     f"{'Archived' if data.archive else 'Unarchived'} note '{note.title}'")
    db.commit()
    broadcast_change("note", "updated")
    return {"ok": True, "count": len(notes)}


@router.post("/bulk-update")
def bulk_update(data: BulkUpdateRequest, db: Session = Depends(get_db), user: User = Depends(require_permission("notes.update"))):
    notes = db.query(Note).filter(Note.id.in_(data.ids)).all()
    if not notes:
        raise HTTPException(status_code=404, detail="No notes found")
    if data.priority is not None:
        if data.priority not in VALID_PRIORITIES:
            raise HTTPException(status_code=400, detail=f"Invalid priority: {data.priority}")
        for note in notes:
            note.priority = data.priority
    if data.is_completed is not None:
        for note in notes:
            note.is_completed = data.is_completed
    db.commit()
    for note in notes:
        log_activity(db, user.id, user.username, "update", "note", note.id,
                     f"Bulk-updated note '{note.title}'")
    db.commit()
    broadcast_change("note", "updated")
    return {"ok": True, "count": len(notes)}


@router.post("/bulk-delete")
def bulk_delete(data: BulkArchiveRequest, db: Session = Depends(get_db), user: User = Depends(require_permission("notes.delete"))):
    notes = db.query(Note).filter(Note.id.in_(data.ids)).all()
    if not notes:
        raise HTTPException(status_code=404, detail="No notes found")
    for note in notes:
        soft_delete(db, note, user, "note")
    broadcast_change("note", "deleted")
    return {"ok": True, "count": len(notes)}


@router.patch("/{note_id}/archive")
def toggle_archive(note_id: int, db: Session = Depends(get_db), user: User = Depends(require_permission("notes.update"))):
    note = get_or_404(Note, note_id, db)
    note.is_archived = not note.is_archived
    db.commit()
    db.refresh(note)
    log_activity(db, user.id, user.username, "archive" if note.is_archived else "unarchive", "note", note.id,
                 f"{'Archived' if note.is_archived else 'Unarchived'} note '{note.title}'")
    db.commit()
    broadcast_change("note", "updated")
    return _serialize_note(note)


@router.post("/{note_id}/duplicate", status_code=201)
def duplicate_note(note_id: int, db: Session = Depends(get_db), user: User = Depends(require_permission("notes.create"))):
    original = get_or_404(Note, note_id, db)
    new_note = Note(
        title=f"{original.title} (copy)", body=original.body, category=original.category,
        priority=original.priority, recurrence=original.recurrence,
        recurrence_end=original.recurrence_end, due_date=original.due_date,
        user_id=user.id, image_url=original.image_url,
    )
    db.add(new_note)
    db.flush()
    for tag_link in db.query(NoteTagLink).filter(NoteTagLink.note_id == original.id).all():
        db.add(NoteTagLink(note_id=new_note.id, tag_id=tag_link.tag_id))
    for link in original.links:
        db.add(NoteLink(note_id=new_note.id, entity_type=link.entity_type, entity_id=link.entity_id, entity_label=link.entity_label or ""))
    db.commit()
    db.refresh(new_note)
    new_note = db.query(Note).options(
        joinedload(Note.user), joinedload(Note.assigned_to),
        joinedload(Note.tags), joinedload(Note.links),
    ).filter(Note.id == new_note.id).first()
    log_activity(db, user.id, user.username, "create", "note", new_note.id, f"Duplicated note '{original.title}'")
    db.commit()
    broadcast_change("note", "created")
    return _serialize_note(new_note)


@router.post("/{note_id}/assign")
def assign_note(note_id: int, data: NoteAssign, db: Session = Depends(get_db), user: User = Depends(require_permission("notes.update"))):
    note = get_or_404(Note, note_id, db)
    if data.assigned_to_id is not None:
        assignee = db.get(User, data.assigned_to_id)
        if not assignee:
            raise HTTPException(status_code=404, detail="User not found")
    note.assigned_to_id = data.assigned_to_id
    db.commit()
    db.refresh(note)
    note = db.query(Note).options(
        joinedload(Note.user),
        joinedload(Note.assigned_to),
        joinedload(Note.tags),
        joinedload(Note.links),
    ).filter(Note.id == note.id).first()
    log_activity(db, user.id, user.username, "assign", "note", note.id,
                 f"Assigned note '{note.title}' to user {data.assigned_to_id}")
    db.commit()
    notify_note_assigned(db, note, user.username)
    broadcast_change("note", "updated")
    return _serialize_note(note)


@router.post("/{note_id}/tags")
def add_tags(note_id: int, tag_ids: list[int], db: Session = Depends(get_db), user: User = Depends(require_permission("notes.update"))):
    note = get_or_404(Note, note_id, db)
    for tag_id in tag_ids:
        tag = db.get(NoteTag, tag_id)
        if not tag:
            raise HTTPException(status_code=404, detail=f"Tag {tag_id} not found")
        existing = db.query(NoteTagLink).filter(NoteTagLink.note_id == note.id, NoteTagLink.tag_id == tag_id).first()
        if not existing:
            db.add(NoteTagLink(note_id=note.id, tag_id=tag_id))
    db.commit()
    broadcast_change("note", "updated")
    return {"ok": True}


@router.delete("/{note_id}/tags/{tag_id}")
def remove_tag(note_id: int, tag_id: int, db: Session = Depends(get_db), user: User = Depends(require_permission("notes.update"))):
    link = db.query(NoteTagLink).filter(NoteTagLink.note_id == note_id, NoteTagLink.tag_id == tag_id).first()
    if not link:
        raise HTTPException(status_code=404, detail="Tag not linked to this note")
    db.delete(link)
    db.commit()
    broadcast_change("note", "updated")
    return {"ok": True}


@router.post("/{note_id}/links", status_code=201)
def add_link(note_id: int, data: NoteLinkCreate, db: Session = Depends(get_db), user: User = Depends(require_permission("notes.update"))):
    note = get_or_404(Note, note_id, db)
    existing = db.query(NoteLink).filter(
        NoteLink.note_id == note.id,
        NoteLink.entity_type == data.entity_type,
        NoteLink.entity_id == data.entity_id,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Link already exists")
    link = NoteLink(note_id=note.id, entity_type=data.entity_type, entity_id=data.entity_id, entity_label=data.entity_label or resolve_entity_label(db, data.entity_type, data.entity_id))
    db.add(link)
    db.commit()
    db.refresh(link)
    broadcast_change("note", "updated")
    return {"id": link.id, "entity_type": link.entity_type, "entity_id": link.entity_id, "entity_label": link.entity_label}


@router.delete("/{note_id}/links/{link_id}")
def remove_link(note_id: int, link_id: int, db: Session = Depends(get_db), user: User = Depends(require_permission("notes.update"))):
    link = db.query(NoteLink).filter(NoteLink.id == link_id, NoteLink.note_id == note_id).first()
    if not link:
        raise HTTPException(status_code=404, detail="Link not found")
    db.delete(link)
    db.commit()
    broadcast_change("note", "updated")
    return {"ok": True}


@router.post("/{note_id}/upload-image")
def upload_note_image(note_id: int, file: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(require_permission("notes.update"))):
    note = get_or_404(Note, note_id, db)
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")
    content = file.file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(content) > MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=400, detail="File too large (max 10 MB)")
    detected = _detect_image_ext(content)
    if detected is None:
        raise HTTPException(status_code=400, detail="File content is not a supported image")
    if ext in JPEG_EXTENSIONS:
        matches = detected in JPEG_EXTENSIONS
    else:
        matches = detected == ext
    if not matches:
        raise HTTPException(status_code=400, detail=f"File content does not match its extension ({ext})")
    filename = f"{uuid.uuid4().hex}{detected}"
    filepath = UPLOAD_DIR / filename
    with open(filepath, "wb") as f:
        f.write(content)
    note.image_url = f"/uploads/{filename}"
    db.commit()
    broadcast_change("note", "updated")
    return {"image_url": note.image_url}


class SortOrderUpdate(BaseModel):
    sort_order: int


@router.patch("/{note_id}/sort-order")
def update_sort_order(note_id: int, data: SortOrderUpdate, db: Session = Depends(get_db), user: User = Depends(require_permission("notes.update"))):
    note = get_or_404(Note, note_id, db)
    note.sort_order = data.sort_order
    db.commit()
    broadcast_change("note", "updated")
    return {"ok": True, "sort_order": note.sort_order}
