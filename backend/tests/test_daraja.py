from tests.conftest import TestingSessionLocal, client


def _make_cash_sale(auth_headers, sku="DK-PROD"):
    prod = client.post("/api/products", json={"location_id": 1, "sku": sku, "name": f"DK {sku}", "unit_price": 10.0, "quantity": 20}, headers=auth_headers).json()
    return client.post("/api/sales", json={
        "items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 10.0}],
    }, headers=auth_headers).json()


def _make_mm_sale(auth_headers, sku="DK-MM"):
    prod = client.post("/api/products", json={"location_id": 1, "sku": sku, "name": f"DK {sku}", "unit_price": 10.0, "quantity": 20}, headers=auth_headers).json()
    return client.post("/api/sales", json={
        "items": [{"product_id": prod["id"], "quantity": 1, "unit_price": 10.0}],
        "payment_method": "mobile_money",
        "payment_provider": "m-pesa",
        "payment_provider_amount": 10.0,
        "currency": "KES",
        "payment_phone": "254712345678",
    }, headers=auth_headers).json()


def _set_stk_fields(sale_id, checkout_id):
    db = TestingSessionLocal()
    from app.models.sale import Sale
    sale = db.query(Sale).filter(Sale.id == sale_id).first()
    sale.payment_checkout_request_id = checkout_id
    db.commit()
    db.close()


def test_stk_callback_confirms_sale(auth_headers):
    sale = _make_mm_sale(auth_headers, "DK-STK1")
    _set_stk_fields(sale["id"], "ws_CO_TEST123")

    callback_body = {
        "Body": {
            "stkCallback": {
                "MerchantRequestID": "mrq-test",
                "CheckoutRequestID": "ws_CO_TEST123",
                "ResultCode": 0,
                "ResultDesc": "Success",
                "CallbackMetadata": {
                    "Item": [
                        {"Name": "Amount", "Value": 10.0},
                        {"Name": "MpesaReceiptNumber", "Value": "QHK01ABCDEF"},
                    ]
                },
            }
        }
    }
    resp = client.post("/api/daraja/callback/stk", json=callback_body)
    assert resp.status_code == 200
    assert resp.json()["ResultCode"] == 0

    updated = client.get(f"/api/sales/{sale['id']}", headers=auth_headers).json()
    assert updated["payment_status"] == "completed"
    assert updated["status"] == "completed"
    assert updated["payment_reference"] == "QHK01ABCDEF"


def test_stk_callback_failure_cancels_sale(auth_headers):
    sale = _make_mm_sale(auth_headers, "DK-STK2")
    _set_stk_fields(sale["id"], "ws_CO_FAIL456")

    callback_body = {
        "Body": {
            "stkCallback": {
                "MerchantRequestID": "mrq-fail",
                "CheckoutRequestID": "ws_CO_FAIL456",
                "ResultCode": 1032,
                "ResultDesc": "Request cancelled by user",
            }
        }
    }
    resp = client.post("/api/daraja/callback/stk", json=callback_body)
    assert resp.status_code == 200

    updated = client.get(f"/api/sales/{sale['id']}", headers=auth_headers).json()
    assert updated["status"] == "cancelled"
    assert updated["payment_status"] == "cancelled"


def test_stk_callback_late_success_does_not_recomplete_cancelled_sale(auth_headers):
    sale = _make_mm_sale(auth_headers, "DK-STK3")
    _set_stk_fields(sale["id"], "ws_CO_LATE789")
    # The sale is cancelled before the STK success callback arrives (e.g. the
    # operator refunded/cancelled manually). A late 0 result must not flip it
    # back to completed.
    client.patch("/api/sales/bulk-edit", json={"ids": [sale["id"]], "payment_status": "cancelled"}, headers=auth_headers)

    callback_body = {
        "Body": {
            "stkCallback": {
                "MerchantRequestID": "mrq-late",
                "CheckoutRequestID": "ws_CO_LATE789",
                "ResultCode": 0,
                "ResultDesc": "Success",
                "CallbackMetadata": {
                    "Item": [
                        {"Name": "MpesaReceiptNumber", "Value": "QHK0LATE7"},
                    ]
                },
            }
        }
    }
    resp = client.post("/api/daraja/callback/stk", json=callback_body)
    assert resp.status_code == 200
    assert resp.json()["ResultCode"] == 0

    updated = client.get(f"/api/sales/{sale['id']}", headers=auth_headers).json()
    assert updated["payment_status"] == "cancelled"
    assert updated["status"] != "completed"
    assert updated["payment_reference"] is None


