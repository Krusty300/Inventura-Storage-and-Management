from datetime import datetime

from sqlalchemy.orm import Session

from app.models.order import Order


def create_order_number(db: Session) -> str:
    today = datetime.now().strftime("%Y%m%d")
    last = (
        db.query(Order)
        .filter(Order.order_number.like(f"PO-{today}-%"))
        .order_by(Order.id.desc())
        .first()
    )
    if last:
        seq = int(last.order_number.split("-")[-1]) + 1
    else:
        seq = 1
    return f"PO-{today}-{seq:04d}"
