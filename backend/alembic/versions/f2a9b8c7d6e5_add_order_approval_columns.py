"""add order approval columns

Revision ID: f2a9b8c7d6e5
Revises: f7a8b9c0d1e2
Create Date: 2026-09-14 09:00:00.000000

Adds approved_by / approved_at columns to the orders table to support the
pending -> submitted -> approved -> received procurement workflow.
"""
from alembic import op
import sqlalchemy as sa

revision = "f2a9b8c7d6e5"
down_revision = "f7a8b9c0d1e2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "orders" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("orders")}
    if "approved_by" not in cols:
        op.add_column("orders", sa.Column("approved_by", sa.Integer(), nullable=True))
        op.create_index("ix_orders_approved_by", "orders", ["approved_by"])
    if "approved_at" not in cols:
        op.add_column("orders", sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "orders" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("orders")}
    if "approved_at" in cols:
        op.drop_column("orders", "approved_at")
    if "approved_by" in cols:
        op.drop_index("ix_orders_approved_by", table_name="orders")
        op.drop_column("orders", "approved_by")