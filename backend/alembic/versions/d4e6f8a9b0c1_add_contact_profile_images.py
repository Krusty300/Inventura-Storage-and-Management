"""add profile image columns to customers and suppliers

Revision ID: d4e6f8a9b0c1
Revises: c3d5e6f7a8b9
Create Date: 2026-09-09 12:00:00.000000

Adds a single ``image_url`` column to ``customers`` and ``suppliers`` so each
contact can carry one profile picture / company logo uploaded via the detail
slide-over.
"""
from alembic import op
import sqlalchemy as sa

revision = "d4e6f8a9b0c1"
down_revision = "c3d5e6f7a8b9"
branch_labels = None
depends_on = None

_TABLES = ("customers", "suppliers")


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    existing = set(insp.get_table_names())
    for table in _TABLES:
        if table not in existing:
            continue
        cols = {c["name"] for c in insp.get_columns(table)}
        if "image_url" not in cols:
            op.add_column(table, sa.Column("image_url", sa.String(length=500), nullable=False, server_default=""))


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    existing = set(insp.get_table_names())
    for table in _TABLES:
        if table not in existing:
            continue
        cols = {c["name"] for c in insp.get_columns(table)}
        if "image_url" in cols:
            op.drop_column(table, "image_url")