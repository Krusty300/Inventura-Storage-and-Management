"""add user supplier id

Revision ID: f9a1b2c3d4e5
Revises: e3f4a5b6c7d8
Create Date: 2026-09-14 14:00:00.000000

Adds a nullable suppliers FK on users so a supplier login account (role
``supplier``) can be linked to the company it represents. Portal endpoints
scope by this column.
"""
from alembic import op
import sqlalchemy as sa

revision = "f9a1b2c3d4e5"
down_revision = "e3f4a5b6c7d8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "users" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("users")}
    if "supplier_id" not in cols:
        op.add_column(
            "users",
            sa.Column(
                "supplier_id",
                sa.Integer(),
                sa.ForeignKey("suppliers.id"),
                nullable=True,
            ),
        )
        op.create_index("ix_users_supplier_id", "users", ["supplier_id"])


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "users" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("users")}
    if "supplier_id" in cols:
        op.drop_column("users", "supplier_id")