def test_b2c_callback_updates_refund(auth_headers):
    sale = _make_cash_sale(auth_headers, "DK-B2C1")

    db = TestingSessionLocal()
    from app.models.sale import Sale
    db_sale = db.query(Sale).filter(Sale.id == sale["id"]).first()
    db_sale.refund_checkout_request_id = "CONV-TEST-123"
    db_sale.refund_status = "pending"
    db.commit()
    db.close()

    callback_body = {
        "Result": {
            "ConversationID": "CONV-TEST-123",
            "OriginatorConversationID": "ORIG-123",
            "ResultCode": 0,
            "ResultDesc": "Success",
        }
    }
    resp = client.post("/api/daraja/callback/b2c", json=callback_body)
    assert resp.status_code == 200

    updated = client.get(f"/api/sales/{sale['id']}", headers=auth_headers).json()
    assert updated["refund_status"] == "completed"
    assert updated["refunded_at"] is not None


def test_b2c_callback_failure(auth_headers):
    sale = _make_cash_sale(auth_headers, "DK-B2C2")

    db = TestingSessionLocal()
    from app.models.sale import Sale
    db_sale = db.query(Sale).filter(Sale.id == sale["id"]).first()
    db_sale.refund_checkout_request_id = "CONV-FAIL-456"
    db_sale.refund_status = "pending"
    db.commit()
    db.close()

    callback_body = {
        "Result": {
            "ConversationID": "CONV-FAIL-456",
            "OriginatorConversationID": "ORIG-456",
            "ResultCode": 1,
            "ResultDesc": "Insufficient funds",
        }
    }
    resp = client.post("/api/daraja/callback/b2c", json=callback_body)
    assert resp.status_code == 200

    updated = client.get(f"/api/sales/{sale['id']}", headers=auth_headers).json()
    assert updated["refund_status"] == "failed"


