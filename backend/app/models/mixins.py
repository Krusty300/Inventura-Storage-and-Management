"""Reusable SQLAlchemy mixins shared across models."""

from datetime import datetime

from sqlalchemy.orm import Mapped, mapped_column

from app.models.types import UTCDateTime


class SoftDeleteMixin:
    """Adds soft-delete columns to a model.

    Soft-deleted rows keep their data (and references) intact so they can be
    restored from the Trash. ``is_deleted`` marks the row as gone and
    ``deleted_at`` records when it happened. Active queries filter on
    ``is_deleted == False``; the Trash surface queries ``is_deleted == True``.
    """

    is_deleted: Mapped[bool] = mapped_column(default=False, index=True)
    deleted_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)