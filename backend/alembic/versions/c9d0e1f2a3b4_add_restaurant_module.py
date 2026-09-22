"""add restaurant module tables

Revision ID: c9d0e1f2a3b4
Revises: d2e3f4a5b6c7
Create Date: 2026-09-22 09:00:00.000000

Adds the restaurant module: ``restaurant_tables`` (floor plan), ``restaurant_tickets``
(open checks) with ``restaurant_ticket_items`` (lines), and the ``products.is_menu_item``
flag used to scope the POS menu picker.
"""
from alembic import op
import sqlalchemy as sa

from app.models.types import UTCDateTime

revision = "c9d0e1f2a3b4"
down_revision = "d2e3f4a5b6c7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = insp.get_table_names()

    if "restaurant_tables" not in tables:
        op.create_table(
            "restaurant_tables",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("number", sa.String(length=20), nullable=False, unique=True),
            sa.Column("zone", sa.String(length=100), nullable=True),
            sa.Column("capacity", sa.Integer(), nullable=False, server_default="4"),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", UTCDateTime(), server_default=sa.func.now(), nullable=True),
            sa.Column("updated_at", UTCDateTime(), server_default=sa.func.now(), nullable=True),
        )
        op.create_index("ix_restaurant_tables_id", "restaurant_tables", ["id"], unique=False)
        op.create_index("ix_restaurant_tables_zone", "restaurant_tables", ["zone"], unique=False)
        op.create_index("ix_restaurant_tables_created_at", "restaurant_tables", ["created_at"], unique=False)

    if "restaurant_tickets" not in tables:
        op.create_table(
            "restaurant_tickets",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("ticket_number", sa.String(length=30), nullable=False, unique=True),
            sa.Column("table_id", sa.Integer(), sa.ForeignKey("restaurant_tables.id"), nullable=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="open"),
            sa.Column("guest_count", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("customer_name", sa.String(length=120), nullable=False, server_default=""),
            sa.Column("subtotal", sa.Numeric(10, 2), nullable=False, server_default="0"),
            sa.Column("discount_amount", sa.Numeric(10, 2), nullable=False, server_default="0"),
            sa.Column("tax_amount", sa.Numeric(10, 2), nullable=False, server_default="0"),
            sa.Column("total_amount", sa.Numeric(10, 2), nullable=False, server_default="0"),
            sa.Column("sale_id", sa.Integer(), sa.ForeignKey("sales.id"), nullable=True),
            sa.Column("notes", sa.Text(), nullable=False, server_default=""),
            sa.Column("opened_at", UTCDateTime(), server_default=sa.func.now(), nullable=True),
            sa.Column("settled_at", UTCDateTime(), nullable=True),
            sa.Column("created_at", UTCDateTime(), server_default=sa.func.now(), nullable=True),
            sa.Column("updated_at", UTCDateTime(), server_default=sa.func.now(), nullable=True),
        )
        op.create_index("ix_restaurant_tickets_id", "restaurant_tickets", ["id"], unique=False)
        op.create_index("ix_restaurant_tickets_table_id", "restaurant_tickets", ["table_id"], unique=False)
        op.create_index("ix_restaurant_tickets_user_id", "restaurant_tickets", ["user_id"], unique=False)
        op.create_index("ix_restaurant_tickets_status", "restaurant_tickets", ["status"], unique=False)
        op.create_index("ix_restaurant_tickets_sale_id", "restaurant_tickets", ["sale_id"], unique=False)
        op.create_index("ix_restaurant_tickets_opened_at", "restaurant_tickets", ["opened_at"], unique=False)

    if "restaurant_ticket_items" not in tables:
        op.create_table(
            "restaurant_ticket_items",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("ticket_id", sa.Integer(), sa.ForeignKey("restaurant_tickets.id"), nullable=False),
            sa.Column("product_id", sa.Integer(), sa.ForeignKey("products.id"), nullable=False),
            sa.Column("quantity", sa.Integer(), nullable=False),
            sa.Column("unit_price", sa.Numeric(10, 2), nullable=False, server_default="0"),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
            sa.Column("notes", sa.Text(), nullable=False, server_default=""),
            sa.Column("sent_at", UTCDateTime(), nullable=True),
            sa.Column("created_at", UTCDateTime(), server_default=sa.func.now(), nullable=True),
        )
        op.create_index("ix_restaurant_ticket_items_id", "restaurant_ticket_items", ["id"], unique=False)
        op.create_index("ix_restaurant_ticket_items_ticket_id", "restaurant_ticket_items", ["ticket_id"], unique=False)
        op.create_index("ix_restaurant_ticket_items_product_id", "restaurant_ticket_items", ["product_id"], unique=False)
        op.create_index("ix_restaurant_ticket_items_status", "restaurant_ticket_items", ["status"], unique=False)

    if "products" in tables:
        cols = {c["name"] for c in insp.get_columns("products")}
        if "is_menu_item" not in cols:
            op.add_column("products", sa.Column("is_menu_item", sa.Boolean(), nullable=False, server_default=sa.false()))
            op.create_index("ix_products_is_menu_item", "products", ["is_menu_item"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = insp.get_table_names()

    if "products" in tables:
        cols = {c["name"] for c in insp.get_columns("products")}
        if "is_menu_item" in cols:
            op.drop_index("ix_products_is_menu_item", table_name="products")
            op.drop_column("products", "is_menu_item")

    if "restaurant_ticket_items" in tables:
        op.drop_index("ix_restaurant_ticket_items_status", table_name="restaurant_ticket_items")
        op.drop_index("ix_restaurant_ticket_items_product_id", table_name="restaurant_ticket_items")
        op.drop_index("ix_restaurant_ticket_items_ticket_id", table_name="restaurant_ticket_items")
        op.drop_index("ix_restaurant_ticket_items_id", table_name="restaurant_ticket_items")
        op.drop_table("restaurant_ticket_items")

    if "restaurant_tickets" in tables:
        op.drop_index("ix_restaurant_tickets_opened_at", table_name="restaurant_tickets")
        op.drop_index("ix_restaurant_tickets_sale_id", table_name="restaurant_tickets")
        op.drop_index("ix_restaurant_tickets_status", table_name="restaurant_tickets")
        op.drop_index("ix_restaurant_tickets_user_id", table_name="restaurant_tickets")
        op.drop_index("ix_restaurant_tickets_table_id", table_name="restaurant_tickets")
        op.drop_index("ix_restaurant_tickets_id", table_name="restaurant_tickets")
        op.drop_table("restaurant_tickets")

    if "restaurant_tables" in tables:
        op.drop_index("ix_restaurant_tables_created_at", table_name="restaurant_tables")
        op.drop_index("ix_restaurant_tables_zone", table_name="restaurant_tables")
        op.drop_index("ix_restaurant_tables_id", table_name="restaurant_tables")
        op.drop_table("restaurant_tables")