def test_mock_stk_confirm(auth_headers):
    sale = _make_mm_sale(auth_headers, "DK-MOCK")
    _set_stk_fields(sale["id"], "ws_CO_MOCK999")

    resp = client.post("/api/daraja/mock-confirm", params={"checkout_request_id": "ws_CO_MOCK999"}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["success"] is True


def test_stk_push_validation(auth_headers):
    resp = client.post("/api/daraja/stk-push", json={"phone": "0712345678", "amount": 0}, headers=auth_headers)
    assert resp.status_code == 400
    assert "Amount must be positive" in resp.json()["detail"]

    resp = client.post("/api/daraja/stk-push", json={"phone": "12345", "amount": 100}, headers=auth_headers)
    assert resp.status_code == 400
    assert "Phone must be in 254" in resp.json()["detail"]


def test_b2c_refund_validation(auth_headers):
    resp = client.post("/api/daraja/b2c-refund", json={"phone": "0712345678", "amount": 0}, headers=auth_headers)
    assert resp.status_code == 400

    resp = client.post("/api/daraja/b2c-refund", json={"phone": "12345", "amount": 100}, headers=auth_headers)
    assert resp.status_code == 400
    assert "Phone must be in 254" in resp.json()["detail"]


def test_daraja_status(auth_headers):
    resp = client.get("/api/daraja/status", headers=auth_headers)
    assert resp.status_code == 200
    assert "mock" in resp.json()


def _stk_callback(checkout_id, result_code=0, amount=None, receipt="QHK9TEST"):
    items = []
    if amount is not None:
        items.append({"Name": "Amount", "Value": amount})
    if receipt:
        items.append({"Name": "MpesaReceiptNumber", "Value": receipt})
    return {
        "Body": {
            "stkCallback": {
                "MerchantRequestID": "mrq-amt",
                "CheckoutRequestID": checkout_id,
                "ResultCode": result_code,
                "ResultDesc": "Success" if result_code == 0 else "Request cancelled by user",
                "CallbackMetadata": {"Item": items},
            }
        }
    }


def test_stk_callback_records_matching_amount(auth_headers):
    sale = _make_mm_sale(auth_headers, "DK-AMT1")
    _set_stk_fields(sale["id"], "ws_CO_AMT1")

    resp = client.post("/api/daraja/callback/stk", json=_stk_callback("ws_CO_AMT1", amount=10.0))
    assert resp.status_code == 200

    updated = client.get(f"/api/sales/{sale['id']}", headers=auth_headers).json()
    assert updated["payment_amount_received"] == 10.0
    assert updated["payment_amount_status"] == "matched"


def test_stk_callback_keeps_short_payment_and_flags_it(auth_headers):
    sale = _make_mm_sale(auth_headers, "DK-AMT2")
    _set_stk_fields(sale["id"], "ws_CO_AMT2")

    # The customer authorised 4 of a 10 bill. The money is gone from their
    # M-Pesa, so the sale stays paid and the difference is raised for review.
    resp = client.post("/api/daraja/callback/stk", json=_stk_callback("ws_CO_AMT2", amount=4.0))
    assert resp.status_code == 200

    updated = client.get(f"/api/sales/{sale['id']}", headers=auth_headers).json()
    assert updated["payment_status"] == "completed"
    assert updated["status"] == "completed"
    assert updated["payment_amount_received"] == 4.0
    assert updated["payment_amount_status"] == "short"


def test_stk_callback_flags_over_payment(auth_headers):
    sale = _make_mm_sale(auth_headers, "DK-AMT3")
    _set_stk_fields(sale["id"], "ws_CO_AMT3")

    client.post("/api/daraja/callback/stk", json=_stk_callback("ws_CO_AMT3", amount=25.0))

    updated = client.get(f"/api/sales/{sale['id']}", headers=auth_headers).json()
    assert updated["payment_status"] == "completed"
    assert updated["payment_amount_status"] == "over"


def test_stk_callback_without_amount_is_unknown_not_matched(auth_headers):
    sale = _make_mm_sale(auth_headers, "DK-AMT4")
    _set_stk_fields(sale["id"], "ws_CO_AMT4")

    client.post("/api/daraja/callback/stk", json=_stk_callback("ws_CO_AMT4"))

    updated = client.get(f"/api/sales/{sale['id']}", headers=auth_headers).json()
    assert updated["payment_status"] == "completed"
    assert updated["payment_amount_received"] is None
    assert updated["payment_amount_status"] == "unknown"


def test_failed_callback_leaves_amount_unverified(auth_headers):
    sale = _make_mm_sale(auth_headers, "DK-AMT5")
    _set_stk_fields(sale["id"], "ws_CO_AMT5")

    client.post("/api/daraja/callback/stk", json=_stk_callback("ws_CO_AMT5", result_code=1032, amount=10.0))

    updated = client.get(f"/api/sales/{sale['id']}", headers=auth_headers).json()
    assert updated["payment_status"] == "cancelled"
    assert updated["payment_amount_status"] is None


def test_mock_confirm_marks_amount_matched(auth_headers):
    sale = _make_mm_sale(auth_headers, "DK-AMT6")
    _set_stk_fields(sale["id"], "ws_CO_AMT6")

    client.post("/api/daraja/mock-confirm", params={"checkout_request_id": "ws_CO_AMT6"}, headers=auth_headers)

    updated = client.get(f"/api/sales/{sale['id']}", headers=auth_headers).json()
    assert updated["payment_amount_status"] == "matched"


def test_sale_stk_push_uses_server_amount(auth_headers):
    sale = _make_mm_sale(auth_headers, "DK-AMT7")
    _set_stk_fields(sale["id"], "ws_CO_AMT7")
    db = TestingSessionLocal()
    from app.models.sale import Sale
    row = db.query(Sale).filter(Sale.id == sale["id"]).first()
    row.payment_provider_amount = 55.0
    db.commit()
    db.close()

    # A client-supplied amount must be ignored: the sale's own figure wins.
    resp = client.post(f"/api/sales/{sale['id']}/stk-push", json={"amount": 1.0, "phone": "254712345678"}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["success"] is True
    assert resp.json()["amount"] == 55.0

    updated = client.get(f"/api/sales/{sale['id']}", headers=auth_headers).json()
    assert updated["payment_checkout_request_id"] != "ws_CO_AMT7"


def test_sale_stk_push_rejects_cash_sale(auth_headers):
    sale = _make_cash_sale(auth_headers, "DK-AMT8")
    resp = client.post(f"/api/sales/{sale['id']}/stk-push", json={}, headers=auth_headers)
    assert resp.status_code == 400
    assert "mobile money" in resp.json()["detail"]


def test_sale_stk_push_rejects_already_paid_sale(auth_headers):
    sale = _make_mm_sale(auth_headers, "DK-AMT9")
    _set_stk_fields(sale["id"], "ws_CO_AMT9")
    client.post("/api/daraja/callback/stk", json=_stk_callback("ws_CO_AMT9", amount=10.0))

    resp = client.post(f"/api/sales/{sale['id']}/stk-push", json={}, headers=auth_headers)
    assert resp.status_code == 400
    assert "only pending payments" in resp.json()["detail"]


def test_expected_charge_rounds_to_whole_units():
    from app.services.daraja import chargeable_amount, classify_payment_amount

    # Daraja sends int(round(amount)), so verification must use the same figure.
    assert chargeable_amount(4499.64) == 4500.0
    assert chargeable_amount(100.0) == 100.0
    # Banker's rounding, matching what the push has always sent.
    assert chargeable_amount(100.5) == 100.0
    assert chargeable_amount(100.64) == 101.0

    assert classify_payment_amount(4500.0, 4500.0) == "matched"
    assert classify_payment_amount(4500.0, 4500.4) == "matched"
    assert classify_payment_amount(4500.0, 4000.0) == "short"
    assert classify_payment_amount(4500.0, 5000.0) == "over"
    assert classify_payment_amount(4500.0, None) == "unknown"
