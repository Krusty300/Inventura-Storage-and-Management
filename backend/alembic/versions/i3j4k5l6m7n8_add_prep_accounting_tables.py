"""add prep accounting tables

Revision ID: i3j4k5l6m7n8
Revises: h2i3j4k5l6m7
Create Date: 2026-09-29 14:00:00.000000

Restaurant theft is most often plate-side, not till-side: a portion pulled
during service never reaches a guest and never shows up on a ticket. The
controls so far only reconcile money.

This adds the other half of the picture. A prep session records what a station
claims it produced (``prepped_qty``); the system derives what it actually sold
from the ticket items fired inside the session window; the difference between
the two, net of declared waste, is the prep variance. Summing prep variance
into the shift close puts food loss next to cash variance in one report.

Menu items gain a ``prep_station`` plus ``par_qty``/``warn_qty`` so a manager
decides which dishes are prep-tracked and what "enough" looks like.
"""
from alembic import op
import sqlalchemy as sa

revision = "i3j4k5l6m7n8"
down_revision = "h2i3j4k5l6m7"
branch_labels = None
depends_on = None

_SHIFT_CLOSE_COLUMNS = (
    ("prep_session_count", sa.Integer()),
    ("prepped_qty", sa.Integer()),
    ("prep_sold_qty", sa.Integer()),
    ("prep_waste_qty", sa.Integer()),
    ("prep_variance_qty", sa.Integer()),
)

_PRODUCT_COLUMNS = (
    ("par_qty", sa.Integer()),
    ("warn_qty", sa.Integer()),
)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if "restaurant_prep_sessions" not in inspector.get_table_names():
        op.create_table(
            "restaurant_prep_sessions",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("session_number", sa.String(30), nullable=False),
            sa.Column("station", sa.String(60), nullable=False),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="open"),
            sa.Column("notes", sa.Text(), nullable=False, server_default=""),
            sa.Column("opened_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column("closed_at", sa.DateTime(), nullable=True),
            sa.Column("closed_by", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        )
        op.create_index("ix_restaurant_prep_sessions_session_number", "restaurant_prep_sessions", ["session_number"], unique=True)
        op.create_index("ix_restaurant_prep_sessions_station", "restaurant_prep_sessions", ["station"])
        op.create_index("ix_restaurant_prep_sessions_user_id", "restaurant_prep_sessions", ["user_id"])
        op.create_index("ix_restaurant_prep_sessions_status", "restaurant_prep_sessions", ["status"])
        op.create_index("ix_restaurant_prep_sessions_opened_at", "restaurant_prep_sessions", ["opened_at"])

    if "restaurant_prep_session_items" not in inspector.get_table_names():
        op.create_table(
            "restaurant_prep_session_items",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "session_id",
                sa.Integer(),
                sa.ForeignKey("restaurant_prep_sessions.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("product_id", sa.Integer(), sa.ForeignKey("products.id"), nullable=False),
            sa.Column("product_name_snapshot", sa.String(200), nullable=True),
            sa.Column("prepped_qty", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("waste_qty", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("counted_qty", sa.Integer(), nullable=True),
            sa.Column("waste_reason", sa.Text(), nullable=True),
            sa.Column("sold_qty", sa.Integer(), nullable=True),
            sa.Column("expected_remaining", sa.Integer(), nullable=True),
            sa.Column("variance", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        )
        op.create_index("ix_restaurant_prep_session_items_session_id", "restaurant_prep_session_items", ["session_id"])
        op.create_index("ix_restaurant_prep_session_items_product_id", "restaurant_prep_session_items", ["product_id"])

    tables = sa.inspect(bind)
    product_cols = {c["name"] for c in tables.get_columns("products")}
    if "prep_station" not in product_cols:
        op.add_column("products", sa.Column("prep_station", sa.String(60), nullable=True))
    for name, type_ in _PRODUCT_COLUMNS:
        if name not in product_cols:
            op.add_column("products", sa.Column(name, type_, nullable=False, server_default="0"))

    # Plain ADD COLUMN only: nothing here changes a type or a constraint, and
    # batch mode on SQLite rebuilds the table, which leaves a scratch table
    # behind if the run is interrupted.
    shift_cols = {c["name"] for c in tables.get_columns("restaurant_shift_closes")}
    for name, type_ in _SHIFT_CLOSE_COLUMNS:
        if name not in shift_cols:
            op.add_column("restaurant_shift_closes", sa.Column(name, type_, nullable=False, server_default="0"))

    op.create_index("ix_products_prep_station", "products", ["prep_station"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "ix_products_prep_station" in {i["name"] for i in inspector.get_indexes("products")}:
        op.drop_index("ix_products_prep_station", table_name="products")

    product_cols = {c["name"] for c in sa.inspect(bind).get_columns("products")}
    for name in ("prep_station",) + tuple(n for n, _ in reversed(_PRODUCT_COLUMNS)):
        if name in product_cols:
            op.drop_column("products", name)

    shift_cols = {c["name"] for c in sa.inspect(bind).get_columns("restaurant_shift_closes")}
    for name, _type in reversed(_SHIFT_CLOSE_COLUMNS):
        if name in shift_cols:
            op.drop_column("restaurant_shift_closes", name)

    op.drop_table("restaurant_prep_session_items")
    op.drop_table("restaurant_prep_sessions")
