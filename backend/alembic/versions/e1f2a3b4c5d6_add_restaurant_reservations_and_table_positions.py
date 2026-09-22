"""add restaurant reservations and table layout positions

Revision ID: e1f2a3b4c5d6
Revises: d0f1e2a3b4c5
Create Date: 2026-09-22 20:00:00.000000

``restaurant_reservations`` lets the floor book tables ahead of time with a
guest name/phone/party size, an expected arrival time and a hold duration. The
tables gain ``pos_x``/``pos_y`` so the floor map can lay out the room.
"""
from alembic import op
import sqlalchemy as sa

from app.models.types import UTCDateTime

revision = "e1f2a3b4c5d6"
down_revision = "d0f1e2a3b4c5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = insp.get_table_names()

    if "restaurant_tables" in tables:
        cols = {c["name"] for c in insp.get_columns("restaurant_tables")}
        if "pos_x" not in cols:
            op.add_column("restaurant_tables", sa.Column("pos_x", sa.Integer(), nullable=False, server_default="0"))
        if "pos_y" not in cols:
            op.add_column("restaurant_tables", sa.Column("pos_y", sa.Integer(), nullable=False, server_default="0"))

    if "restaurant_reservations" not in tables:
        op.create_table(
            "restaurant_reservations",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("reservation_number", sa.String(length=30), nullable=False, unique=True),
            sa.Column("table_id", sa.Integer(), sa.ForeignKey("restaurant_tables.id"), nullable=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("guest_name", sa.String(length=120), nullable=False),
            sa.Column("guest_phone", sa.String(length=40), nullable=False, server_default=""),
            sa.Column("guest_count", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("reserved_at", UTCDateTime(), nullable=False),
            sa.Column("duration_minutes", sa.Integer(), nullable=False, server_default="90"),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
            sa.Column("notes", sa.Text(), nullable=False, server_default=""),
            sa.Column("ticket_id", sa.Integer(), sa.ForeignKey("restaurant_tickets.id"), nullable=True),
            sa.Column("created_at", UTCDateTime(), server_default=sa.func.now(), nullable=True),
            sa.Column("updated_at", UTCDateTime(), server_default=sa.func.now(), nullable=True),
        )
        op.create_index("ix_restaurant_reservations_id", "restaurant_reservations", ["id"], unique=False)
        op.create_index("ix_restaurant_reservations_reservation_number", "restaurant_reservations", ["reservation_number"], unique=True)
        op.create_index("ix_restaurant_reservations_table_id", "restaurant_reservations", ["table_id"], unique=False)
        op.create_index("ix_restaurant_reservations_user_id", "restaurant_reservations", ["user_id"], unique=False)
        op.create_index("ix_restaurant_reservations_reserved_at", "restaurant_reservations", ["reserved_at"], unique=False)
        op.create_index("ix_restaurant_reservations_status", "restaurant_reservations", ["status"], unique=False)
        op.create_index("ix_restaurant_reservations_ticket_id", "restaurant_reservations", ["ticket_id"], unique=False)
        op.create_index("ix_restaurant_reservations_created_at", "restaurant_reservations", ["created_at"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = insp.get_table_names()

    if "restaurant_reservations" in tables:
        for idx in (
            "ix_restaurant_reservations_created_at",
            "ix_restaurant_reservations_ticket_id",
            "ix_restaurant_reservations_status",
            "ix_restaurant_reservations_reserved_at",
            "ix_restaurant_reservations_user_id",
            "ix_restaurant_reservations_table_id",
            "ix_restaurant_reservations_reservation_number",
            "ix_restaurant_reservations_id",
        ):
            op.drop_index(idx, table_name="restaurant_reservations")
        op.drop_table("restaurant_reservations")

    if "restaurant_tables" in tables:
        cols = {c["name"] for c in insp.get_columns("restaurant_tables")}
        if "pos_y" in cols:
            op.drop_column("restaurant_tables", "pos_y")
        if "pos_x" in cols:
            op.drop_column("restaurant_tables", "pos_x")