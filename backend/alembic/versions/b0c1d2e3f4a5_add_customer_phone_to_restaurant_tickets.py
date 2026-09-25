"""add customer phone to restaurant tickets

Revision ID: b0c1d2e3f4a5
Revises: ab1c2d3e4f50
Create Date: 2026-09-25 12:00:00.000000

``restaurant_tickets`` gains ``customer_phone`` so dine-in, reservation and
guest-QR tickets carry a look-up phone that settlement can use to attribute
the resulting sale to a ``Customer`` (and pick the right sales channel).
"""
from alembic import op
import sqlalchemy as sa

revision = "b0c1d2e3f4a5"
down_revision = "ab1c2d3e4f50"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = insp.get_table_names()
    if "restaurant_tickets" in tables:
        cols = {c["name"] for c in insp.get_columns("restaurant_tickets")}
        if "customer_phone" not in cols:
            op.add_column("restaurant_tickets", sa.Column("customer_phone", sa.String(40), nullable=False, server_default=""))


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = insp.get_table_names()
    if "restaurant_tickets" in tables:
        cols = {c["name"] for c in insp.get_columns("restaurant_tickets")}
        if "customer_phone" in cols:
            op.drop_column("restaurant_tickets", "customer_phone")