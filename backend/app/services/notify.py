from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.models.notification import Notification
from app.models.product import Product
from app.models.user import User
from app.utils import broadcast_change


def create_notification(db: Session, user_id: int, title: str, message: str = "", type: str = "info", link: str = "") -> Notification:
    n = Notification(user_id=user_id, title=title, message=message, type=type, link=link)
    db.add(n)
    broadcast_change("notification", "created")
    return n


def notify_admins(db: Session, title: str, message: str = "", type: str = "info", link: str = "") -> list[Notification]:
    admins = db.query(User).filter(User.role == "admin").all()
    created = []
    for admin in admins:
        created.append(create_notification(db, admin.id, title, message, type, link))
    return created


def notify_low_stock(db: Session, product: Product) -> list[Notification]:
    if product.quantity > product.reorder_level:
        return []
    title = f"Low stock: {product.display_name}"
    created = []
    for admin in db.query(User).filter(User.role == "admin").all():
        already = db.query(Notification).filter(
            Notification.user_id == admin.id,
            Notification.type == "warning",
            Notification.title == title,
            Notification.is_read == False,  # noqa: E712
        ).first()
        if already:
            continue
        created.append(create_notification(
            db, admin.id, title,
            f"Only {product.quantity} left (reorder level {product.reorder_level}).",
            type="warning", link="/products",
        ))
    return created


def notify_expiring(db: Session, product: Product) -> list[Notification]:
    if not product.expiry_date:
        return []
    today = date.today()
    days_left = (product.expiry_date - today).days
    if days_left < 0:
        return notify_admins(
            db,
            f"Expired stock: {product.display_name}",
            f"Batch {product.batch_number or '—'} expired on {product.expiry_date.isoformat()}.",
            type="warning",
            link="/products",
        )
    if days_left <= 30:
        return notify_admins(
            db,
            f"Expiring soon: {product.display_name}",
            f"Batch {product.batch_number or '—'} expires in {days_left} day(s).",
            type="warning",
            link="/products",
        )
    return []
