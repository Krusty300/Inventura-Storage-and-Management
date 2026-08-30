from pathlib import Path
from sqlalchemy import create_engine, event, inspect, text
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
    shipment_item_cols = (
        {c["name"] for c in insp.get_columns("shipment_items")}
        if "shipment_items" in table_names
        else None
    )
    settings_cols = (
        {c["name"] for c in insp.get_columns("settings")}
        if "settings" in table_names
        else None
    )
    qc_cols = (
        {c["name"] for c in insp.get_columns("quality_checks")}
        if "quality_checks" in table_names
        else None
    )
    sales_cols = (
        {c["name"] for c in insp.get_columns("sales")}
        if "sales" in table_names
        else None
    )
    cust_cols = (
        {c["name"] for c in insp.get_columns("customers")}
        if "customers" in table_names
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
        if users_cols is not None and "avatar_url" not in users_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN avatar_url VARCHAR(500) DEFAULT ''"))
        if users_cols is not None and "permissions" not in users_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN permissions TEXT"))
        if users_cols is not None and "is_approved" not in users_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN is_approved BOOLEAN DEFAULT 0"))
        if serial_cols is not None and "lpn_id" not in serial_cols:
            conn.execute(text("ALTER TABLE serial_numbers ADD COLUMN lpn_id INTEGER"))
        if qc_cols is not None and "location_id" not in qc_cols:
            conn.execute(text("ALTER TABLE quality_checks ADD COLUMN location_id INTEGER"))
        if supplier_cols is not None and "is_active" not in supplier_cols:
            conn.execute(text("ALTER TABLE suppliers ADD COLUMN is_active BOOLEAN DEFAULT 1"))
        if supplier_cols is not None and "lead_time_days" not in supplier_cols:
            conn.execute(text("ALTER TABLE suppliers ADD COLUMN lead_time_days INTEGER"))
        if shipment_cols is not None and "sale_id" not in shipment_cols and "sales" in table_names:
            conn.execute(text("ALTER TABLE shipments ADD COLUMN sale_id INTEGER REFERENCES sales(id)"))
        if shipment_item_cols is not None and "location_id" not in shipment_item_cols:
            conn.execute(text("ALTER TABLE shipment_items ADD COLUMN location_id INTEGER"))
        if sales_cols is not None and "discount_amount" not in sales_cols:
            conn.execute(text("ALTER TABLE sales ADD COLUMN discount_amount NUMERIC(10, 2) DEFAULT 0"))
        if sales_cols is not None and "payment_provider" not in sales_cols:
            conn.execute(text("ALTER TABLE sales ADD COLUMN payment_provider VARCHAR(20)"))
        if sales_cols is not None:
            for col, ddl in (
                ("payment_reference", "VARCHAR(100)"),
                ("payment_phone", "VARCHAR(30)"),
                ("payment_provider_amount", "NUMERIC(10, 2)"),
                ("currency", "VARCHAR(10)"),
                ("currency_symbol", "VARCHAR(10)"),
                ("payment_status", "VARCHAR(20)"),
                ("payment_checkout_request_id", "VARCHAR(64)"),
                ("refund_status", "VARCHAR(20)"),
                ("refunded_at", "DATETIME"),
                ("refund_method", "VARCHAR(20)"),
                ("refund_provider", "VARCHAR(20)"),
                ("refund_checkout_request_id", "VARCHAR(64)"),
            ):
                if col not in sales_cols:
                    conn.execute(text(f"ALTER TABLE sales ADD COLUMN {col} {ddl}"))
        if sales_cols is not None and "channel_id" not in sales_cols:
            conn.execute(text("ALTER TABLE sales ADD COLUMN channel_id INTEGER REFERENCES sales_channels(id)"))
        if "sales_channels" not in table_names:
            conn.execute(text(
                "CREATE TABLE sales_channels ("
                "id INTEGER PRIMARY KEY, "
                "name VARCHAR(100) NOT NULL UNIQUE, "
                "type VARCHAR(30) NOT NULL DEFAULT 'store', "
                "is_active BOOLEAN DEFAULT 1, "
                "created_at DATETIME DEFAULT CURRENT_TIMESTAMP, "
                "updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)"
            ))
        if "document_sequences" not in table_names:
            conn.execute(text(
                "CREATE TABLE document_sequences "
                "(name VARCHAR(50) PRIMARY KEY, next_value INTEGER NOT NULL DEFAULT 1)"
            ))
        if "user_sessions" not in table_names:
            conn.execute(text(
                "CREATE TABLE user_sessions ("
                "id INTEGER PRIMARY KEY, "
                "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, "
                "jti VARCHAR(64) NOT NULL UNIQUE, "
                "ip_address VARCHAR(64) DEFAULT '', "
                "user_agent VARCHAR(255) DEFAULT '', "
                "created_at DATETIME DEFAULT CURRENT_TIMESTAMP, "
                "last_seen_at DATETIME, "
                "revoked_at DATETIME)"
            ))
            conn.execute(text("CREATE INDEX ix_user_sessions_user_id ON user_sessions(user_id)"))
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
                ("currency_code", "VARCHAR(10) DEFAULT 'USD'"),
                ("expiry_warning_days", "INTEGER DEFAULT 30"),
                ("low_stock_alerts", "BOOLEAN DEFAULT 1"),
                ("expiry_alerts", "BOOLEAN DEFAULT 1"),
                ("shipment_prefix", "VARCHAR(20) DEFAULT 'SHP'"),
                ("work_order_prefix", "VARCHAR(20) DEFAULT 'WO'"),
                ("sale_prefix", "VARCHAR(20) DEFAULT 'SALE'"),
                ("invoice_prefix", "VARCHAR(20) DEFAULT 'INV'"),
                ("po_prefix", "VARCHAR(20) DEFAULT 'PO'"),
                ("receipt_prefix", "VARCHAR(20) DEFAULT 'RCP'"),
                ("asn_prefix", "VARCHAR(20) DEFAULT 'ASN'"),
                ("qc_prefix", "VARCHAR(20) DEFAULT 'QC'"),
                ("cc_prefix", "VARCHAR(20) DEFAULT 'CC'"),
                ("return_prefix", "VARCHAR(20) DEFAULT 'RET'"),
                ("transfer_prefix", "VARCHAR(20) DEFAULT 'TRF'"),
                ("unallocated_prefix", "VARCHAR(20) DEFAULT 'UNL'"),
                ("quarantine_prefix", "VARCHAR(20) DEFAULT 'QAR'"),
                ("lpn_prefix", "VARCHAR(20) DEFAULT 'LPN'"),
                ("lpn_move_prefix", "VARCHAR(20) DEFAULT 'MOV'"),
                ("lpn_load_prefix", "VARCHAR(20) DEFAULT 'LOD'"),
                ("lpn_unload_prefix", "VARCHAR(20) DEFAULT 'ULD'"),
                ("stock_in_prefix", "VARCHAR(20) DEFAULT 'SI'"),
                ("stock_out_prefix", "VARCHAR(20) DEFAULT 'SO'"),
                ("adjustment_prefix", "VARCHAR(20) DEFAULT 'ADJ'"),
                ("require_qc_before_ship", "BOOLEAN DEFAULT 0"),
                ("auto_allocate_stock", "BOOLEAN DEFAULT 0"),
                ("enforce_fefo", "BOOLEAN DEFAULT 1"),
                ("default_costing_method", "VARCHAR(30) DEFAULT 'weighted_average'"),
                ("fiscal_year_start_month", "INTEGER DEFAULT 1"),
                ("default_items_per_page", "INTEGER DEFAULT 50"),
                ("date_format", "VARCHAR(20) DEFAULT 'YYYY-MM-DD'"),
                ("logo_url", "VARCHAR(500) DEFAULT ''"),
                ("tax_id", "VARCHAR(100) DEFAULT ''"),
                ("payment_terms", "VARCHAR(100) DEFAULT ''"),
                ("bank_details", "TEXT DEFAULT ''"),
                ("footer_note", "TEXT DEFAULT ''"),
            ):
                if col not in settings_cols:
                    conn.execute(text(f"ALTER TABLE settings ADD COLUMN {col} {ddl}"))

        # Idempotently create indexes on existing databases (create_all covers
        # fresh ones; existing tables need explicit index creation).
        index_statements: list[str] = []
        if "stock_movements" in table_names:
            index_statements += [
                "CREATE INDEX IF NOT EXISTS ix_stock_movements_movement_type ON stock_movements(movement_type)",
                "CREATE INDEX IF NOT EXISTS ix_stock_movements_reference ON stock_movements(reference_type, reference)",
            ]
        if "sales" in table_names:
            index_statements.append("CREATE INDEX IF NOT EXISTS ix_sales_status ON sales(status)")
        if "orders" in table_names:
            index_statements.append("CREATE INDEX IF NOT EXISTS ix_orders_status ON orders(status)")
        if "activity_logs" in table_names:
            index_statements.append("CREATE INDEX IF NOT EXISTS ix_activity_logs_entity_id ON activity_logs(entity_id)")
        for stmt in index_statements:
            conn.execute(text(stmt))

        if "notes" not in table_names:
            conn.execute(text(
                "CREATE TABLE notes ("
                "id INTEGER PRIMARY KEY, "
                "title VARCHAR(200) NOT NULL, "
                "body TEXT DEFAULT '', "
                "category VARCHAR(20) DEFAULT 'note', "
                "priority VARCHAR(10) DEFAULT 'normal', "
                "is_pinned BOOLEAN DEFAULT 0, "
                "is_completed BOOLEAN DEFAULT 0, "
                "due_date DATETIME, "
                "recurrence VARCHAR(10) DEFAULT 'none', "
                "recurrence_end DATETIME, "
                "sort_order INTEGER DEFAULT 0, "
                "user_id INTEGER NOT NULL REFERENCES users(id), "
                "assigned_to_id INTEGER REFERENCES users(id), "
                "created_at DATETIME DEFAULT CURRENT_TIMESTAMP, "
                "updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)"
            ))
            conn.execute(text("CREATE INDEX ix_notes_user_id ON notes(user_id)"))
            conn.execute(text("CREATE INDEX ix_notes_category ON notes(category)"))
            conn.execute(text("CREATE INDEX ix_notes_due_date ON notes(due_date)"))
        if "note_tags" not in table_names:
            conn.execute(text(
                "CREATE TABLE note_tags ("
                "id INTEGER PRIMARY KEY, "
                "name VARCHAR(50) UNIQUE NOT NULL, "
                "color VARCHAR(7) DEFAULT '#6366f1', "
                "created_at DATETIME DEFAULT CURRENT_TIMESTAMP)"
            ))
        if "note_tag_links" not in table_names:
            conn.execute(text(
                "CREATE TABLE note_tag_links ("
                "note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE, "
                "tag_id INTEGER NOT NULL REFERENCES note_tags(id) ON DELETE CASCADE, "
                "PRIMARY KEY (note_id, tag_id))"
            ))
        if "note_links" not in table_names:
            conn.execute(text(
                "CREATE TABLE note_links ("
                "id INTEGER PRIMARY KEY, "
                "note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE, "
                "entity_type VARCHAR(50) NOT NULL, "
                "entity_id INTEGER NOT NULL, "
                "created_at DATETIME DEFAULT CURRENT_TIMESTAMP)"
            ))
            conn.execute(text("CREATE INDEX ix_note_links_note_id ON note_links(note_id)"))

        # Migrate notes table: add image_url column if missing
        if "notes" in table_names:
            notes_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(notes)"))}
            if "image_url" not in notes_cols:
                conn.execute(text("ALTER TABLE notes ADD COLUMN image_url VARCHAR(500) DEFAULT ''"))
            if "is_archived" not in notes_cols:
                conn.execute(text("ALTER TABLE notes ADD COLUMN is_archived BOOLEAN DEFAULT 0"))

        if "note_links" in table_names:
            nl_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(note_links)"))}
            if "entity_label" not in nl_cols:
                conn.execute(text("ALTER TABLE note_links ADD COLUMN entity_label VARCHAR(200) DEFAULT ''"))

        if "note_templates" not in table_names:
            conn.execute(text(
                "CREATE TABLE note_templates ("
                "id INTEGER PRIMARY KEY, "
                "name VARCHAR(100) NOT NULL, "
                "category VARCHAR(20) DEFAULT 'note', "
                "priority VARCHAR(10) DEFAULT 'normal', "
                "body TEXT DEFAULT '', "
                "recurrence VARCHAR(10) DEFAULT 'none', "
                "user_id INTEGER NOT NULL REFERENCES users(id), "
                "created_at DATETIME DEFAULT CURRENT_TIMESTAMP)"
            ))

        if "product_images" not in table_names:
            conn.execute(text(
                "CREATE TABLE product_images ("
                "id INTEGER PRIMARY KEY, "
                "product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE, "
                "url VARCHAR(500) NOT NULL, "
                "sort_order INTEGER DEFAULT 0, "
                "created_at DATETIME DEFAULT CURRENT_TIMESTAMP)"
            ))
            conn.execute(text("CREATE INDEX ix_product_images_product_id ON product_images(product_id)"))

        # --- Price Lists ---
        if "price_lists" not in table_names:
            conn.execute(text(
                "CREATE TABLE price_lists ("
                "id INTEGER PRIMARY KEY, "
                "name VARCHAR(100) UNIQUE NOT NULL, "
                "description TEXT DEFAULT '', "
                "valid_from DATE, "
                "valid_to DATE, "
                "is_default BOOLEAN DEFAULT 0, "
                "is_active BOOLEAN DEFAULT 1, "
                "created_at DATETIME DEFAULT CURRENT_TIMESTAMP, "
                "updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)"
            ))
        if "price_list_items" not in table_names:
            conn.execute(text(
                "CREATE TABLE price_list_items ("
                "id INTEGER PRIMARY KEY, "
                "price_list_id INTEGER NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE, "
                "product_id INTEGER NOT NULL REFERENCES products(id), "
                "price NUMERIC(12, 2) NOT NULL, "
                "min_qty INTEGER DEFAULT 1)"
            ))
            conn.execute(text("CREATE INDEX ix_price_list_items_price_list_id ON price_list_items(price_list_id)"))
            conn.execute(text("CREATE INDEX ix_price_list_items_product_id ON price_list_items(product_id)"))

        # --- Customer Groups ---
        if "customer_groups" not in table_names:
            conn.execute(text(
                "CREATE TABLE customer_groups ("
                "id INTEGER PRIMARY KEY, "
                "name VARCHAR(100) UNIQUE NOT NULL, "
                "description TEXT DEFAULT '', "
                "price_list_id INTEGER REFERENCES price_lists(id), "
                "created_at DATETIME DEFAULT CURRENT_TIMESTAMP, "
                "updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)"
            ))
        if "customers" in table_names and cust_cols is not None:
            if "group_id" not in cust_cols:
                conn.execute(text("ALTER TABLE customers ADD COLUMN group_id INTEGER REFERENCES customer_groups(id)"))

        # --- Promotions ---
        if "promotions" not in table_names:
            conn.execute(text(
                "CREATE TABLE promotions ("
                "id INTEGER PRIMARY KEY, "
                "code VARCHAR(50) UNIQUE NOT NULL, "
                "description TEXT DEFAULT '', "
                "discount_type VARCHAR(20) NOT NULL, "
                "value NUMERIC(10, 2) NOT NULL, "
                "min_qty INTEGER DEFAULT 0, "
                "min_amount NUMERIC(10, 2) DEFAULT 0, "
                "valid_from DATE, "
                "valid_to DATE, "
                "max_uses INTEGER DEFAULT 0, "
                "used_count INTEGER DEFAULT 0, "
                "is_active BOOLEAN DEFAULT 1, "
                "created_at DATETIME DEFAULT CURRENT_TIMESTAMP, "
                "updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)"
            ))
            conn.execute(text("CREATE INDEX ix_promotions_code ON promotions(code)"))

        # --- Sale promo columns ---
        if sales_cols is not None:
            if "promo_code" not in sales_cols:
                conn.execute(text("ALTER TABLE sales ADD COLUMN promo_code VARCHAR(50)"))
            if "promo_discount" not in sales_cols:
                conn.execute(text("ALTER TABLE sales ADD COLUMN promo_discount NUMERIC(10, 2) DEFAULT 0"))

        # Backfill NULL created_at on notifications created before the column
        # carried a default (older schema had no DEFAULT clause).
        if "notifications" in table_names:
            conn.execute(text(
                "UPDATE notifications SET created_at = COALESCE("
                "(SELECT MAX(created_at) FROM notifications WHERE created_at IS NOT NULL), CURRENT_TIMESTAMP) "
                "WHERE created_at IS NULL"
            ))


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
