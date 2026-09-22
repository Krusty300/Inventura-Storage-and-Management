"""add menu sections, modifiers, and ticket item modifier columns

Revision ID: d0f1e2a3b4c5
Revises: c9d0e1f2a3b4
Create Date: 2026-09-22 18:45:00.000000

Menu builder: ``menu_sections`` group menu items on the POS, ``menu_modifier_groups``
+ ``menu_modifier_options`` hold add-on choices per menu item, and ticket items gain
``base_unit_price``/``modifiers`` so add-on pricing is auditable on each line.
"""
from alembic import op
import sqlalchemy as sa

from app.models.types import UTCDateTime

revision = "d0f1e2a3b4c5"
down_revision = "c9d0e1f2a3b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = insp.get_table_names()

    if "menu_sections" not in tables:
        op.create_table(
            "menu_sections",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("name", sa.String(length=100), nullable=False, unique=True),
            sa.Column("description", sa.Text(), nullable=False, server_default=""),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", UTCDateTime(), server_default=sa.func.now(), nullable=True),
            sa.Column("updated_at", UTCDateTime(), server_default=sa.func.now(), nullable=True),
        )

    if "menu_modifier_groups" not in tables:
        op.create_table(
            "menu_modifier_groups",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("product_id", sa.Integer(), sa.ForeignKey("products.id"), nullable=False),
            sa.Column("name", sa.String(length=100), nullable=False),
            sa.Column("min_select", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("max_select", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("is_required", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", UTCDateTime(), server_default=sa.func.now(), nullable=True),
            sa.Column("updated_at", UTCDateTime(), server_default=sa.func.now(), nullable=True),
        )
        op.create_index("ix_menu_modifier_groups_id", "menu_modifier_groups", ["id"], unique=False)
        op.create_index("ix_menu_modifier_groups_product_id", "menu_modifier_groups", ["product_id"], unique=False)

    if "menu_modifier_options" not in tables:
        op.create_table(
            "menu_modifier_options",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("group_id", sa.Integer(), sa.ForeignKey("menu_modifier_groups.id"), nullable=False),
            sa.Column("name", sa.String(length=100), nullable=False),
            sa.Column("price_delta", sa.Numeric(10, 2), nullable=False, server_default="0"),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", UTCDateTime(), server_default=sa.func.now(), nullable=True),
        )
        op.create_index("ix_menu_modifier_options_id", "menu_modifier_options", ["id"], unique=False)
        op.create_index("ix_menu_modifier_options_group_id", "menu_modifier_options", ["group_id"], unique=False)

    if "products" in tables:
        cols = {c["name"] for c in insp.get_columns("products")}
        if "menu_section_id" not in cols:
            op.add_column("products", sa.Column("menu_section_id", sa.Integer(), sa.ForeignKey("menu_sections.id"), nullable=True))
            op.create_index("ix_products_menu_section_id", "products", ["menu_section_id"], unique=False)

    if "restaurant_ticket_items" in tables:
        cols = {c["name"] for c in insp.get_columns("restaurant_ticket_items")}
        if "base_unit_price" not in cols:
            op.add_column("restaurant_ticket_items", sa.Column("base_unit_price", sa.Numeric(10, 2), nullable=False, server_default="0"))
        if "modifiers" not in cols:
            op.add_column("restaurant_ticket_items", sa.Column("modifiers", sa.JSON(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = insp.get_table_names()

    if "restaurant_ticket_items" in tables:
        cols = {c["name"] for c in insp.get_columns("restaurant_ticket_items")}
        if "modifiers" in cols:
            op.drop_column("restaurant_ticket_items", "modifiers")
        if "base_unit_price" in cols:
            op.drop_column("restaurant_ticket_items", "base_unit_price")

    if "products" in tables:
        cols = {c["name"] for c in insp.get_columns("products")}
        if "menu_section_id" in cols:
            op.drop_index("ix_products_menu_section_id", table_name="products")
            op.drop_column("products", "menu_section_id")

    if "menu_modifier_options" in tables:
        op.drop_index("ix_menu_modifier_options_group_id", table_name="menu_modifier_options")
        op.drop_index("ix_menu_modifier_options_id", table_name="menu_modifier_options")
        op.drop_table("menu_modifier_options")

    if "menu_modifier_groups" in tables:
        op.drop_index("ix_menu_modifier_groups_product_id", table_name="menu_modifier_groups")
        op.drop_index("ix_menu_modifier_groups_id", table_name="menu_modifier_groups")
        op.drop_table("menu_modifier_groups")

    if "menu_sections" in tables:
        op.drop_table("menu_sections")