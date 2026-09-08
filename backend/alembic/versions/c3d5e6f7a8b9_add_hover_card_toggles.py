"""add hover card toggles

Revision ID: c3d5e6f7a8b9
Revises: b7c8d9e0f1a2
Create Date: 2026-09-09 09:00:00.000000

Adds per-page bool switches to the settings table so the Products, Customers,
and Suppliers list hover cards can be enabled or disabled independently.
"""
from alembic import op
import sqlalchemy as sa

revision = "c3d5e6f7a8b9"
down_revision = "b7c8d9e0f1a2"
branch_labels = None
depends_on = None

_COLUMNS = (
    "show_product_hover_cards",
    "show_customer_hover_cards",
    "show_supplier_hover_cards",
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