"""Shared pagination caps.

Kept in one place so the API contract and the frontend pickers that request
large pages stay in sync (frontend mirrors these in src/utils/constants.ts).
"""

# Standard paginated list endpoints.
MAX_PAGE_SIZE = 200

# Dropdown / lookup endpoints (locations, categories, customers) whose rows
# must be fetchable in one request to populate pickers.
MAX_PAGE_SIZE_LOOKUP = 5000

# LPN and supplier pickers, which send moderately large pages.
MAX_PAGE_SIZE_PICKER = 500

# Frontend product pickers request up to this many rows in one go.
MAX_PAGE_SIZE_PRODUCTS = 1000

from enum import Enum


class PaymentMethod(str, Enum):
    """Payment methods accepted when completing a sale (register checkout or
    shipment invoice creation). "mobile_money" requires a provider from
    MobileMoneyProvider."""

    CASH = "cash"
    CARD = "card"
    TRANSFER = "transfer"
    MOBILE_MONEY = "mobile_money"


class MobileMoneyProvider(str, Enum):
    """Sub-providers selectable when payment_method == MobileMoneyProvider."""

    M_PESA = "m-pesa"
    AIRTEL_MONEY = "airtel_money"
    T_KASH = "t-kash"


# List forms kept for API compatibility and simple membership checks.
PAYMENT_METHODS = [m.value for m in PaymentMethod]
MOBILE_MONEY_PROVIDERS = [p.value for p in MobileMoneyProvider]


class Currency(str, Enum):
    """Currencies selectable in settings and on the point-of-sale register.

    Mirrored by the frontend in src/utils/currency.ts (CURRENCIES). Each value
    maps to an ISO 4217 code; the symbol lives in CURRENCY_SYMBOLS below.
    """

    USD = "USD"
    EUR = "EUR"
    GBP = "GBP"
    KES = "KES"
    NGN = "NGN"
    UGX = "UGX"
    TZS = "TZS"
    ZAR = "ZAR"
    GHS = "GHS"
    RWF = "RWF"
    ETB = "ETB"
    INR = "INR"
    AED = "AED"
    SAR = "SAR"
    CAD = "CAD"
    AUD = "AUD"
    CNY = "CNY"
    JPY = "JPY"


CURRENCY_SYMBOLS: dict[str, str] = {
    "USD": "$",
    "EUR": "€",
    "GBP": "£",
    "KES": "KSh",
    "NGN": "₦",
    "UGX": "USh",
    "TZS": "TSh",
    "ZAR": "R",
    "GHS": "GH₵",
    "RWF": "FRw",
    "ETB": "Br",
    "INR": "₹",
    "AED": "د.إ",
    "SAR": "﷼",
    "CAD": "C$",
    "AUD": "A$",
    "CNY": "¥",
    "JPY": "¥",
}

CURRENCIES = [c.value for c in Currency]


def currency_symbol(code: str | None) -> str:
    """Return the display symbol for a currency code (falls back to '$')."""
    if code:
        return CURRENCY_SYMBOLS.get(code, code)
    return "$"
