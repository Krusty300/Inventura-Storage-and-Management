"""add shift close drawer columns

Revision ID: h2i3j4k5l6m7
Revises: g1h2i3j4k5l6
Create Date: 2026-09-29 10:00:00.000000

A cash-drawer reconciliation only makes sense if the drawer contents are known:
what the cashier started with, what came in as pay-ins, and what left as
pay-outs. Previously the drawer total was only ``counted`` vs the cash sales
recorded in the window, so a drawer that started with a float looked short by
exactly that float on every close.

Also records ``cash_sales`` (the cash part of the sales total, excluding tips)
so the arithmetic behind ``expected_cash`` stays auditable:
``expected = opening_float + paid_in - paid_out + cash_sales + cash_tips``.
"""
from alembic import op
import sqlalchemy as sa

revision = "h2i3j4k5l6m7"
down_revision = "g1h2i3j4k5l6"
branch_labels = None
depends_on = None

_COLUMNS = (
    ("cash_sales", sa.Numeric(12, 2)),
    ("opening_float", sa.Numeric(12, 2)),
    ("paid_in", sa.Numeric(12, 2)),
    ("paid_out", sa.Numeric(12, 2)),
)


def upgrade() -> None:
    bind = op.get_bind()
    existing = {c["name"] for c in sa.inspect(bind).get_columns("restaurant_shift_closes")}
    for name, type_ in _COLUMNS:
        if name not in existing:
            op.add_column(
                "restaurant_shift_closes",
                sa.Column(name, type_, nullable=False, server_default="0"),
            )
    # Drop the default so new rows only carry values the cashier supplied.
    with op.batch_alter_table("restaurant_shift_closes") as batch:
        for name, _type in _COLUMNS:
            batch.alter_column(name, server_default=None)


def downgrade() -> None:
    bind = op.get_bind()
    existing = {c["name"] for c in sa.inspect(bind).get_columns("restaurant_shift_closes")}
    with op.batch_alter_table("restaurant_shift_closes") as batch:
        for name, _type in reversed(_COLUMNS):
            if name in existing:
                batch.drop_column(name)
