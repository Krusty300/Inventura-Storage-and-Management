"""add ready/served turn times to restaurant ticket items

Revision ID: b1c2d3e4f5a6
Revises: a6f7b8c9d0e1
Create Date: 2026-09-26 12:00:00.000000

``restaurant_ticket_items`` gains ``ready_at`` and ``served_at`` next to the
existing ``sent_at`` so kitchen turn times (sent -> ready -> served) can be
measured per item instead of being inferred from ticket state.
"""
from alembic import op
import sqlalchemy as sa
from app.models.types import UTCDateTime

revision = "b1c2d3e4f5a6"
down_revision = "a6f7b8c9d0e1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "restaurant_ticket_items" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("restaurant_ticket_items")}
    for name in ("ready_at", "served_at"):
        if name not in cols:
            op.add_column("restaurant_ticket_items", sa.Column(name, UTCDateTime(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "restaurant_ticket_items" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("restaurant_ticket_items")}
    for name in ("ready_at", "served_at"):
        if name in cols:
            op.drop_column("restaurant_ticket_items", name)
