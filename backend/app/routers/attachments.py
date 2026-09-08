import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Attachment
from app.models.user import User
from app.schemas.attachment import AttachmentDocumentOut, AttachmentOut
from app.services.auth import get_current_user
from app.services.permissions import permissions_for_user
from app.services.soft_delete import register, soft_delete
from app.utils import broadcast_change, get_or_404, log_activity

router = APIRouter(prefix="/api/attachments", tags=["attachments"])


def _purge_attachment(db: Session, att: Attachment, user) -> None:
    filepath = DOC_DIR / att.storage_filename
    try:
        if filepath.exists():
            filepath.unlink()
    except Exception:
        pass
    db.delete(att)


register("attachment", Attachment, lambda a: a.doc_key, _purge_attachment)

DOC_DIR = Path(__file__).resolve().parent.parent / "documents"
os.makedirs(DOC_DIR, exist_ok=True)

# Supported document extensions: previewable formats (images, PDF) plus a broad
# set of office / text documents that can be uploaded and downloaded. Preview is
# only possible in-browser for images, PDF and plain text; the rest fall back to
# a download with an appropriate file icon.
ALLOWED_EXTENSIONS = {
    ".pdf",
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg",
    ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".txt", ".csv", ".rtf", ".md",
}
IMG_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"}
JPEG_EXTENSIONS = {".jpg", ".jpeg"}
# ZIP-based OOXML (docx/xlsx/pptx) and legacy OLE compound (doc/xls/ppt).
ZIP_EXTENSIONS = {".docx", ".xlsx", ".pptx"}
OLE_EXTENSIONS = {".doc", ".xls", ".ppt"}
TEXT_EXTENSIONS = {".txt", ".csv", ".rtf", ".md"}
MAX_UPLOAD_SIZE = 20 * 1024 * 1024

MIME_BY_EXT = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".txt": "text/plain",
    ".csv": "text/csv",
    ".rtf": "application/rtf",
    ".md": "text/markdown",
}

# Polymorphic entity types that can carry attachments, mapped to the
# permissions that grant viewing / uploading(+deleting) their documents.
# ``dashboard`` is a general-purpose document store: every user with dashboard
# access can add/access it quickly.
SUPPORTED_ENTITIES = {
    "product", "order", "quality_check", "customer", "supplier", "receipt", "dashboard",
    "asn", "sale",
}
ENTITY_VIEW_PERMISSION = {
    "product": "products.view",
    "order": "orders.view",
    "quality_check": "quality_checks.view",
    "customer": "customers.view",
    "supplier": "suppliers.view",
    "receipt": "receipts.view",
    "dashboard": "dashboard.view",
    "asn": "asns.view",
    "sale": "sales.view",
}
ENTITY_UPLOAD_PERMISSION = {
    "product": "products.update",
    "order": "orders.update",
    "quality_check": "quality_checks.update",
    "customer": "customers.update",
    "supplier": "suppliers.update",
    "receipt": "receipts.create",
    "dashboard": "dashboard.view",
    "asn": "asns.create",
    "sale": "sales.create",
}


