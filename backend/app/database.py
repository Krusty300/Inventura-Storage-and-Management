from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings

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
    """Idempotently add columns introduced after the DB was first created."""
    insp = inspect(engine)
    table_names = set(insp.get_table_names())
    if "products" not in table_names:
        return
    existing = {c["name"] for c in insp.get_columns("products")}
    users_cols = {c["name"] for c in insp.get_columns("users")} if "users" in table_names else None
    movement_cols = (
        {c["name"] for c in insp.get_columns("stock_movements")}
        if "stock_movements" in table_names
        else None
    )
    serial_cols = (
        {c["name"] for c in insp.get_columns("serial_numbers")}
        if "serial_numbers" in table_names
        else None
    )
    supplier_cols = (
        {c["name"] for c in insp.get_columns("suppliers")}
        if "suppliers" in table_names
        else None
    )
    shipment_cols = (
        {c["name"] for c in insp.get_columns("shipments")}
        if "shipments" in table_names
        else None
    )
    settings_cols = (
        {c["name"] for c in insp.get_columns("settings")}
        if "settings" in table_names
        else None
    )
    with engine.begin() as conn:
        if "parent_id" not in existing:
            conn.execute(text("ALTER TABLE products ADD COLUMN parent_id INTEGER"))
        if "attributes" not in existing:
            conn.execute(text("ALTER TABLE products ADD COLUMN attributes TEXT"))
        if "is_serialized" not in existing:
            conn.execute(text("ALTER TABLE products ADD COLUMN is_serialized BOOLEAN DEFAULT 0"))
        if "location_id" not in existing:
            conn.execute(text("ALTER TABLE products ADD COLUMN location_id INTEGER"))
        if "locations" not in table_names:
            conn.execute(text(
                "CREATE TABLE locations ("
                "id INTEGER PRIMARY KEY, "
                "name VARCHAR(100) NOT NULL, "
                "code VARCHAR(50) UNIQUE, "
                "location_type VARCHAR(30) DEFAULT 'bin', "
                "parent_id INTEGER, "
                "is_active BOOLEAN DEFAULT 1, "
                "created_at DATETIME DEFAULT CURRENT_TIMESTAMP)"
            ))
        if users_cols is not None and "is_active" not in users_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT 1"))
        if users_cols is not None and "last_login_at" not in users_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN last_login_at DATETIME"))
        if serial_cols is not None and "lpn_id" not in serial_cols:
            conn.execute(text("ALTER TABLE serial_numbers ADD COLUMN lpn_id INTEGER"))
        if supplier_cols is not None and "is_active" not in supplier_cols:
            conn.execute(text("ALTER TABLE suppliers ADD COLUMN is_active BOOLEAN DEFAULT 1"))
        if shipment_cols is not None and "sale_id" not in shipment_cols and "sales" in table_names:
            conn.execute(text("ALTER TABLE shipments ADD COLUMN sale_id INTEGER REFERENCES sales(id)"))
        if "document_sequences" not in table_names:
            conn.execute(text(
                "CREATE TABLE document_sequences "
                "(name VARCHAR(50) PRIMARY KEY, next_value INTEGER NOT NULL DEFAULT 1)"
            ))
        if movement_cols is not None:
            for col, ddl in (
                ("from_location_id", "INTEGER"),
                ("to_location_id", "INTEGER"),
                ("lot_id", "INTEGER"),
                ("serial_id", "INTEGER"),
                ("lpn_id", "INTEGER"),
                ("reference_type", "VARCHAR(30) DEFAULT ''"),
                ("transfer_id", "INTEGER"),
            ):
                if col not in movement_cols:
                    conn.execute(text(f"ALTER TABLE stock_movements ADD COLUMN {col} {ddl}"))
        for seq_name, table, col, prefix in (
            ("invoice", "sales", "invoice_number", "INV-"),
            ("purchase_order", "orders", "order_number", "PO-"),
        ):
            if table in table_names:
                offset = len(prefix) + 1
                max_num = conn.execute(
                    text(f"SELECT COALESCE(MAX(CAST(SUBSTR({col}, :offset) AS INTEGER)), 0) "
                         f"FROM {table} WHERE {col} LIKE :p"),
                    {"offset": offset, "p": f"{prefix}%"},
                ).scalar()
                conn.execute(
                    text("INSERT OR IGNORE INTO document_sequences (name, next_value) VALUES (:n, :v)"),
                    {"n": seq_name, "v": max_num},
                )

        if settings_cols is not None:
            for col, ddl in (
                ("expiry_warning_days", "INTEGER DEFAULT 30"),
                ("low_stock_alerts", "BOOLEAN DEFAULT 1"),
                ("expiry_alerts", "BOOLEAN DEFAULT 1"),
                ("shipment_prefix", "VARCHAR(20) DEFAULT 'SHP'"),
                ("work_order_prefix", "VARCHAR(20) DEFAULT 'WO'"),
                ("sale_prefix", "VARCHAR(20) DEFAULT 'SALE'"),
                ("invoice_prefix", "VARCHAR(20) DEFAULT 'INV'"),
                ("po_prefix", "VARCHAR(20) DEFAULT 'PO'"),
                ("require_qc_before_ship", "BOOLEAN DEFAULT 0"),
                ("auto_allocate_stock", "BOOLEAN DEFAULT 0"),
                ("enforce_fefo", "BOOLEAN DEFAULT 1"),
                ("default_costing_method", "VARCHAR(30) DEFAULT 'weighted_average'"),
                ("fiscal_year_start_month", "INTEGER DEFAULT 1"),
                ("default_items_per_page", "INTEGER DEFAULT 50"),
                ("date_format", "VARCHAR(20) DEFAULT 'YYYY-MM-DD'"),
            ):
                if col not in settings_cols:
                    conn.execute(text(f"ALTER TABLE settings ADD COLUMN {col} {ddl}"))


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
