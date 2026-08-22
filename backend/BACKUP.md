# Backup & Restore

## Quick Start

```bash
# Backup
cd backend
python scripts/backup.py

# Restore
python scripts/restore.py backups/inventory_20260821_143000.db
```

## How It Works

The backup script uses SQLite's `VACUUM INTO` to create a consistent, compact
copy of the database. It runs `PRAGMA wal_checkpoint(TRUNCATE)` first to flush
the WAL journal, ensuring the backup is a single file with no pending writes.

Backups are saved to `backend/backups/` (gitignored).

## Automated Backups

### Windows Task Scheduler

1. Open Task Scheduler → Create Task
2. Trigger: Daily at a time of your choosing
3. Action: `python C:\path\to\backend\scripts\backup.py`
4. Start in: `C:\path\to\backend`

### Cron (Linux / Docker)

```bash
# Daily at 2 AM
0 2 * * * cd /app && python scripts/backup.py >> /var/log/backup.log 2>&1
```

### Docker Compose

Add a backup sidecar service to `docker-compose.yml`:

```yaml
  backup:
    build: ./backend
    container_name: inventura-backup
    entrypoint: ["sh", "-c", "while true; do python scripts/backup.py; sleep 86400; done"]
    volumes:
      - backend-data:/app/data
      - backups:/app/backups
    environment:
      - DATABASE_URL=sqlite:///./data/inventory.db
```

## Restore Procedure

1. **Stop the backend** (or at minimum, ensure no writes are happening)
2. Run the restore script:
   ```bash
   python scripts/restore.py backups/inventory_YYYYMMDD_HHMMSS.db
   ```
3. The script automatically:
   - Backs up the current DB as `inventory.db.pre_restore`
   - Copies the backup into place
   - Cleans up stale WAL/SHM files
   - Verifies table integrity
4. Restart the backend

## What's Included

| Path | Description |
|------|-------------|
| `inventory.db` | Main SQLite database |
| `inventory.db-shm` | Shared memory file (WAL mode) |
| `inventory.db-wal` | Write-ahead log (uncommitted changes) |
| `app/uploads/` | Uploaded product images, logos |

The backup script copies only the `.db` file after checkpointing, which
includes all committed data. The uploads directory should be backed up
separately if image persistence matters.

## Verifying Backups

```bash
python -c "import sqlite3; c=sqlite3.connect('backups/inventory_20260821.db'); print(f'{c.execute(\"SELECT count(*) FROM sqlite_master\").fetchone()[0]} tables'); c.close()"
```

## Retention

Backups accumulate in `backups/`. To keep only the last 7:

```bash
# Linux
ls -t backups/inventory_*.db | tail -n +8 | xargs rm -f

# PowerShell
Get-ChildItem backups/inventory_*.db | Sort-Object LastWriteTime | Select-Object -Skip 7 | Remove-Item
```
