"""Programmatic Alembic migration runner.

Handles both fresh installs and upgrades of an existing pre-Alembic database.

When a database already contains the app's tables but has no ``alembic_version``
row (i.e. it predates Alembic and was maintained by the old inline
``run_migrations`` ALTER statements), we stamp it at ``head`` so the next real
schema change can be applied as an Alembic migration. Fresh databases are
simply migrated to ``head``.
"""

import logging
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Engine

from app.config import settings

log = logging.getLogger("app.migrations")

_BACKEND_DIR = Path(__file__).resolve().parent.parent
_ALEMBIC_DIR = _BACKEND_DIR / "alembic.ini"
_SCRIPT_LOCATION = _BACKEND_DIR / "alembic"
_VERSION_TABLE = "alembic_version"


def _config() -> Config:
    cfg = Config(str(_ALEMBIC_DIR))
    cfg.set_main_option("sqlalchemy.url", settings.database_url)
    cfg.set_main_option("script_location", str(_SCRIPT_LOCATION))
    return cfg


def _pre_alembic_db(engine: Engine) -> bool:
    """True if the DB has app tables but is not properly stamped by Alembic.

    Handles two legacy/manual states:
      * app tables present, no ``alembic_version`` table at all; or
      * app tables present and an empty ``alembic_version`` table (schema was
        built by the old ``create_all`` / inline ALTER approach).
    In both cases the schema already matches the models, so we stamp at head.
    A DB that has *no* app tables is fresh and must run a real migration.
    """
    insp = inspect(engine)
    tables = set(insp.get_table_names())
    if not tables:
        return False
    if _VERSION_TABLE not in tables:
        return True
    # Version table exists: it is properly managed only if it has a row.
    with engine.connect() as conn:
        row = conn.execute(text("SELECT 1 FROM %s" % _VERSION_TABLE)).first()
    return row is None


def _has_any_app_table(engine: Engine) -> bool:
    insp = inspect(engine)
    tables = set(insp.get_table_names())
    non_alembic = tables - {_VERSION_TABLE}
    # A connection may have only the version table if a previous upgrade
    # partially ran; treat that as needing a real upgrade.
    return bool(non_alembic)


def run_migrations() -> None:
    """Apply Alembic migrations, stamping legacy databases at head."""
    engine = create_engine(settings.database_url)
    try:
        app_tables = _has_any_app_table(engine)
        if app_tables and _pre_alembic_db(engine):
            # Legacy database that already has the full current schema.
            # Mark it as already at head so future real migrations apply cleanly.
            command.stamp(_config(), "head")
            log.info("Stamped legacy database at alembic head (schema was already current).")
        else:
            command.upgrade(_config(), "head")
            log.info("Alembic migrations applied (upgrade head).")
    finally:
        engine.dispose()
