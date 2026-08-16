"""Payment method validation shared by sale and shipment invoice creation."""

from app.constants import MOBILE_MONEY_PROVIDERS, PAYMENT_METHODS


def validate_payment(payment_method: str, payment_provider: str | None = None) -> str | None:
    """Validate a payment method/provider pair and return the provider to store.

    Returns ``None`` for non-mobile-money methods; returns the validated provider
    for ``mobile_money``. Raises ``ValueError`` with a user-facing message when
    the combination is invalid.
    """
    method = (payment_method or "cash").strip()
    if method not in PAYMENT_METHODS:
        raise ValueError(f"payment_method must be one of {', '.join(PAYMENT_METHODS)}")
    if method == "mobile_money":
        provider = (payment_provider or "").strip()
        if not provider:
            raise ValueError("payment_provider is required when payment_method is 'mobile_money'")
        if provider not in MOBILE_MONEY_PROVIDERS:
            raise ValueError(f"payment_provider must be one of {', '.join(MOBILE_MONEY_PROVIDERS)}")
        return provider
    return None
