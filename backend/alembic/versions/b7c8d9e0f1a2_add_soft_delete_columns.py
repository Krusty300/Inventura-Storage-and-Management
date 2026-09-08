"""add soft delete columns

Revision ID: b7c8d9e0f1a2
Revises: a1b2c3d4e5f6
Create Date: 2026-09-08 09:00:00.000000

Adds ``is_deleted`` / ``deleted_at`` soft-delete columns to the master-data
entities so deletes can be trashed and restored instead of permanently
removing rows.
"""
from alembic import op
import sqlalchemy as sa

from app.models.types import UTCDateTime

revision = "b7c8d9e0f1a2"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None

_TABLES = (
    "products",
    "categories",
    "customers",
    "customer_groups",
    "suppliers",
    "locations",
    "lots",
    "serial_numbers",
    "lpns",
    "boms",
    "kits",
    "price_lists",
    "promotions",
    "sales_channels",
    "work_orders",
    "cycle_counts",
    "quality_checks",
    "users",
    "notes",
    "attachments",
)


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    for table in _TABLES:
        if table not in insp.get_table_names():
            continue
        cols = {c["name"] for c in insp.get_columns(table)}
        if "is_deleted" not in cols:
            op.add_column(table, sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()))
            op.create_index(f"ix_{table}_is_deleted", table, ["is_deleted"], unique=False)
        if "deleted_at" not in cols:
            op.add_column(table, sa.Column("deleted_at", UTCDateTime(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    for table in _TABLES:
        if table not in insp.get_table_names():
            continue
        cols = {c["name"] for c in insp.get_columns(table)}
        if "is_deleted" in cols:
            op.drop_index(f"ix_{table}_is_deleted", table_name=table)
            op.drop_column(table, "is_deleted")
        if "deleted_at" in cols:
            op.drop_column(table, "deleted_at")