from datetime import date, datetime, timezone

from sqlalchemy.orm import Session

from app.models.notification import Notification
from app.models.product import Product
from app.models.settings import Settings
from app.models.user import User
from app.utils import broadcast_change_user


def _get_settings(db: Session) -> Settings:
    s = db.query(Settings).first()
    if not s:
        s = Settings(store_name="My Store", currency_symbol="$")
        db.add(s)
        db.flush()
        db.refresh(s)
    return s


def create_notification(db: Session, user_id: int, title: str, message: str = "", type: str = "info", link: str = "") -> Notification:
    n = Notification(
        user_id=user_id, title=title, message=message, type=type, link=link,
        # Set explicitly: existing SQLite tables predate server_default and
        # have no DEFAULT clause, leaving created_at NULL otherwise.
        created_at=datetime.now(timezone.utc),
    )
    db.add(n)
    broadcast_change_user(user_id, "notification", "created")
    return n


def _admin_users(db: Session, *, exclude_user_id: int | None = None):
    admins = db.query(User).filter(User.is_active == True, User.role.in_(["admin", "manager"])).all()
    if exclude_user_id is None:
        return admins
    filtered = [a for a in admins if a.id != exclude_user_id]
    # If the actor is the only eligible admin, keep them so at least one
    # recipient always gets the notification (single-admin installs).
    return filtered if filtered else admins


def notify_admins(db: Session, title: str, message: str = "", type: str = "info", link: str = "", exclude_user_id: int | None = None) -> list[Notification]:
    created = []
    for admin in _admin_users(db, exclude_user_id=exclude_user_id):
        created.append(create_notification(db, admin.id, title, message, type, link))
    return created


def notify_note_assigned(db: Session, note, assigner_name: str) -> None:
    if note.assigned_to_id is None:
        return
    create_notification(
        db, note.assigned_to_id,
        "Note assigned to you",
        f'"{note.title}" was assigned by {assigner_name}.',
        type="info", link="/notes",
    )
    db.commit()


def notify_low_stock(db: Session, product: Product) -> list[Notification]:
    s = _get_settings(db)
    if not s.low_stock_alerts:
        return []
    # Deferred import: inventory.py imports notify_lot_expired from this module.
    from app.services import inventory
    sellable = inventory.sellable_qty_by_product(db, [product.id]).get(product.id, 0)
    if sellable > product.reorder_level:
        return []
    title = f"Low stock: {product.display_name}"
    created = []
    for admin in _admin_users(db):
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
            f"Only {sellable} left (reorder level {product.reorder_level}).",
            type="warning", link="/products",
        ))
    return created


def notify_expiring(db: Session, product: Product) -> list[Notification]:
    s = _get_settings(db)
    if not s.expiry_alerts:
        return []
    if not product.expiry_date:
        return []
    today = date.today()
    days_left = (product.expiry_date - today).days
    if days_left < 0:
        title = f"Expired stock: {product.display_name}"
        message = f"Batch {product.batch_number or '—'} expired on {product.expiry_date.isoformat()}."
        link = "/products"
    elif days_left <= s.expiry_warning_days:
        title = f"Expiring soon: {product.display_name}"
        message = f"Batch {product.batch_number or '—'} expires in {days_left} day(s)."
        link = "/products"
    else:
        return []
    created = []
    for admin in _admin_users(db):
        already = db.query(Notification).filter(
            Notification.user_id == admin.id,
            Notification.type == "warning",
            Notification.title == title,
            Notification.is_read == False,  # noqa: E712
        ).first()
        if already:
            continue
        created.append(create_notification(
            db, admin.id, title, message,
            type="warning", link=link,
        ))
    return created


def notify_lot_expired(db: Session, lot) -> list[Notification]:
    """Warn admins that a lot was auto-marked expired by the expiry sweep."""
    s = _get_settings(db)
    if not s.expiry_alerts:
        return []
    product_name = lot.product.display_name if lot.product else "Unknown product"
    title = f"Expired stock: {product_name}"
    message = (
        f"Lot {lot.lot_number} expired on {lot.expiry_date.isoformat() if lot.expiry_date else '—'} "
        f"and was marked expired."
    )
    created = []
    for admin in _admin_users(db):
        already = db.query(Notification).filter(
            Notification.user_id == admin.id,
            Notification.type == "warning",
            Notification.title == title,
            Notification.is_read == False,  # noqa: E712
        ).first()
        if already:
            continue
        created.append(create_notification(
            db, admin.id, title, message,
            type="warning", link="/lots",
        ))
    return created
