"""Shared helpers for resolving/creating well-known sales channels.

Restaurant settlements and portal checkouts attribute each sale to a channel so
reports and the dashboard can break revenue down consistently. Channels used by
hosted flows are created lazily (get-or-create) so they work on any database,
including one seeded before these names existed.
"""
from sqlalchemy.orm import Session

from app.models.sales_channel import SalesChannel

RESTAURANT_DINE_IN_CHANNEL = "Restaurant (Dine-in)"
RESTAURANT_GUEST_ORDER_CHANNEL = "Restaurant (Guest Order)"
ONLINE_STORE_CHANNEL = "Online Store"


def get_or_create_channel(db: Session, *, name: str, type: str) -> SalesChannel:
    ch = (
        db.query(SalesChannel)
        .filter(SalesChannel.name == name, SalesChannel.is_deleted == False)  # noqa: E712
        .first()
    )
    if ch is None:
        ch = SalesChannel(name=name, type=type, is_active=True)
        db.add(ch)
        db.flush()
    return ch