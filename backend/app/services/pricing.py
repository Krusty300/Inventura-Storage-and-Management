"""Price resolution service.

Walks: customer-specific list → group list → default list → product.unit_price.
Also validates and applies promotions.
"""

from __future__ import annotations

import logging
from datetime import date

from sqlalchemy.orm import Session

from sqlalchemy import update

from app.models.customer import Customer
from app.models.customer_group import CustomerGroup
from app.models.price_list import PriceList, PriceListItem
from app.models.product import Product
from app.models.promotion import Promotion

log = logging.getLogger(__name__)


def _active_price_list_ids(db: Session, today: date | None = None) -> list[int]:
    """Return ids of price lists that are active and within their validity window."""
    q = db.query(PriceList.id).filter(PriceList.is_active == True)
    if today:
        q = q.filter(
            (PriceList.valid_from.is_(None) | (PriceList.valid_from <= today)),
            (PriceList.valid_to.is_(None) | (PriceList.valid_to >= today)),
        )
    return [r[0] for r in q.all()]


def resolve_price(db: Session, product_id: int, customer_id: int | None = None, qty: int = 1) -> float:
    """Resolve the unit price for *product_id* given an optional customer and quantity.

    Lookup order:
    1. Customer's personal price list (if any)
    2. Customer's group price list (if any)
    3. The system default price list (is_default=True)
    4. product.unit_price (fallback)

    Within each list, the most specific price wins — highest min_qty that is ≤ qty.
    """
    product = db.get(Product, product_id)
    if product is None:
        return 0.0

    today = date.today()
    active_ids = _active_price_list_ids(db, today)
    if not active_ids:
        return float(product.unit_price)

    list_ids_to_try: list[int] = []

    # 1. Customer personal price list — future extension; for now skip
    # 2. Customer group
    if customer_id is not None:
        customer = db.get(Customer, customer_id)
        if customer and customer.group_id is not None:
            group = db.get(CustomerGroup, customer.group_id)
            if group and group.price_list_id and group.price_list_id in active_ids:
                list_ids_to_try.append(group.price_list_id)

    # 3. Default price list
    default_list = db.query(PriceList).filter(PriceList.is_default == True, PriceList.is_active == True).first()
    if default_list and default_list.id not in list_ids_to_try:
        list_ids_to_try.append(default_list.id)

    for pl_id in list_ids_to_try:
        items = (
            db.query(PriceListItem)
            .filter(
                PriceListItem.price_list_id == pl_id,
                PriceListItem.product_id == product_id,
                PriceListItem.min_qty <= qty,
            )
            .order_by(PriceListItem.min_qty.desc())
            .all()
        )
        if items:
            return float(items[0].price)

    return float(product.unit_price)


class PromoError(Exception):
    """Raised when a promotion code is invalid or cannot be applied."""


def validate_promotion(db: Session, code: str, subtotal: float, total_qty: int) -> tuple[Promotion, float]:
    """Validate a promo code and return (promotion, discount_amount).

    Raises PromoError on failure.
    """
    promo = db.query(Promotion).filter(
        Promotion.code == code.strip().upper(),
        Promotion.is_active == True,
    ).first()
    if promo is None:
        raise PromoError("Invalid promotion code")

    today = date.today()
    if promo.valid_from and today < promo.valid_from:
        raise PromoError("Promotion is not yet active")
    if promo.valid_to and today > promo.valid_to:
        raise PromoError("Promotion has expired")
    if promo.max_uses > 0 and promo.used_count >= promo.max_uses:
        raise PromoError("Promotion has reached its usage limit")
    if promo.min_qty > 0 and total_qty < promo.min_qty:
        raise PromoError(f"Minimum quantity for this promotion is {promo.min_qty}")
    if promo.min_amount > 0 and subtotal < promo.min_amount:
        raise PromoError(f"Minimum order amount for this promotion is ${promo.min_amount:.2f}")

    if promo.discount_type == "percentage":
        discount = subtotal * float(promo.value) / 100
    else:
        discount = min(float(promo.value), subtotal)

    return promo, round(discount, 2)


def apply_promotion(db: Session, promo: Promotion) -> bool:
    """Atomically check max_uses and increment used_count for a promotion.

    Uses a WHERE clause that re-checks the limit inside the UPDATE so two
    concurrent requests cannot both succeed.  Returns True if the increment
    succeeded, False if max_uses was already reached.
    """
    conditions = [Promotion.id == promo.id, Promotion.is_active == True]
    if promo.max_uses > 0:
        conditions.append(Promotion.used_count < promo.max_uses)
    result = db.execute(
        update(Promotion)
        .where(*conditions)
        .values(used_count=Promotion.used_count + 1)
    )
    db.flush()
    return result.rowcount > 0
