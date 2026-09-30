"""Safaricom Daraja (M-Pesa) integration — config-driven with mock mode.

Config via environment variables (backend/.env):
    DARAJA_ENVIRONMENT          sandbox | live               (default: sandbox)
    DARAJA_CONSUMER_KEY         OAuth consumer key
    DARAJA_CONSUMER_SECRET      OAuth consumer secret
    DARAJA_PASSKEY              Lipa Na MPesa Online short-code passkey
    DARAJA_SHORTCODE            Paybill / till number
    DARAJA_CALLBACK_URL         Public URL M-Pesa will POST to
    DARAJA_INITIATOR_NAME       B2C initiator name
    DARAJA_SECURITY_CREDENTIAL  B2C security credential (encrypted)
    DARAJA_B2C_RESULT_URL       B2C results callback URL
    DARAJA_B2C_TIMEOUT_URL      B2C timeout callback URL
    DARAJA_MOCK                 true | false  (default: true when keys absent)

When DARAJA_MOCK is true (or credentials are missing), all API calls return
plausible fake responses so the full STK Push / B2C flow can be tested end-to-end
without hitting Safaricom.  The mock mode uses a module-level counter to generate
fake IDs that look real.
"""

from __future__ import annotations

import os
import secrets
from base64 import b64encode
from datetime import datetime, timezone

import httpx

_DARAJA_BASE_URLS = {
    "sandbox": "https://sandbox.safaricom.co.ke",
    "live": "https://api.safaricom.co.ke",
}

_TOKEN_URL = "/oauth/v1/generate?grant_type=client_credentials"
_STK_PUSH_URL = "/mpesa/stkpush/v1/processrequest"
_B2C_URL = "/mpesa/b2cpayment/v1/request"

_mock_counter = 0


def _env(key: str, default: str = "") -> str:
    return os.getenv(key, default).strip()


class DarajaConfig:
    """Read-only configuration built from environment variables."""

    def __init__(self) -> None:
        self.environment = _env("DARAJA_ENVIRONMENT", "sandbox")
        self.consumer_key = _env("DARAJA_CONSUMER_KEY")
        self.consumer_secret = _env("DARAJA_CONSUMER_SECRET")
        self.passkey = _env("DARAJA_PASSKEY")
        self.shortcode = _env("DARAJA_SHORTCODE")
        self.callback_url = _env("DARAJA_CALLBACK_URL")
        self.initiator_name = _env("DARAJA_INITIATOR_NAME")
        self.security_credential = _env("DARAJA_SECURITY_CREDENTIAL")
        self.b2c_result_url = _env("DARAJA_B2C_RESULT_URL")
        self.b2c_timeout_url = _env("DARAJA_B2C_TIMEOUT_URL")
        self.mock = _env("DARAJA_MOCK", "").lower() in ("true", "1", "yes") or (
            not self.consumer_key or not self.consumer_secret
        )

    @property
    def base_url(self) -> str:
        return _DARAJA_BASE_URLS.get(self.environment, _DARAJA_BASE_URLS["sandbox"])

    def status(self) -> dict:
        return {
            "enabled": not self.mock,
            "mock": self.mock,
            "environment": self.environment,
            "shortcode": f"{self.shortcode[:2]}****{self.shortcode[-2:]}" if len(self.shortcode) > 4 else self.shortcode,
        }


config = DarajaConfig()


def _password(shortcode: str, passkey: str) -> str:
    """Daraja timestamped password: base64(shortcode + passkey + timestamp)."""
    ts = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    data = f"{shortcode}{passkey}{ts}"
    return b64encode(data.encode()).decode(), ts


