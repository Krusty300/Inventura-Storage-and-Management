"""add datetime hover cards toggle

Revision ID: e6f7a8b9c0d1
Revises: d5e6f7a8b9c0
Create Date: 2026-09-09 12:00:00.000000

Adds a bool switch to the settings table so calendar/clock hover cards on
date and time displays can be enabled or disabled.
"""
from alembic import op
import sqlalchemy as sa

revision = "e6f7a8b9c0d1"
down_revision = "d5e6f7a8b9c0"
branch_labels = None
depends_on = None

_COLUMNS = (
    "show_datetime_hover_cards",
)


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "settings" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("settings")}
    for col in _COLUMNS:
        if col not in cols:
            op.add_column("settings", sa.Column(col, sa.Boolean(), nullable=False, server_default=sa.true()))


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "settings" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("settings")}
    for col in _COLUMNS:
        if col in cols:
            op.drop_column("settings", col)