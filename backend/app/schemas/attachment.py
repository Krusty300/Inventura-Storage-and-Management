from datetime import datetime

from pydantic import BaseModel, ConfigDict


class AttachmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    entity_type: str
    entity_id: int
    doc_key: str
    version: int
    original_filename: str
    content_type: str
    size: int
    uploaded_by: int | None = None
    username: str = ""
    created_at: datetime
    url: str = ""


class AttachmentVersionOut(AttachmentOut):
    pass


class AttachmentDocumentOut(BaseModel):
    """One document group with its version history and the current version."""

    doc_key: str
    version: int
    created_at: datetime
    uploaded_by: int | None = None
    username: str = ""
    current: AttachmentOut
    versions: list[AttachmentVersionOut] = []


class AttachmentMetadataUpdate(BaseModel):
    doc_key: str | None = None
