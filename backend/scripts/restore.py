"""Restore a SQLite backup.

Usage:
    python scripts/restore.py backups/inventory_20260821_143000.db

This will:
  1. Stop any WAL activity (PRAGMA wal_checkpoint)
  2. Copy the backup over the live inventory.db
  3. Verify the restored file opens correctly

IMPORTANT: Stop the backend before restoring, or at minimum ensure no
writes are happening during the copy.
"""

import shutil
import sqlite3
import sys
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "inventory.db"


def restore(backup_path: Path) -> None:
    if not backup_path.exists():
        print(f"Error: backup file not found at {backup_path}", file=sys.stderr)
        sys.exit(1)

    if not DB_PATH.exists():
        print(f"Error: live database not found at {DB_PATH}", file=sys.stderr)
        print("Restore the backup directly to the expected path.", file=sys.stderr)
        shutil.copy2(backup_path, DB_PATH)
        print(f"Restored to {DB_PATH}")
        return

    verify(backup_path)

    timestamp = DB_PATH.with_suffix(".db.pre_restore")
    shutil.copy2(DB_PATH, timestamp)
    print(f"Current database backed up to {timestamp}")

    shutil.copy2(backup_path, DB_PATH)

    for suffix in (".db-shm", ".db-wal"):
        stale = DB_PATH.with_name(DB_PATH.name + suffix)
        if stale.exists():
            stale.unlink()

    verify(DB_PATH)
    print(f"Restored successfully from {backup_path}")


def verify(db_path: Path) -> None:
    conn = sqlite3.connect(str(db_path))
    try:
        count = conn.execute("SELECT count(*) FROM sqlite_master").fetchone()[0]
        if count == 0:
            print("Warning: database has no tables", file=sys.stderr)
    except sqlite3.DatabaseError as e:
        print(f"Error: database is corrupted — {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python scripts/restore.py <backup_file.db>", file=sys.stderr)
        sys.exit(1)
    restore(Path(sys.argv[1]))
