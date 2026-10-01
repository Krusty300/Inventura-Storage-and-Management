"""add work centers and routings

Revision ID: k5l6m7n8o9p
Revises: j4k5l6m7n8o
Create Date: 2026-09-30 15:00:00.000000

A work order today says what to build and how much of it, and nothing about
where the time goes. That is enough to track cost after the fact but not to
answer the question a planner actually asks: can we make this batch by Friday,
and if not, what is stopping us?

A ``work_center`` is a capacity-constrained resource - a machine, a
workstation, a crew, or an outsourced supplier - carrying the hours it offers
per day, the days it runs, how efficiently it works, and its hourly rate.
A ``routing_operation`` is one step of a product's route through those
centers, with setup and run-per-unit times, so a batch has an ideal duration
before anyone records what it actually took.

Work orders gain ``due_date`` for the planner's commitment and
``scheduled_start``/``scheduled_end``/``work_center_id`` for the capacity
scheduler to reserve capacity against. All four stay null until the scheduler
runs, so existing work orders are untouched and planning reports no phantom
load.
"""
from alembic import op
import sqlalchemy as sa

revision = "k5l6m7n8o9p"
down_revision = "j4k5l6m7n8o"
branch_labels = None
depends_on = None

_WORK_ORDER_COLUMNS = (
    ("due_date", sa.Date()),
    ("scheduled_start", sa.DateTime()),
    ("scheduled_end", sa.DateTime()),
)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if "work_centers" not in inspector.get_table_names():
        op.create_table(
            "work_centers",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("code", sa.String(50), nullable=False),
            sa.Column("name", sa.String(200), nullable=False),
            sa.Column("work_center_type", sa.String(30), nullable=False, server_default="workstation"),
            sa.Column("location_id", sa.Integer(), sa.ForeignKey("locations.id"), nullable=True),
            sa.Column("hours_per_day", sa.Numeric(6, 2), nullable=False, server_default="8.0"),
            sa.Column("working_days", sa.JSON(), nullable=True),
            sa.Column("shift_start", sa.String(5), nullable=False, server_default="08:00"),
            sa.Column("efficiency", sa.Numeric(6, 2), nullable=False, server_default="100.0"),
            sa.Column("hourly_rate", sa.Numeric(10, 2), nullable=False, server_default="0.0"),
            sa.Column("notes", sa.Text(), nullable=False, server_default=""),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("deleted_at", sa.DateTime(), nullable=True),
        )
        op.create_index("ix_work_centers_code", "work_centers", ["code"], unique=True)
        op.create_index("ix_work_centers_name", "work_centers", ["name"])
        op.create_index("ix_work_centers_work_center_type", "work_centers", ["work_center_type"])
        op.create_index("ix_work_centers_location_id", "work_centers", ["location_id"])
        op.create_index("ix_work_centers_is_active", "work_centers", ["is_active"])
        op.create_index("ix_work_centers_is_deleted", "work_centers", ["is_deleted"])

    if "routing_operations" not in inspector.get_table_names():
        op.create_table(
            "routing_operations",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("product_id", sa.Integer(), sa.ForeignKey("products.id"), nullable=False),
            sa.Column("work_center_id", sa.Integer(), sa.ForeignKey("work_centers.id"), nullable=False),
            sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("name", sa.String(200), nullable=False, server_default=""),
            sa.Column("setup_minutes", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("run_minutes_per_unit", sa.Numeric(10, 4), nullable=False, server_default="0.0"),
            sa.Column("notes", sa.Text(), nullable=False, server_default=""),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("product_id", "position", name="uq_routing_operations_product_position"),
        )
        op.create_index("ix_routing_operations_product_id", "routing_operations", ["product_id"])
        op.create_index("ix_routing_operations_work_center_id", "routing_operations", ["work_center_id"])

    # Plain ADD COLUMN only: nothing here changes a type or a constraint, and
    # batch mode on SQLite rebuilds the table, which leaves a scratch table
    # behind if the run is interrupted.
    work_order_cols = {c["name"] for c in sa.inspect(bind).get_columns("work_orders")}
    for name, type_ in _WORK_ORDER_COLUMNS:
        if name not in work_order_cols:
            op.add_column("work_orders", sa.Column(name, type_, nullable=True))

    # The center reference still needs care: SQLite refuses ALTER of
    # constraints, but it does accept a REFERENCES clause on a newly added
    # nullable column, which is the exact shape of this reference. Plain SQL
    # therefore adds it without rebuilding the table, and batch mode is only
    # needed on the way back out (SQLite will not drop a column that a foreign
    # key still points at).
    if "work_center_id" not in work_order_cols:
        op.execute(
            "ALTER TABLE work_orders ADD COLUMN work_center_id INTEGER "
            "REFERENCES work_centers(id)"
        )
        op.create_index("ix_work_orders_work_center_id", "work_orders", ["work_center_id"])

    op.create_index("ix_work_orders_due_date", "work_orders", ["due_date"])
    op.create_index("ix_work_orders_scheduled_start", "work_orders", ["scheduled_start"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    for index in ("ix_work_orders_scheduled_start", "ix_work_orders_due_date"):
        if index in {i["name"] for i in inspector.get_indexes("work_orders")}:
            op.drop_index(index, table_name="work_orders")

    work_order_cols = {c["name"] for c in inspector.get_columns("work_orders")}
    if "work_center_id" in work_order_cols:
        with op.batch_alter_table("work_orders") as batch_op:
            # Inside a batch block the table is already known, so passing
            # table_name again is an error rather than a redundancy.
            batch_op.drop_index("ix_work_orders_work_center_id")
            batch_op.drop_column("work_center_id")
    for name, _type in reversed(_WORK_ORDER_COLUMNS):
        if name in work_order_cols:
            op.drop_column("work_orders", name)

    if "routing_operations" in sa.inspect(bind).get_table_names():
        op.drop_table("routing_operations")
    if "work_centers" in sa.inspect(bind).get_table_names():
        op.drop_table("work_centers")