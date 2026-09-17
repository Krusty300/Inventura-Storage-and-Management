"""Add supplier delivery notes / special instructions columns to orders.

Revision ID: a5b6c7d8e9f0
Revises: c6d7e8f9a0b1
Create Date: 2026-09-17
"""
from alembic import op
import sqlalchemy as sa

revision = "a5b6c7d8e9f0"
down_revision = "c6d7e8f9a0b1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "orders" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("orders")}
    with op.batch_alter_table("orders") as batch_op:
        if "supplier_delivery_notes" not in cols:
            batch_op.add_column(sa.Column("supplier_delivery_notes", sa.Text(), nullable=False, server_default=""))
        if "supplier_instructions" not in cols:
            batch_op.add_column(sa.Column("supplier_instructions", sa.Text(), nullable=False, server_default=""))


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "orders" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("orders")}
    with op.batch_alter_table("orders") as batch_op:
        if "supplier_delivery_notes" in cols:
            batch_op.drop_column("supplier_delivery_notes")
        if "supplier_instructions" in cols:
            batch_op.drop_column("supplier_instructions")