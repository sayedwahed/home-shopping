#!/usr/bin/env python3
"""Daily backups (system 21 of the spec).

* SQLite (no DATABASE_URL): copies data/store.db to backups/ with a
  date stamp, keeps the newest 30 files, prunes older ones.
* Postgres (DATABASE_URL set): uses pg_dump when available and writes
  the dump to backups/; when pg_dump is missing it logs that the
  backup was skipped instead of pretending one happened.

Never backs up secrets — the database holds products, clicks (IP hashes
only), subscribers and settings, never credentials.

Usage:
    python scripts/backup.py
    python scripts/backup.py --keep 10
"""

import argparse
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import db as store_db  # noqa: E402

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKUP_DIR = os.path.join(BASE_DIR, "backups")
KEEP_DEFAULT = 30


def _stamp():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d-%H%M%S")


def _prune(keep):
    """Delete backup files older than the newest `keep` (by name order,
    which is chronological because names start with the date stamp)."""
    files = sorted(
        f for f in os.listdir(BACKUP_DIR)
        if f.startswith("store-") and f.endswith((".db", ".sql"))
    )
    removed = []
    for name in files[:-keep] if len(files) > keep else []:
        os.remove(os.path.join(BACKUP_DIR, name))
        removed.append(name)
    return removed


def backup_sqlite(keep):
    src = store_db.DB_PATH
    if not os.path.exists(src):
        print("No SQLite file at %s — nothing to back up." % src)
        return 0
    os.makedirs(BACKUP_DIR, exist_ok=True)
    dest = os.path.join(BACKUP_DIR, "store-%s.db" % _stamp())
    shutil.copy2(src, dest)
    removed = _prune(keep)
    print("Backup written: %s" % dest)
    if removed:
        print("Pruned %d old backup(s): %s" % (len(removed), ", ".join(removed)))
    print("Keeping the newest %d backup(s)." % keep)
    return 0


def backup_postgres(keep):
    pg_dump = shutil.which("pg_dump")
    if not pg_dump:
        print("Postgres is active but pg_dump is not installed — "
              "backup skipped (nothing was written).")
        return 1
    os.makedirs(BACKUP_DIR, exist_ok=True)
    dest = os.path.join(BACKUP_DIR, "store-%s.sql" % _stamp())
    with open(dest, "w", encoding="utf-8") as out:
        proc = subprocess.run(
            [pg_dump, store_db.DATABASE_URL],
            stdout=out, stderr=subprocess.PIPE, text=True, timeout=300,
        )
    if proc.returncode != 0:
        os.remove(dest)
        print("pg_dump failed: %s" % proc.stderr.strip())
        return 1
    removed = _prune(keep)
    print("Backup written: %s" % dest)
    if removed:
        print("Pruned %d old backup(s)." % len(removed))
    return 0


def main():
    parser = argparse.ArgumentParser(description="Back up the store database.")
    parser.add_argument("--keep", type=int, default=KEEP_DEFAULT,
                        help="How many newest backups to keep (default 30)")
    args = parser.parse_args()
    if store_db.USE_POSTGRES:
        return backup_postgres(args.keep)
    return backup_sqlite(args.keep)


if __name__ == "__main__":
    sys.exit(main())