def require_entity_permission(perm_map: dict[str, str]):
    """Dependency factory for entity-scoped routes: resolves ``entity_type``
    from the path and checks the matching permission."""

    def checker(request: Request, user: User = Depends(get_current_user)) -> User:
        entity_type = request.path_params.get("entity_type")
        perm = perm_map.get(entity_type)
        if perm is None:
            raise HTTPException(status_code=400, detail=f"Unsupported entity type: {entity_type}")
        if perm not in permissions_for_user(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user

    return checker


def require_attachment_permission(perm_map: dict[str, str]):
    """Dependency factory for attachment-id routes: loads the attachment (its
    entity type drives the required permission) and stores it on request state."""

    def checker(attachment_id: int, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> User:
        att = get_or_404(Attachment, attachment_id, db)
        request.state.attachment = att
        perm = perm_map.get(att.entity_type)
        if perm is None:
            raise HTTPException(status_code=400, detail=f"Unsupported entity type: {att.entity_type}")
        if perm not in permissions_for_user(user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user

    return checker


def _detect_doc_ext(data: bytes) -> str | None:
    """Return the real extension from magic bytes, or None if unsupported.

    ``None`` means the content cannot be positively identified as a supported
    type. Text formats (.txt/.csv/.rtf/.md) are treated as a family: they are
    validated separately by ``_validate_doc`` because they have no single magic
    signature.
    """
    if data[:5] == b"%PDF-":
        return ".pdf"
    if data.startswith(b"PK\x03\x04"):
        return ".zip-ooxml"  # docx / xlsx / pptx
    if data.startswith(b"\xd0\xcf\x11\xe0"):
        return ".ole"  # doc / xls / ppt
    from app.utils import detect_image_ext
    detected = detect_image_ext(data)
    if detected in IMG_EXTENSIONS:
        return detected
    if b"<svg" in data[:1024]:
        return ".svg"
    return None


def _detect_text(data: bytes) -> bool:
    """Heuristic: content is readable plain text (no NUL / excess control bytes)."""
    if not data:
        return False
    sample = data[:4096]
    if b"\x00" in sample or b"\xff\xfe" in sample or b"\xfe\xff" in sample:
        return False
    # Reject if a large proportion are non-printable control bytes.
    non_printable = sum(1 for b in sample if b < 0x20 and b not in (0x09, 0x0A, 0x0D))
    return non_printable / len(sample) < 0.15


def _resolve_ext(ext: str, detected: str, data: bytes) -> str | None:
    """Cross-check a claimed extension against its detected family and return
    the canonical single extension used for storage, or None on mismatch."""
    if ext in IMG_EXTENSIONS:
        return detected if detected in IMG_EXTENSIONS else None
    if ext == ".pdf":
        return detected if detected == ".pdf" else None
    if ext in ZIP_EXTENSIONS:
        # docx/xlsx/pptx are all ZIP-based; accept any known ooxml ext.
        return ext if detected == ".zip-ooxml" else None
    if ext in OLE_EXTENSIONS:
        return ext if detected == ".ole" else None
    if ext in TEXT_EXTENSIONS:
        # No magic signature; rely on the text heuristic and the claimed ext.
        return ext if _detect_text(data) else None
    return None


def _validate_doc(file: UploadFile) -> tuple[bytes, str]:
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")
    content = file.file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(content) > MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=400, detail="File too large (max 20 MB)")
    detected = _detect_doc_ext(content)
    resolved = _resolve_ext(ext, detected, content)
    if resolved is None:
        raise HTTPException(status_code=400, detail="File content is not a supported document")
    return content, resolved


# --- Attachment-id routes (literal /entry/ prefix, registered first so the
# generic {entity_type}/{entity_id} routes never shadow them) ---


@router.get("/entry/{attachment_id}/download")
def download_attachment(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_attachment_permission(ENTITY_VIEW_PERMISSION)),
):
    att: Attachment = request.state.attachment
    filepath = DOC_DIR / att.storage_filename
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="File not found")
    media_type = att.content_type or "application/octet-stream"
    return FileResponse(
        path=str(filepath),
        media_type=media_type,
        filename=Path(att.original_filename).name,
    )


@router.delete("/entry/{attachment_id}")
def delete_attachment(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_attachment_permission(ENTITY_UPLOAD_PERMISSION)),
):
    att: Attachment = request.state.attachment
    soft_delete(db, att, user, "attachment")
    broadcast_change(att.entity_type, "updated")
    return {"ok": True}


# --- Entity-scoped routes ---


@router.get("/{entity_type}/{entity_id}", response_model=list[AttachmentDocumentOut])
def list_attachments(
    entity_type: str,
    entity_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_entity_permission(ENTITY_VIEW_PERMISSION)),
):
    if entity_type not in SUPPORTED_ENTITIES:
        raise HTTPException(status_code=400, detail=f"Unsupported entity type: {entity_type}")
    rows = (
        db.query(Attachment)
        .filter(
            Attachment.entity_type == entity_type,
            Attachment.entity_id == entity_id,
            Attachment.is_deleted == False,  # noqa: E712
        )
        .order_by(Attachment.doc_key, Attachment.version)
        .all()
    )
    return _group_documents(rows)


