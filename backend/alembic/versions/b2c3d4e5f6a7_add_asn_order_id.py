"""add asn order id

Revision ID: b2c3d4e5f6a7
Revises: f9a1b2c3d4e5
Create Date: 2026-09-15 12:00:00.000000

Adds a nullable orders FK on ASNs so an advance shipping notice can be tied
to the purchase order it ships against. The supplier portal auto-creates an
ASN when a PO is marked in-transit, and both sides benefit from seeing the
ASN on the order.
"""
from alembic import op
import sqlalchemy as sa

revision = "b2c3d4e5f6a7"
down_revision = "f9a1b2c3d4e5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "asns" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("asns")}
    if "order_id" in cols:
        return
    with op.batch_alter_table("asns") as batch_op:
        batch_op.add_column(sa.Column("order_id", sa.Integer(), sa.ForeignKey("orders.id"), nullable=True))
        batch_op.create_index("ix_asns_order_id", ["order_id"])


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "asns" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("asns")}
    if "order_id" in cols:
        with op.batch_alter_table("asns") as batch_op:
            batch_op.drop_index("ix_asns_order_id", table_name="asns")
            batch_op.drop_column("order_id")