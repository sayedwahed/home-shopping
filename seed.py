#!/usr/bin/env python3
"""(Re)seed the Home Shopping database from data/products.json.

Works against whichever backend is active: Postgres when the
DATABASE_URL env var is set, otherwise the local SQLite file
(./data/store.db). The --db option only applies to SQLite; it is
ignored when DATABASE_URL is set.

Usage:
    python seed.py            # seed the active backend from ./data/products.json
    python seed.py --db PATH --seed PATH

Idempotent: re-running updates product fields but preserves the existing
clicks count and original created_at. Safe to run any time.
"""

import argparse
import sys

import db as store_db


def main():
    parser = argparse.ArgumentParser(description="Seed the store database.")
    parser.add_argument("--db", default=store_db.DB_PATH)
    parser.add_argument("--seed", default=store_db.SEED_PATH)
    args = parser.parse_args()

    inserted, updated = store_db.seed_from_json(args.seed, args.db)
    print(f"Seeded {store_db.describe()} from {args.seed}: "
          f"{inserted} inserted, {updated} updated.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
