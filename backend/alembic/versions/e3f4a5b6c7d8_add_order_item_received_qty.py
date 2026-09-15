"""add order item received quantity

Revision ID: e3f4a5b6c7d8
Revises: f2a9b8c7d6e5
Create Date: 2026-09-14 10:00:00.000000

Adds received_qty to order_items so partial deliveries record how many units
were actually received against each ordered line.
"""
from alembic import op
import sqlalchemy as sa

revision = "e3f4a5b6c7d8"
down_revision = "f2a9b8c7d6e5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "order_items" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("order_items")}
    if "received_qty" not in cols:
        op.add_column(
            "order_items",
            sa.Column("received_qty", sa.Integer(), nullable=False, server_default="0"),
        )


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "order_items" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("order_items")}
    if "received_qty" in cols:
        op.drop_column("order_items", "received_qty")