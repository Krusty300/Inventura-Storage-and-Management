"""add user customer id

Revision ID: d2e3f4a5b6c7
Revises: a5b6c7d8e9f0
Create Date: 2026-09-19 09:00:00.000000

Adds a nullable customers FK on users so a customer login account (role
``customer``) can be linked to the company it represents. Portal endpoints
scope by this column.
"""
from alembic import op
import sqlalchemy as sa

revision = "d2e3f4a5b6c7"
down_revision = "a5b6c7d8e9f0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "users" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("users")}
    if "customer_id" not in cols:
        op.add_column(
            "users",
            sa.Column(
                "customer_id",
                sa.Integer(),
                sa.ForeignKey("customers.id"),
                nullable=True,
            ),
        )
        op.create_index("ix_users_customer_id", "users", ["customer_id"])


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "users" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("users")}
    if "customer_id" in cols:
        op.drop_column("users", "customer_id")