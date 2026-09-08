from pathlib import Path

from tests.conftest import client


PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
PDF = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF"
HTML = b"<script>alert(1)</script>"
DOCX = b"PK\x03\x04" + b"\x00" * 32  # zip/ooxml header
XLSX = b"PK\x03\x04" + b"\x00" * 32
DOC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 24  # ole compound
TXT = b"Sample invoice text content, line one.\nline two.\n"
SVG = b'<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'


def _upload(client, headers, entity_type="product", entity_id=1,
            filename="doc.pdf", data=PDF, content_type="application/pdf", doc_key=""):
    files = {"file": (filename, data, content_type)}
    data_fields = {"doc_key": doc_key} if doc_key else None
    return client.post(
        f"/api/attachments/{entity_type}/{entity_id}",
        files=files,
        data=data_fields,
        headers=headers,
    )


def test_upload_creates_document_current_version(auth_headers, monkeypatch, tmp_path):
    from app.routers import attachments as attachments_module
    monkeypatch.setattr(attachments_module, "DOC_DIR", Path(tmp_path))
    resp = _upload(client, auth_headers, filename="invoice.pdf")
    assert resp.status_code == 200
    body = resp.json()
    assert body["version"] == 1
    assert body["doc_key"] == "invoice.pdf"
    assert body["entity_type"] == "product"
    assert body["content_type"] == "application/pdf"
    assert body["url"] == f"/api/attachments/entry/{body['id']}/download"
    # the storage file exists (named with the detected extension)
    stored = [f for f in tmp_path.iterdir() if f.suffix == ".pdf"]
    assert len(stored) == 1


def test_reupload_same_doc_key_increments_version(auth_headers, monkeypatch, tmp_path):
    from app.routers import attachments as attachments_module
    monkeypatch.setattr(attachments_module, "DOC_DIR", Path(tmp_path))
    _upload(client, auth_headers, filename="contract.pdf")
    second = _upload(client, auth_headers, filename="contract.pdf")
    assert second.json()["version"] == 2
    listing = client.get("/api/attachments/product/1", headers=auth_headers).json()
    doc = next(d for d in listing if d["doc_key"] == "contract.pdf")
    assert doc["version"] == 2
    assert len(doc["versions"]) == 2


def test_different_doc_keys_are_separate_documents(auth_headers, monkeypatch, tmp_path):
    from app.routers import attachments as attachments_module
    monkeypatch.setattr(attachments_module, "DOC_DIR", Path(tmp_path))
    _upload(client, auth_headers, filename="a.pdf")
    _upload(client, auth_headers, filename="b.pdf")
    listing = client.get("/api/attachments/product/1", headers=auth_headers).json()
    assert [d["doc_key"] for d in listing] == ["a.pdf", "b.pdf"]


def test_explicit_doc_key_groups_and_increments(auth_headers, monkeypatch, tmp_path):
    from app.routers import attachments as attachments_module
    monkeypatch.setattr(attachments_module, "DOC_DIR", Path(tmp_path))
    _upload(client, auth_headers, filename="scan1.png", data=PNG, content_type="image/png", doc_key="supplier-statement")
    second = _upload(client, auth_headers, filename="scan2.png", data=PNG, content_type="image/png", doc_key="supplier-statement")
    assert second.json()["doc_key"] == "supplier-statement"
    assert second.json()["version"] == 2
    assert second.json()["original_filename"] == "scan2.png"


def test_list_document_versions_endpoint(auth_headers, monkeypatch, tmp_path):
    from app.routers import attachments as attachments_module
    monkeypatch.setattr(attachments_module, "DOC_DIR", Path(tmp_path))
    _upload(client, auth_headers, filename="doc.pdf", doc_key="report")
    _upload(client, auth_headers, filename="doc.pdf", doc_key="report")
    versions = client.get("/api/attachments/product/1/report", headers=auth_headers).json()
    assert [v["version"] for v in versions] == [1, 2]


