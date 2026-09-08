from datetime import datetime

from sqlalchemy import ForeignKey, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import SoftDeleteMixin
from app.models.types import UTCDateTime


class Attachment(SoftDeleteMixin, Base):
    """A document version attached to any entity (products, orders, quality
    checks, customers, suppliers, receipts) via a polymorphic
    ``entity_type`` + ``entity_id`` pair.

    Versioning is per document group: ``(entity_type, entity_id, doc_key)``.
    Re-uploading a document with the same ``doc_key`` (defaults to the
    original filename) creates the next ``version``; the highest version is
    the current one. Different ``doc_key`` values are independent documents.
    """

    __tablename__ = "attachments"
    __table_args__ = (
        Index("ix_attachments_entity", "entity_type", "entity_id"),
        Index("ix_attachments_doc", "entity_type", "entity_id", "doc_key"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    entity_type: Mapped[str] = mapped_column(String(50), nullable=False)
    entity_id: Mapped[int] = mapped_column(Integer, nullable=False)
    doc_key: Mapped[str] = mapped_column(String(255), nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_filename: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    content_type: Mapped[str] = mapped_column(String(255), nullable=False)
    size: Mapped[int] = mapped_column(Integer, default=0)
    uploaded_by: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now())

    uploader = relationship("User", foreign_keys=[uploaded_by], back_populates="attachments")
