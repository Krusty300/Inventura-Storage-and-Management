"""Add supplier portal preferences JSON column.

Revision ID: c6d7e8f9a0b1
Revises: b2c3d4e5f6a7
Create Date: 2026-09-15
"""
from alembic import op
import sqlalchemy as sa

revision = "c6d7e8f9a0b1"
down_revision = "b2c3d4e5f6a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("suppliers") as batch_op:
        batch_op.add_column(sa.Column("preferences", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("suppliers") as batch_op:
        batch_op.drop_column("preferences")