from sqlalchemy.orm import Session

from app.services.sequences import next_document_number


def create_order_number(db: Session) -> str:
    return next_document_number(db, "purchase_order", "PO-")