@router.get("/{entity_type}/{entity_id}/{doc_key}", response_model=list[AttachmentOut])
def list_document_versions(
    entity_type: str,
    entity_id: int,
    doc_key: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_entity_permission(ENTITY_VIEW_PERMISSION)),
):
    if entity_type not in SUPPORTED_ENTITIES:
        raise HTTPException(status_code=400, detail=f"Unsupported entity type: {entity_type}")
    rows = (
        db.query(Attachment)
        .filter(
            Attachment.entity_type == entity_type,
            Attachment.entity_id == entity_id,
            Attachment.doc_key == doc_key,
            Attachment.is_deleted == False,  # noqa: E712
        )
        .order_by(Attachment.version)
        .all()
    )
    return [_attachment_out(a) for a in rows]


@router.post("/{entity_type}/{entity_id}", response_model=AttachmentOut)
def upload_attachment(
    entity_type: str,
    entity_id: int,
    file: UploadFile = File(...),
    doc_key: str = Form(""),
    db: Session = Depends(get_db),
    user: User = Depends(require_entity_permission(ENTITY_UPLOAD_PERMISSION)),
):
    if entity_type not in SUPPORTED_ENTITIES:
        raise HTTPException(status_code=400, detail=f"Unsupported entity type: {entity_type}")
    content, detected = _validate_doc(file)
    key = (doc_key or Path(file.filename or "upload").name).strip() or "upload"
    next_version = (
        db.query(func.coalesce(func.max(Attachment.version), 0))
        .filter(
            Attachment.entity_type == entity_type,
            Attachment.entity_id == entity_id,
            Attachment.doc_key == key,
        )
        .scalar()
    ) + 1
    storage_name = f"{uuid.uuid4().hex}{detected}"
    filepath = DOC_DIR / storage_name
    with open(filepath, "wb") as f:
        f.write(content)

    att = Attachment(
        entity_type=entity_type,
        entity_id=entity_id,
        doc_key=key,
        version=next_version,
        original_filename=file.filename or storage_name,
        storage_filename=storage_name,
        content_type=MIME_BY_EXT.get(detected, "application/octet-stream"),
        size=len(content),
        uploaded_by=user.id,
    )
    db.add(att)
    db.commit()
    db.refresh(att)
    log_activity(
        db, user.id, user.username, "upload",
        entity_type=entity_type, entity_id=entity_id,
        description=f"Uploaded document '{key}' v{next_version}",
    )
    broadcast_change(entity_type, "updated")
    return _attachment_out(att)


def _attachment_out(att: Attachment) -> AttachmentOut:
    out = AttachmentOut.model_validate(att)
    if att.uploader:
        out.username = att.uploader.username
    # Authenticated download route (frontend fetches a blob with the bearer
    # token and derives the original filename from Content-Disposition).
    out.url = f"/api/attachments/entry/{att.id}/download"
    return out


def _group_documents(rows: list[Attachment]) -> list[AttachmentDocumentOut]:
    grouped: dict[str, list[Attachment]] = {}
    order: list[str] = []
    for a in rows:
        if a.doc_key not in grouped:
            grouped[a.doc_key] = []
            order.append(a.doc_key)
        grouped[a.doc_key].append(a)
    result: list[AttachmentDocumentOut] = []
    for key in order:
        versions = grouped[key]
        latest = max(versions, key=lambda v: v.version)
        result.append(
            AttachmentDocumentOut(
                doc_key=key,
                version=latest.version,
                created_at=latest.created_at,
                uploaded_by=latest.uploaded_by,
                username=_attachment_out(latest).username,
                current=_attachment_out(latest),
                versions=[_attachment_out(v) for v in versions],
            )
        )
    return result