def test_download_returns_file(auth_headers, monkeypatch, tmp_path):
    from app.routers import attachments as attachments_module
    monkeypatch.setattr(attachments_module, "DOC_DIR", Path(tmp_path))
    att = _upload(client, auth_headers, filename="download.pdf").json()
    resp = client.get(f"/api/attachments/entry/{att['id']}/download", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.content.startswith(b"%PDF-")


def test_delete_removes_document(auth_headers, monkeypatch, tmp_path):
    from app.routers import attachments as attachments_module
    monkeypatch.setattr(attachments_module, "DOC_DIR", Path(tmp_path))
    att = _upload(client, auth_headers, filename="delete.pdf").json()
    stored = [f for f in tmp_path.iterdir() if f.suffix == ".pdf"]
    assert len(stored) == 1
    resp = client.delete(f"/api/attachments/entry/{att['id']}", headers=auth_headers)
    assert resp.status_code == 200
    # Soft delete keeps the file on disk until the attachment is purged...
    assert len([f for f in tmp_path.iterdir() if f.suffix == ".pdf"]) == 1
    # ...and hides it from listings immediately.
    listing = client.get("/api/attachments/product/1", headers=auth_headers).json()
    assert listing == []
    # Purging removes the file permanently.
    assert client.delete(f"/api/trash/attachment/{att['id']}", headers=auth_headers).status_code == 200
    assert [f for f in tmp_path.iterdir() if f.suffix == ".pdf"] == []


def test_unsupported_entity_type_rejected(auth_headers, monkeypatch, tmp_path):
    from app.routers import attachments as attachments_module
    monkeypatch.setattr(attachments_module, "DOC_DIR", Path(tmp_path))
    resp = client.post(
        "/api/attachments/widget/1",
        files={"file": ("x.pdf", PDF, "application/pdf")},
        headers=auth_headers,
    )
    assert resp.status_code == 400


def test_bad_extension_rejected(auth_headers, monkeypatch, tmp_path):
    from app.routers import attachments as attachments_module
    monkeypatch.setattr(attachments_module, "DOC_DIR", Path(tmp_path))
    resp = _upload(client, auth_headers, filename="evil.html", data=HTML, content_type="text/html")
    assert resp.status_code == 400


def test_mismatched_content_rejected(auth_headers, monkeypatch, tmp_path):
    from app.routers import attachments as attachments_module
    monkeypatch.setattr(attachments_module, "DOC_DIR", Path(tmp_path))
    resp = _upload(client, auth_headers, filename="innocent.pdf", data=HTML, content_type="application/pdf")
    assert resp.status_code == 400


def test_worker_cannot_upload_customer_attachment(auth_headers, monkeypatch, tmp_path):
    from app.routers import attachments as attachments_module
    monkeypatch.setattr(attachments_module, "DOC_DIR", Path(tmp_path))
    client.post(
        "/api/users",
        json={"username": "attworker", "email": "attworker@example.com", "password": "testpass123", "role": "worker"},
        headers=auth_headers,
    )
    token = client.post("/api/auth/login", json={"username": "attworker", "password": "testpass123"}).json()["access_token"]
    worker = {"Authorization": f"Bearer {token}"}
    resp = _upload(client, worker, entity_type="customer", filename="note.pdf")
    assert resp.status_code == 403
    # worker can still view a product's documents
    ok = _upload(client, auth_headers, entity_type="product", filename="viewable.pdf")
    assert ok.status_code == 200
    listing = client.get("/api/attachments/product/1", headers=worker)
    assert listing.status_code == 200


def test_dashboard_entity_accessible_to_worker(auth_headers, monkeypatch, tmp_path):
    from app.routers import attachments as attachments_module
    monkeypatch.setattr(attachments_module, "DOC_DIR", Path(tmp_path))
    client.post(
        "/api/users",
        json={"username": "dashworker", "email": "dashworker@example.com", "password": "testpass123", "role": "worker"},
        headers=auth_headers,
    )
    token = client.post("/api/auth/login", json={"username": "dashworker", "password": "testpass123"}).json()["access_token"]
    worker = {"Authorization": f"Bearer {token}"}
    resp = _upload(client, worker, entity_type="dashboard", entity_id=0, filename="quick.pdf")
    assert resp.status_code == 200
    listing = client.get("/api/attachments/dashboard/0", headers=worker)
    assert listing.status_code == 200
    assert [d["doc_key"] for d in listing.json()] == ["quick.pdf"]


def test_office_text_and_svg_types_upload_with_derived_content_type(auth_headers, monkeypatch, tmp_path):
    from app.routers import attachments as attachments_module
    monkeypatch.setattr(attachments_module, "DOC_DIR", Path(tmp_path))
    cases = [
        ("report.docx", DOCX, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        ("sheet.xlsx", XLSX, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        ("notes.doc", DOC, "application/msword"),
        ("readme.txt", TXT, "text/plain"),
        ("data.csv", TXT, "text/csv"),
        ("logo.svg", SVG, "image/svg+xml"),
    ]
    for filename, data, expected_ct in cases:
        resp = _upload(client, auth_headers, filename=filename, data=data, doc_key=filename)
        assert resp.status_code == 200, f"{filename}: {resp.json()}"
        body = resp.json()
        assert body["content_type"] == expected_ct, filename
    listing = client.get("/api/attachments/product/1", headers=auth_headers).json()
    assert len(listing) == len(cases)


def test_masked_office_extension_rejected(auth_headers, monkeypatch, tmp_path):
    from app.routers import attachments as attachments_module
    monkeypatch.setattr(attachments_module, "DOC_DIR", Path(tmp_path))
    # a PNG masquerading as .docx must be rejected (zip magic required)
    resp = _upload(client, auth_headers, filename="fake.docx", data=PNG, content_type="application/octet-stream")
    assert resp.status_code == 400


def test_text_file_rejects_binary_content(auth_headers, monkeypatch, tmp_path):
    from app.routers import attachments as attachments_module
    monkeypatch.setattr(attachments_module, "DOC_DIR", Path(tmp_path))
    resp = _upload(client, auth_headers, filename="evil.txt", data=PNG, content_type="text/plain")
    assert resp.status_code == 400


def test_download_sets_original_filename(auth_headers, monkeypatch, tmp_path):
    from app.routers import attachments as attachments_module
    monkeypatch.setattr(attachments_module, "DOC_DIR", Path(tmp_path))
    att = _upload(client, auth_headers, filename="final-report.docx", data=DOCX).json()
    resp = client.get(f"/api/attachments/entry/{att['id']}/download", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.content[:4] == b"PK\x03\x04"
    disposition = resp.headers.get("content-disposition", "")
    assert "final-report.docx" in disposition


def test_download_requires_authentication(auth_headers, monkeypatch, tmp_path):
    from app.routers import attachments as attachments_module
    monkeypatch.setattr(attachments_module, "DOC_DIR", Path(tmp_path))
    att = _upload(client, auth_headers, filename="auth.pdf").json()
    resp = client.get(f"/api/attachments/entry/{att['id']}/download")
    assert resp.status_code in (401, 403)
