"""create restaurant shift closes table

Revision ID: d1e2f3a4b5c6
Revises: c1d2e3f4a5b6
Create Date: 2026-09-26 13:00:00.000000

Cash-drawer reconciliation for restaurant shifts: one row per cashier close with
the expected/banked cash and the variance.
"""
from alembic import op
import sqlalchemy as sa
from app.models.types import UTCDateTime

revision = "d1e2f3a4b5c6"
down_revision = "c1d2e3f4a5b6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "restaurant_shift_closes" in insp.get_table_names():
        return
    op.create_table(
        "restaurant_shift_closes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("period_start", UTCDateTime(), nullable=False),
        sa.Column("period_end", UTCDateTime(), nullable=False),
        sa.Column("ticket_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_sales", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("expected_cash", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("counted_cash", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("variance", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("cash_tips", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("breakdown", sa.JSON(), nullable=True),
        sa.Column("notes", sa.String(300), nullable=False, server_default=""),
        sa.Column("created_at", UTCDateTime(), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_restaurant_shift_closes_id", "restaurant_shift_closes", ["id"])
    op.create_index("ix_restaurant_shift_closes_user_id", "restaurant_shift_closes", ["user_id"])
    op.create_index("ix_restaurant_shift_closes_created_at", "restaurant_shift_closes", ["created_at"])


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "restaurant_shift_closes" not in insp.get_table_names():
        return
    op.drop_table("restaurant_shift_closes")
