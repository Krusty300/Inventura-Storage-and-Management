import hmac
import os

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.database import get_db
from app.models.sale import Sale
from app.services.auth import require_permission
from app.services.daraja import config as daraja_config, stk_push, b2c_payment, parse_stk_callback, parse_b2c_callback
from app.utils import broadcast_change

router = APIRouter(prefix="/api/daraja", tags=["daraja"])


def _verify_callback_secret(request: Request) -> None:
    """Verify the callback shared secret to prevent forged payment callbacks.

    The query parameter ``secret`` must match ``DARAJA_CALLBACK_SECRET`` when
    the env var is set.  In mock mode without a configured secret the check is
    skipped so local dev remains frictionless.
    """
    secret = os.getenv("DARAJA_CALLBACK_SECRET", "").strip()
    if not secret:
        if not daraja_config.mock:
            raise HTTPException(status_code=500, detail="DARAJA_CALLBACK_SECRET is not configured")
        return
    provided = request.query_params.get("secret", "")
    if not hmac.compare_digest(provided, secret):
        raise HTTPException(status_code=403, detail="Invalid callback secret")


class StkPushRequest(BaseModel):
    phone: str
    amount: float
    reference: str = ""
    description: str = "Payment"
    account_ref: str = ""


class B2CRefundRequest(BaseModel):
    phone: str
    amount: float
    sale_id: int | None = None
    reference: str = ""
    remarks: str = "Refund"


@router.get("/status")
def daraja_status(user=Depends(require_permission("sales.view"))):
    return daraja_config.status()


@router.post("/stk-push")
def initiate_stk_push(body: StkPushRequest, user=Depends(require_permission("sales.create"))):
    if body.phone.startswith("0"):
        body.phone = "254" + body.phone[1:]
    if not body.phone.startswith("254") or len(body.phone) < 10:
        raise HTTPException(status_code=400, detail="Phone must be in 254XXXXXXXXX format")
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    result = stk_push(
        phone=body.phone,
        amount=body.amount,
        reference=body.reference,
        description=body.description,
        account_ref=body.account_ref,
    )
    return {
        "success": result["response_code"] == "0",
        "checkout_request_id": result.get("checkout_request_id", ""),
        "merchant_request_id": result.get("merchant_request_id", ""),
        "message": result.get("response_description", ""),
    }


@router.post("/mock-confirm")
def mock_stk_confirm(checkout_request_id: str = "", db=Depends(get_db), user=Depends(require_permission("sales.refund"))):
    """Simulate an STK Push callback for testing without Safaricom."""
    if not daraja_config.mock:
        raise HTTPException(status_code=403, detail="mock-confirm is only available in mock mode")
    checkout_id = checkout_request_id or "ws_CO_MOCK123"
    sale = db.query(Sale).filter(Sale.payment_checkout_request_id == checkout_id).first()
    if sale:
        if sale.payment_status != "pending":
            raise HTTPException(status_code=400, detail=f"Sale payment status is '{sale.payment_status}' — can only confirm pending payments")
        sale.payment_status = "completed"
        sale.status = "completed"
        from app.routers.restaurant import confirm_ticket_payment
        confirm_ticket_payment(db, sale.id)
        from app.utils import log_activity, broadcast_change
        db.commit()
        log_activity(db, user.id, user.username, "update", "sale", sale.id, f"Mock STK confirmed for {sale.invoice_number}")
        broadcast_change("sale", "updated")
    return {"success": True, "checkout_request_id": checkout_id, "message": "Mock STK confirmation processed"}


@router.post("/b2c-refund")
def initiate_b2c_refund(body: B2CRefundRequest, db=Depends(get_db), user=Depends(require_permission("sales.refund"))):
    if body.phone.startswith("0"):
        body.phone = "254" + body.phone[1:]
    if not body.phone.startswith("254") or len(body.phone) < 10:
        raise HTTPException(status_code=400, detail="Phone must be in 254XXXXXXXXX format")
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    result = b2c_payment(
        phone=body.phone,
        amount=body.amount,
        reference=body.reference,
        remarks=body.remarks,
    )
    conversation_id = result.get("conversation_id", "")
    if body.sale_id and conversation_id:
        sale = db.query(Sale).filter(Sale.id == body.sale_id).first()
        if sale:
            sale.refund_checkout_request_id = conversation_id
            sale.refund_status = "pending"
            db.commit()
            broadcast_change("sale", "updated")
    return {
        "success": result["response_code"] == "0",
        "conversation_id": conversation_id,
        "originator_conversation_id": result.get("originator_conversation_id", ""),
        "message": result.get("response_description", ""),
    }


@router.post("/callback/stk")
async def stk_callback(request: Request, db=Depends(get_db)):
    _verify_callback_secret(request)
    body = await request.json()
    parsed = parse_stk_callback(body)
    if parsed["checkout_request_id"]:
        sale = db.query(Sale).filter(Sale.payment_checkout_request_id == parsed["checkout_request_id"]).first()
        if sale:
            if parsed["result_code"] == "0":
                if sale.payment_status == "pending":
                    sale.payment_status = "completed"
                    sale.status = "completed"
                    receipt = parsed.get("mpesa_receipt_number", "")
                    if receipt:
                        sale.payment_reference = receipt
                from app.routers.restaurant import confirm_ticket_payment
                confirm_ticket_payment(db, sale.id)
            else:
                sale.payment_status = "failed"
                if sale.status == "pending":
                    from app.routers.sales import _restore_stock_for_sale
                    _restore_stock_for_sale(db, sale, reason="STK failure")
                    sale.status = "cancelled"
                    sale.payment_status = "cancelled"
            from app.utils import log_activity, broadcast_change
            db.commit()
            log_activity(db, 0, "system", "update", "sale", sale.id, f"STK callback: {parsed['result_desc']}")
            broadcast_change("sale", "updated")
            broadcast_change("stock_movement", "created")
    return {"ResultCode": 0, "ResultDesc": "OK"}


@router.post("/callback/b2c")
async def b2c_callback(request: Request, db=Depends(get_db)):
    _verify_callback_secret(request)
    body = await request.json()
    parsed = parse_b2c_callback(body)
    from datetime import datetime, timezone
    from app.utils import log_activity, broadcast_change
    if parsed["conversation_id"]:
        sale = db.query(Sale).filter(Sale.refund_checkout_request_id == parsed["conversation_id"]).first()
        if sale:
            if parsed["result_code"] == "0":
                sale.refund_status = "completed"
                sale.refunded_at = datetime.now(timezone.utc)
            elif sale.refund_status != "completed":
                sale.refund_status = "failed"
            db.commit()
            log_activity(db, 0, "system", "update", "sale", sale.id, f"B2C callback: {parsed['result_desc']}")
            broadcast_change("sale", "updated")
    return {"ResultCode": 0, "ResultDesc": "OK"}
