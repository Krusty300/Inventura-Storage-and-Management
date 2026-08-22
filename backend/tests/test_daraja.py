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