def get_access_token() -> str:
    """Fetch an OAuth access token from Safaricom."""
    if config.mock:
        return f"mock-access-token-{secrets.token_hex(8)}"
    resp = httpx.get(
        f"{config.base_url}{_TOKEN_URL}",
        auth=(config.consumer_key, config.consumer_secret),
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


def chargeable_amount(amount: float) -> float:
    """Round a figure to what Daraja will actually charge.

    Daraja only accepts whole currency units, so a bill of 4,499.64 is charged
    as 4,500. Both the push and the callback verification go through this
    function so a rounding change can never make a clean payment look short.

    Note this is Python's banker's rounding, inherited from what the push
    already sent, so an exact half (100.50) goes down to 100. That is the
    behaviour already in the field; changing it would change what customers
    are charged.
    """
    return float(int(round(float(amount))))


def expected_charge(sale) -> float:
    """The amount a sale's STK push should have requested.

    ``payment_provider_amount`` is written when the sale is created, and for a
    restaurant ticket it is the bill plus the tip - the same figure the printed
    receipt totals. Falling back to the sale total covers sales created before
    the amount was recorded.
    """
    recorded = getattr(sale, "payment_provider_amount", None)
    if recorded is not None:
        return chargeable_amount(recorded)
    return chargeable_amount(sale.total_amount)


def classify_payment_amount(expected: float, received: float | None) -> str:
    """Compare what we asked for against what M-Pesa reports as paid.

    Returns "matched", "short", "over", or "unknown" when the callback carried
    no amount. Uses a half-unit band because both figures are whole currency
    units by the time they are compared.
    """
    if received is None:
        return "unknown"
    delta = float(received) - float(expected)
    if abs(delta) < 0.5:
        return "matched"
    return "over" if delta > 0 else "short"


def stk_push(phone: str, amount: float, reference: str, description: str = "Payment", account_ref: str = "") -> dict:
    """Initiate an M-Pesa STK Push (Lipa Na MPesa Online).

    Args:
        phone:    Customer phone in 254XXXXXXXXX format.
        amount:   Amount to charge (whole currency units, no decimals for KES).
        reference: Invoice / transaction number.
        description: Short description shown to customer.
        account_ref: Business account reference (optional).

    Returns:
        {"checkout_request_id": str, "merchant_request_id": str, "response_code": str, "response_description": str}
    """
    if config.mock:
        global _mock_counter
        _mock_counter += 1
        return {
            "checkout_request_id": f"ws_CO_{secrets.token_hex(6).upper()}",
            "merchant_request_id": str(1000 + _mock_counter),
            "response_code": "0",
            "response_description": "Success. Request accepted for processing",
        }

    token = get_access_token()
    password, timestamp = _password(config.shortcode, config.passkey)
    payload = {
        "BusinessShortCode": config.shortcode,
        "Password": password,
        "Timestamp": timestamp,
        "TransactionType": "CustomerPayBillOnline",
        "Amount": int(chargeable_amount(amount)),
        "PartyA": phone,
        "PartyB": config.shortcode,
        "PhoneNumber": phone,
        "CallBackURL": config.callback_url,
        "AccountReference": account_ref or reference[:12],
        "TransactionDesc": description[:13],
    }
    resp = httpx.post(
        f"{config.base_url}{_STK_PUSH_URL}",
        json=payload,
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )
    resp.raise_for_status()
    body = resp.json()
    return {
        "checkout_request_id": body.get("CheckoutRequestID", ""),
        "merchant_request_id": body.get("MerchantRequestID", ""),
        "response_code": body.get("ResponseCode", ""),
        "response_description": body.get("ResponseDescription", ""),
    }


def b2c_payment(phone: str, amount: float, reference: str, remarks: str = "Refund", occasion: str = "") -> dict:
    """Initiate an M-Pesa B2C payment (business-to-customer payout / refund).

    Args:
        phone:     Recipient phone in 254XXXXXXXXX format.
        amount:    Amount to send.
        reference: Transaction reference.
        remarks:   Remarks sent to recipient.
        occasion:  Optional occasion text.

    Returns:
        {"originator_conversation_id": str, "conversation_id": str, "response_code": str, "response_description": str}
    """
    if config.mock:
        global _mock_counter
        _mock_counter += 1
        return {
            "originator_conversation_id": f"sid_{secrets.token_hex(8)}",
            "conversation_id": f"R_{secrets.token_hex(6).upper()}",
            "response_code": "0",
            "response_description": "Accept the service request successfully.",
        }

    token = get_access_token()
    payload = {
        "InitiatorName": config.initiator_name,
        "SecurityCredential": config.security_credential,
        "CommandID": "BusinessPayment",
        "Amount": int(round(amount)),
        "PartyA": config.shortcode,
        "PartyB": phone,
        "Remarks": remarks[:12],
        "QueueTimeOutURL": config.b2c_timeout_url,
        "ResultURL": config.b2c_result_url,
        "Occasion": occasion[:12],
    }
    resp = httpx.post(
        f"{config.base_url}{_B2C_URL}",
        json=payload,
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )
    resp.raise_for_status()
    body = resp.json()
    return {
        "originator_conversation_id": body.get("OriginatorConversationID", ""),
        "conversation_id": body.get("ConversationID", ""),
        "response_code": body.get("ResponseCode", ""),
        "response_description": body.get("ResponseDescription", ""),
    }


def parse_stk_callback(body: dict) -> dict:
    """Parse an M-Pesa STK Push callback into a flat dict.

    Returns:
        {"result_code": str, "result_desc": str, "checkout_request_id": str,
         "merchant_request_id": str, "mpesa_receipt_number": str, "amount": float|None}
    """
    cb = body.get("Body", {}).get("stkCallback", {})
    result_code = str(cb.get("ResultCode", ""))
    result_desc = cb.get("ResultDesc", "")
    checkout = cb.get("CheckoutRequestID", "")
    merchant = cb.get("MerchantRequestID", "")
    receipt = ""
    amount = None
    for item in cb.get("CallbackMetadata", {}).get("Item", []):
        if item.get("Name") == "MpesaReceiptNumber":
            receipt = item.get("Value", "")
        elif item.get("Name") == "Amount":
            amount = float(item.get("Value", 0))
    return {
        "result_code": result_code,
        "result_desc": result_desc,
        "checkout_request_id": checkout,
        "merchant_request_id": merchant,
        "mpesa_receipt_number": receipt,
        "amount": amount,
    }


def parse_b2c_callback(body: dict) -> dict:
    """Parse an M-Pesa B2C callback into a flat dict.

    Returns:
        {"result_code": str, "result_desc": str, "conversation_id": str,
         "originator_conversation_id": str, "transaction_id": str}
    """
    result = body.get("Result", {})
    return {
        "result_code": str(result.get("ResultCode", "")),
        "result_desc": result.get("ResultDesc", ""),
        "conversation_id": result.get("ConversationID", ""),
        "originator_conversation_id": result.get("OriginatorConversationID", ""),
        "transaction_id": result.get("TransactionID", ""),
    }
