"""add kits and kit_items

Revision ID: a1b2c3d4e5f6
Revises: e7abdc3ae0f5
Create Date: 2026-09-05 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

from app.models.types import UTCDateTime

revision = "a1b2c3d4e5f6"
down_revision = "e7abdc3ae0f5"
branch_labels = None
depends_on = None

_KITS_COLUMNS = (
    sa.Column("id", sa.Integer(), nullable=False),
    sa.Column("product_id", sa.Integer(), nullable=False),
    sa.Column("name", sa.String(length=200), nullable=False),
    sa.Column("description", sa.Text(), nullable=False),
    sa.Column("version", sa.String(length=50), nullable=False),
    sa.Column("discount_type", sa.String(length=20), nullable=False),
    sa.Column("discount_value", sa.Numeric(precision=10, scale=2), nullable=False),
    sa.Column("is_active", sa.Boolean(), nullable=False),
    sa.Column("created_at", UTCDateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
    sa.Column("updated_at", UTCDateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
)

_KIT_ITEMS_COLUMNS = (
    sa.Column("id", sa.Integer(), nullable=False),
    sa.Column("kit_id", sa.Integer(), nullable=False),
    sa.Column("product_id", sa.Integer(), nullable=False),
    sa.Column("quantity", sa.Integer(), nullable=False),
    sa.Column("position", sa.Integer(), nullable=False),
)

_KITS_INDEXES = (
    ("ix_kits_id", ["id"]),
    ("ix_kits_product_id", ["product_id"]),
)

_KIT_ITEMS_INDEXES = (
    ("ix_kit_items_id", ["id"]),
    ("ix_kit_items_kit_id", ["kit_id"]),
    ("ix_kit_items_product_id", ["product_id"]),
)


def _missing_indexes(inspector, table: str, indexes) -> list:
    existing = {i["name"] for i in inspector.get_indexes(table)}
    return [(name, cols) for name, cols in indexes if name not in existing]


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    table_names = set(insp.get_table_names())

    if "kits" not in table_names:
        op.create_table(
            "kits",
            *_KITS_COLUMNS,
            sa.ForeignKeyConstraint(["product_id"], ["products.id"], ),
            sa.PrimaryKeyConstraint("id"),
        )
    for name, cols in _missing_indexes(insp, "kits", _KITS_INDEXES):
        op.create_index(name, "kits", cols, unique=False)

    if "kit_items" not in table_names:
        op.create_table(
            "kit_items",
            *_KIT_ITEMS_COLUMNS,
            sa.ForeignKeyConstraint(["kit_id"], ["kits.id"], ),
            sa.ForeignKeyConstraint(["product_id"], ["products.id"], ),
            sa.PrimaryKeyConstraint("id"),
        )
    for name, cols in _missing_indexes(insp, "kit_items", _KIT_ITEMS_INDEXES):
        op.create_index(name, "kit_items", cols, unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    table_names = set(insp.get_table_names())

    for table, indexes in (("kit_items", _KIT_ITEMS_INDEXES), ("kits", _KITS_INDEXES)):
        if table not in table_names:
            continue
        for name, _cols in _missing_indexes(insp, table, indexes):
            op.drop_index(name, table_name=table)
    if "kit_items" in table_names:
        op.drop_table("kit_items")
    if "kits" in table_names:
        op.drop_table("kits")