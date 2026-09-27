"""add service request flags to restaurant tables

Revision ID: c1d2e3f4a5b6
Revises: b1c2d3e4f5a6
Create Date: 2026-09-26 12:30:00.000000

``restaurant_tables`` gains ``service_requested_at`` / ``service_request`` so a
guest tapping "Call waiter" or "Request bill" on the QR menu raises a flag the
floor can see (and clear) without inventing a new queue table.
"""
from alembic import op
import sqlalchemy as sa
from app.models.types import UTCDateTime

revision = "c1d2e3f4a5b6"
down_revision = "b1c2d3e4f5a6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "restaurant_tables" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("restaurant_tables")}
    if "service_requested_at" not in cols:
        op.add_column("restaurant_tables", sa.Column("service_requested_at", UTCDateTime(), nullable=True))
    if "service_request" not in cols:
        op.add_column("restaurant_tables", sa.Column("service_request", sa.String(120), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "restaurant_tables" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("restaurant_tables")}
    for name in ("service_request", "service_requested_at"):
        if name in cols:
            op.drop_column("restaurant_tables", name)
