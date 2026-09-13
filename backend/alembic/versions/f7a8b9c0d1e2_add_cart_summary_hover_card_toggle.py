"""add cart summary hover card toggle

Revision ID: f7a8b9c0d1e2
Revises: e6f7a8b9c0d1
Create Date: 2026-09-09 13:00:00.000000

Adds a bool switch to the settings table so the sales cart summary hover card
over the order Total can be enabled or disabled.
"""
from alembic import op
import sqlalchemy as sa

revision = "f7a8b9c0d1e2"
down_revision = "e6f7a8b9c0d1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "settings" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("settings")}
    if "show_cart_summary_hover_cards" not in cols:
        op.add_column("settings", sa.Column("show_cart_summary_hover_cards", sa.Boolean(), nullable=False, server_default=sa.true()))


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "settings" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("settings")}
    if "show_cart_summary_hover_cards" in cols:
        op.drop_column("settings", "show_cart_summary_hover_cards")