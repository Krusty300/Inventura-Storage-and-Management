from pathlib import Path
from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings

_db_path = Path(settings.database_url.replace("sqlite:///", ""))
if settings.database_url.startswith("sqlite") and _db_path.parent:
    _db_path.parent.mkdir(parents=True, exist_ok=True)

engine = create_engine(
    settings.database_url, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


if settings.database_url.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def _configure_sqlite_connection(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=10000")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.close()

    @event.listens_for(engine, "begin")
    def _begin_immediate(conn):
        conn.exec_driver_sql("BEGIN IMMEDIATE")


class Base(DeclarativeBase):
    pass


def run_migrations():
    """Apply Alembic migrations (see app.migrate)."""
    from app.migrate import run_migrations as _run
    _run()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def backfill_stock_lines():
    """Seed the stock_lines ledger from the legacy product.quantity cache.

    Runs once for databases created before the ledger existed: any product
    whose quantity is non-zero but has no stock line gets a null-location line
    so product.quantity stays equal to the ledger balance going forward.
    """
    from sqlalchemy import func, select

    from app.models import Product, StockLine

    db = SessionLocal()
    try:
        for product in db.query(Product).all():
            if product.is_serialized:
                continue
            total = db.execute(
                select(func.coalesce(func.sum(StockLine.quantity), 0)).where(
                    StockLine.product_id == product.id
                )
            ).scalar()
            if total == 0 and product.quantity:
                db.add(StockLine(product_id=product.id, quantity=product.quantity))
        db.commit()
    finally:
        db.close()
