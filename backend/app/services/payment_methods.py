"""Payment method validation shared by sale and shipment invoice creation."""

from app.constants import CURRENCIES, MOBILE_MONEY_PROVIDERS, PAYMENT_METHODS, currency_symbol as symbol_for


def validate_payment(payment_method: str | None, payment_provider: str | None = None) -> str | None:
    """Validate a payment method/provider pair and return the provider to store.

    Returns ``None`` for non-mobile-money methods; returns the validated provider
    for ``mobile_money``. Raises ``ValueError`` with a user-facing message when
    the combination is invalid. A ``payment_provider`` supplied for any method
    other than ``mobile_money`` is rejected (fail-fast) instead of being
    silently dropped.
    """
    method = (payment_method or "cash").strip()
    if method not in PAYMENT_METHODS:
        raise ValueError(f"payment_method must be one of {', '.join(PAYMENT_METHODS)}")
    provider = (payment_provider or "").strip()
    if method == "mobile_money":
        if not provider:
            raise ValueError("payment_provider is required when payment_method is 'mobile_money'")
        if provider not in MOBILE_MONEY_PROVIDERS:
            raise ValueError(f"payment_provider must be one of {', '.join(MOBILE_MONEY_PROVIDERS)}")
        return provider
    if provider:
        raise ValueError("payment_provider is only allowed when payment_method is 'mobile_money'")
    return None


def resolve_payment_details(
    payment_method: str | None,
    payment_provider: str | None,
    payment_provider_amount: float | None,
    currency: str | None,
    currency_symbol: str | None,
    default_currency: str = "USD",
    default_symbol: str = "$",
) -> dict:
    """Validate a full payment payload and resolve the values to persist.

    Returns ``{"provider", "currency", "currency_symbol", "payment_provider_amount"}``.
    Raises ``ValueError`` (user-facing message) on invalid input.
    """
    provider = validate_payment(payment_method, payment_provider)
    method = (payment_method or "cash").strip()
    if method == "mobile_money":
        if payment_provider_amount is None or float(payment_provider_amount) <= 0:
            raise ValueError("payment_provider_amount is required when payment_method is 'mobile_money'")
        if not (currency or "").strip():
            raise ValueError("currency is required when payment_method is 'mobile_money'")
    code = (currency or "").strip() or default_currency
    if code not in CURRENCIES:
        raise ValueError(f"currency must be one of {', '.join(CURRENCIES)}")
    symbol = (currency_symbol or "").strip() or symbol_for(code) or default_symbol
    amount = float(payment_provider_amount) if payment_provider_amount is not None and method == "mobile_money" else None
    return {
        "provider": provider,
        "currency": code,
        "currency_symbol": symbol,
        "payment_provider_amount": amount,
    }
