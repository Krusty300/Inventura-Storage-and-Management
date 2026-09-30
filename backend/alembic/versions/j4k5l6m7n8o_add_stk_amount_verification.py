"""add stk amount verification columns

Revision ID: j4k5l6m7n8o
Revises: i3j4k5l6m7n8
Create Date: 2026-09-30 11:30:00.000000

An M-Pesa callback reports how much the customer actually paid, but the STK
handler only looked at ``ResultCode``. Any success marked the sale paid, so a
push for the wrong figure - a client that picked its own amount, a rounded
total, a partial authorisation - was indistinguishable from a clean payment.

``payment_amount_received`` keeps what M-Pesa said was paid and
``payment_amount_status`` keeps the verdict ("matched", "short", "over" or
"unknown"). The status is a separate column rather than a new
``payment_status`` value because a dozen reports and screens branch on
``payment_status == "completed"``; a mismatched payment is still completed and
still needs to appear there.
"""
from alembic import op
import sqlalchemy as sa

revision = "j4k5l6m7n8o"
down_revision = "i3j4k5l6m7n8"
branch_labels = None
depends_on = None

_SALE_COLUMNS = (
    ("payment_amount_received", sa.Numeric(10, 2)),
    ("payment_amount_status", sa.String(20)),
)


def upgrade():
    for name, col_type in _SALE_COLUMNS:
        op.add_column("sales", sa.Column(name, col_type, nullable=True))


def downgrade():
    for name, _ in reversed(_SALE_COLUMNS):
        op.drop_column("sales", name)
