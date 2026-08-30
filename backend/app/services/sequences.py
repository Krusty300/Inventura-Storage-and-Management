from sqlalchemy import text
from sqlalchemy.orm import Session


def _get_prefix(db: Session, name: str, default: str) -> str:
    """Read document prefix from settings, falling back to default."""
    from app.models.settings import Settings
    s = db.query(Settings).first()
    if not s:
        return default
    prefix_map = {
        "shipment": s.shipment_prefix,
        "work_order": s.work_order_prefix,
        "invoice": s.invoice_prefix,
        "purchase_order": s.po_prefix,
        "receipt": s.receipt_prefix,
        "asn": s.asn_prefix,
        "quality_check": s.qc_prefix,
        "cycle_count": s.cc_prefix,
        "return": s.return_prefix,
        "transfer": s.transfer_prefix,
        "unallocated_move": s.unallocated_prefix,
        "quarantine": s.quarantine_prefix,
        "lpn": s.lpn_prefix,
        "lpn_move": s.lpn_move_prefix,
        "lpn_load": s.lpn_load_prefix,
        "lpn_unload": s.lpn_unload_prefix,
        "stock_in": s.stock_in_prefix,
        "stock_out": s.stock_out_prefix,
        "adjustment": s.adjustment_prefix,
    }
    return prefix_map.get(name, default)


def next_document_number(db: Session, name: str, prefix: str, width: int = 4) -> str:
    """Atomically allocate the next sequential document number.

    Uses an upsert on a single counter row so concurrent calls never receive
    the same number. If the surrounding transaction rolls back the allocated
    number is skipped (gaps are acceptable).

    The prefix is stored bare in settings (e.g. ``INV``); a trailing hyphen is
    applied here so generated numbers read ``INV-0001``.
    """
    prefix = _get_prefix(db, name, prefix)
    prefix = prefix.rstrip("-") + "-" if prefix else ""
    row = db.execute(
        text(
            "INSERT INTO document_sequences (name, next_value) VALUES (:name, 1) "
            "ON CONFLICT(name) DO UPDATE SET next_value = next_value + 1 "
            "RETURNING next_value"
        ),
        {"name": name},
    ).first()
    num = row[0] if row else 1
    return f"{prefix}{num:0{width}d}"
