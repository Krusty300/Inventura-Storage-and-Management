"""add ticket item product snapshots

Revision ID: g1h2i3j4k5l6
Revises: d1e2f3a4b5c6
Create Date: 2026-09-28 14:00:00.000000

Ticket items previously rendered the product name and image by reading the live
`products` row, so renaming a product or swapping its gallery retroactively
rewrote historical (including settled) ticket lines. These columns freeze the
name and cover image at the moment the item is added to a ticket.
"""
from alembic import op
import sqlalchemy as sa
import json

revision = "g1h2i3j4k5l6"
down_revision = "d1e2f3a4b5c6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    existing = {c["name"] for c in insp.get_columns("restaurant_ticket_items")}
    if "product_name_snapshot" not in existing:
        op.add_column(
            "restaurant_ticket_items",
            sa.Column("product_name_snapshot", sa.String(200), nullable=True),
        )
    if "product_image_snapshot" not in existing:
        op.add_column(
            "restaurant_ticket_items",
            sa.Column("product_image_snapshot", sa.String(500), nullable=True),
        )

    # Backfill from the live product so historical lines keep rendering the same
    # values they showed before the snapshot existed. Done in Python because
    # Product.display_name derives its variant suffix from the attributes JSON
    # (a dialect-safe replica is not worth the duplication).
    rows = bind.execute(sa.text("""
        SELECT ti.id AS item_id,
               ti.product_id,
               p.name AS product_name,
               p.parent_id,
               p.attributes,
               COALESCE(p.image_url, '') AS image_url,
               (SELECT pi.url FROM product_images pi
                 WHERE pi.product_id = p.id
                 ORDER BY pi.sort_order, pi.id LIMIT 1) AS gallery_image
        FROM restaurant_ticket_items ti
        LEFT JOIN products p ON p.id = ti.product_id
    """)).mappings().all()

    for row in rows:
        name = row["product_name"]
        if name:
            attributes = row["attributes"] or {}
            if isinstance(attributes, str):
                try:
                    attributes = json.loads(attributes)
                except ValueError:
                    attributes = {}
            if isinstance(attributes, dict) and row["parent_id"] is not None:
                label = " / ".join(str(v) for _k, v in sorted(attributes.items()))
                if label:
                    name = f"{name} - {label}"
        else:
            name = f"Product #{row['product_id']}"
        image = row["gallery_image"] or row["image_url"] or ""
        bind.execute(
            sa.text(
                "UPDATE restaurant_ticket_items "
                "SET product_name_snapshot = :name, product_image_snapshot = :image "
                "WHERE id = :id"
            ),
            {"id": row["item_id"], "name": name, "image": image},
        )


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    existing = {c["name"] for c in insp.get_columns("restaurant_ticket_items")}
    if "product_image_snapshot" in existing:
        op.drop_column("restaurant_ticket_items", "product_image_snapshot")
    if "product_name_snapshot" in existing:
        op.drop_column("restaurant_ticket_items", "product_name_snapshot")
