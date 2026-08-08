from tests.conftest import client


def _loc(auth_headers, code):
    return client.post("/api/locations", json={"name": f"Loc {code}", "code": code}, headers=auth_headers).json()


def test_serialized_pallet_label_pdf(auth_headers):
    loc = _loc(auth_headers, "PL-SER")
    lpn = client.post("/api/lpns", json={"lpn_type": "pallet", "location_id": loc["id"]}, headers=auth_headers).json()
    prod = client.post("/api/products", json={"location_id": 1,
        "sku": "PL-SER-P", "name": "Pallet Serial", "unit_price": 1.0, "quantity": 0, "is_serialized": True,
    }, headers=auth_headers).json()
    assert client.post("/api/receipts", json={
        "items": [{"product_id": prod["id"], "quantity": 3, "serial_numbers": ["PAL-S1", "PAL-S2", "PAL-S3"],
                   "location_id": loc["id"], "lpn_id": lpn["id"]}],
    }, headers=auth_headers).status_code == 201

    resp = client.get(f"/api/labels/pallet/{lpn['id']}", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.content[:4] == b"%PDF"


def test_mixed_pallet_label_pdf(auth_headers):
    loc = _loc(auth_headers, "PL-MIX")
    lpn = client.post("/api/lpns", json={"lpn_type": "pallet", "location_id": loc["id"]}, headers=auth_headers).json()
    bulk = client.post("/api/products", json={"location_id": 1,
        "sku": "PL-MIX-B", "name": "Pallet Bulk", "unit_price": 1.0, "quantity": 0,
    }, headers=auth_headers).json()
    ser = client.post("/api/products", json={"location_id": 1,
        "sku": "PL-MIX-S", "name": "Pallet Ser", "unit_price": 1.0, "quantity": 0, "is_serialized": True,
    }, headers=auth_headers).json()
    assert client.post("/api/receipts", json={
        "items": [
            {"product_id": bulk["id"], "quantity": 4, "location_id": loc["id"], "lpn_id": lpn["id"]},
            {"product_id": ser["id"], "quantity": 2, "serial_numbers": ["MX-S1", "MX-S2"],
             "location_id": loc["id"], "lpn_id": lpn["id"]},
        ],
    }, headers=auth_headers).status_code == 201

    resp = client.get(f"/api/labels/pallet/{lpn['id']}", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.content[:4] == b"%PDF"
