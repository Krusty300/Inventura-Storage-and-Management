"""widen bom item quantity to fractional

Revision ID: m7n8o9p0q1r
Revises: k5l6m7n8o9p
Create Date: 2026-10-02 10:00:00.000000

A BOM line quantity was declared as ``INTEGER``, which is right for a
manufactured good (three of these, five of those) but wrong for the restaurant
recipe use of a BOM: half a portion of coleslaw and a tenth of a takeaway box
are legitimate component amounts. SQLite stored those fractional values anyway
because of its dynamic typing, but every read through the integer-typed schema
raised, so the BOM list 500'd as soon as a recipe contained a fraction.

Widening the column to ``FLOAT`` aligns the schema with the data that recipes
were already producing and with the rest of the consumption path, which has
always treated component needs as fractional.
"""
from alembic import op
import sqlalchemy as sa

revision = "m7n8o9p0q1r"
down_revision = "k5l6m7n8o9p"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("bom_items") as batch_op:
        batch_op.alter_column(
            "quantity",
            existing_type=sa.Integer(),
            type_=sa.Float(),
            existing_nullable=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("bom_items") as batch_op:
        batch_op.alter_column(
            "quantity",
            existing_type=sa.Float(),
            type_=sa.Integer(),
            existing_nullable=False,
        )
