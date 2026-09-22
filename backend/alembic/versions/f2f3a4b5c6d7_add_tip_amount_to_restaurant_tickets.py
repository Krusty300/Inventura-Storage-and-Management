"""add tip amount to restaurant tickets

Revision ID: f2f3a4b5c6d7
Revises: e1f2a3b4c5d6
Create Date: 2026-09-22 21:00:00.000000

``restaurant_tickets`` gains a ``tip_amount`` so the POS can record a gratuity
at settlement and show it on the printed bill.
"""
from alembic import op
import sqlalchemy as sa

revision = "f2f3a4b5c6d7"
down_revision = "e1f2a3b4c5d6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = insp.get_table_names()
    if "restaurant_tickets" in tables:
        cols = {c["name"] for c in insp.get_columns("restaurant_tickets")}
        if "tip_amount" not in cols:
            op.add_column("restaurant_tickets", sa.Column("tip_amount", sa.Numeric(10, 2), nullable=False, server_default="0.00"))


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = insp.get_table_names()
    if "restaurant_tickets" in tables:
        cols = {c["name"] for c in insp.get_columns("restaurant_tickets")}
        if "tip_amount" in cols:
            op.drop_column("restaurant_tickets", "tip_amount")