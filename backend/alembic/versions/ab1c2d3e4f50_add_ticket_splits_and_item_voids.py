"""add ticket splits and item voids

Revision ID: ab1c2d3e4f50
Revises: f2f3a4b5c6d7
Create Date: 2026-09-24 10:00:00.000000

``restaurant_tickets`` gains a ``split_group`` to group a check split into
multiple bills, plus ``split_parent_id`` so split tickets can be traced back
to their origin. ``restaurant_ticket_items`` gains void audit columns so an
item can be voided (removed from the bill with a reason) after it has already
been sent to the kitchen.
"""
from alembic import op
import sqlalchemy as sa

from app.models.types import UTCDateTime

revision = "ab1c2d3e4f50"
down_revision = "f2f3a4b5c6d7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = insp.get_table_names()
    if "restaurant_tickets" in tables:
        cols = {c["name"] for c in insp.get_columns("restaurant_tickets")}
        if "split_group" not in cols:
            op.add_column("restaurant_tickets", sa.Column("split_group", sa.String(40), nullable=True))
            op.create_index("ix_restaurant_tickets_split_group", "restaurant_tickets", ["split_group"])
        if "split_parent_id" not in cols:
            op.add_column("restaurant_tickets", sa.Column("split_parent_id", sa.Integer(), sa.ForeignKey("restaurant_tickets.id", ondelete="SET NULL"), nullable=True))
    if "restaurant_ticket_items" in tables:
        cols = {c["name"] for c in insp.get_columns("restaurant_ticket_items")}
        if "voided_by" not in cols:
            op.add_column("restaurant_ticket_items", sa.Column("voided_by", sa.Integer(), nullable=True))
        if "voided_at" not in cols:
            op.add_column("restaurant_ticket_items", sa.Column("voided_at", UTCDateTime(), nullable=True))
        if "void_reason" not in cols:
            op.add_column("restaurant_ticket_items", sa.Column("void_reason", sa.Text(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = insp.get_table_names()
    if "restaurant_tickets" in tables:
        cols = {c["name"] for c in insp.get_columns("restaurant_tickets")}
        if "split_group" in cols:
            op.drop_index("ix_restaurant_tickets_split_group", table_name="restaurant_tickets")
            op.drop_column("restaurant_tickets", "split_group")
        if "split_parent_id" in cols:
            op.drop_column("restaurant_tickets", "split_parent_id")
    if "restaurant_ticket_items" in tables:
        cols = {c["name"] for c in insp.get_columns("restaurant_ticket_items")}
        if "void_reason" in cols:
            op.drop_column("restaurant_ticket_items", "void_reason")
        if "voided_at" in cols:
            op.drop_column("restaurant_ticket_items", "voided_at")
        if "voided_by" in cols:
            op.drop_column("restaurant_ticket_items", "voided_by")