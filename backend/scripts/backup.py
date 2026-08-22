"""SQLite backup with WAL checkpoint for consistency.

Usage:
    python scripts/backup.py                          # -> backups/inventory_YYYYMMDD_HHMMSS.db
    python scripts/backup.py /path/to/output.db       # explicit output path

Can be scheduled via cron / Task Scheduler / Docker healthcheck.
"""

import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "inventory.db"
BACKUP_DIR = Path(__file__).resolve().parent.parent / "backups"


def backup(db_path: Path = DB_PATH, output: Path | None = None) -> Path:
    if not db_path.exists():
        print(f"Error: database not found at {db_path}", file=sys.stderr)
        sys.exit(1)

    BACKUP_DIR.mkdir(parents=True, exist_ok=True)

    if output is None:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        output = BACKUP_DIR / f"inventory_{ts}.db"

    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        conn.execute("VACUUM INTO ?", (str(output),))
    finally:
        conn.close()

    size_mb = output.stat().st_size / (1024 * 1024)
    print(f"Backup created: {output} ({size_mb:.2f} MB)")
    return output


if __name__ == "__main__":
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    backup(output=out)
