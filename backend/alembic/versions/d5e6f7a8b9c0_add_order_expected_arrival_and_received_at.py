"""add order expected_arrival and received_at

Revision ID: d5e6f7a8b9c0
Revises: d4e6f8a9b0c1
Create Date: 2026-09-09 12:00:00.000000

Adds ``expected_arrival`` (target delivery datetime, powers the overdue
display on pending orders) and ``received_at`` (set server-side when a
purchase order is marked received) to the orders table, mirroring the ASN
fields that already track incoming shipments.
"""
from alembic import op
import sqlalchemy as sa

from app.models.types import UTCDateTime

revision = "d5e6f7a8b9c0"
down_revision = "d4e6f8a9b0c1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "orders" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("orders")}
    if "expected_arrival" not in cols:
        op.add_column("orders", sa.Column("expected_arrival", UTCDateTime(), nullable=True))
        op.create_index("ix_orders_expected_arrival", "orders", ["expected_arrival"], unique=False)
    if "received_at" not in cols:
        op.add_column("orders", sa.Column("received_at", UTCDateTime(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "orders" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("orders")}
    if "expected_arrival" in cols:
        op.drop_index("ix_orders_expected_arrival", table_name="orders")
        op.drop_column("orders", "expected_arrival")
    if "received_at" in cols:
        op.drop_column("orders", "received_at")