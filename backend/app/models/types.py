from datetime import timezone

from sqlalchemy import DateTime
from sqlalchemy.types import TypeDecorator


class UTCDateTime(TypeDecorator):
    """DateTime that stores naive UTC but returns timezone-aware UTC.

    Values are persisted in UTC without an offset marker (matching the
    existing SQLite storage format), and read back as aware UTC so the API
    always serializes timestamps with a timezone, e.g. ``2026-08-05T12:50:09+00:00``.
    Browsers then convert them to the viewer's local time (e.g. Nairobi, UTC+3).
    """

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is not None:
            value = value.astimezone(timezone.utc)
            return value.replace(tzinfo=None)
        return value

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
