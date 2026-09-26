"""add guest token to restaurant tickets

Revision ID: a6f7b8c9d0e1
Revises: b0c1d2e3f4a5
Create Date: 2026-09-26 09:00:00.000000

``restaurant_tickets`` gains a per-order ``guest_token`` so the unauthenticated
QR guest flow polls order status by an unguessable token instead of a
sequential ticket ``id`` (which leaked guest names/phones to anyone who could
enumerate ids).
"""
from alembic import op
import sqlalchemy as sa

revision = "a6f7b8c9d0e1"
down_revision = "b0c1d2e3f4a5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = insp.get_table_names()
    if "restaurant_tickets" in tables:
        cols = {c["name"] for c in insp.get_columns("restaurant_tickets")}
        if "guest_token" not in cols:
            op.add_column("restaurant_tickets", sa.Column("guest_token", sa.String(80), nullable=True))
            op.create_index("ix_restaurant_tickets_guest_token", "restaurant_tickets", ["guest_token"])


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = insp.get_table_names()
    if "restaurant_tickets" in tables:
        cols = {c["name"] for c in insp.get_columns("restaurant_tickets")}
        if "guest_token" in cols:
            op.drop_index("ix_restaurant_tickets_guest_token", table_name="restaurant_tickets")
            op.drop_column("restaurant_tickets", "guest_token")