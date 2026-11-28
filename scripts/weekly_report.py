#!/usr/bin/env python3
"""Sunday weekly report (system 19 of the spec).

Summarises the week from the database (clicks, products, subscribers,
errors) plus the latest monitor status, and writes a Markdown report
to reports/weekly-YYYY-MM-DD.md. Read-only — it never changes data.

Usage:
    python scripts/weekly_report.py
"""

import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import db as store_db  # noqa: E402

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPORTS_DIR = os.path.join(BASE_DIR, "reports")
MONITOR_PATH = os.path.join(BASE_DIR, "data", "monitor_status.json")


def main():
    date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    conn = store_db.connect()
    try:
        products = store_db.get_all_products(conn)
        total = store_db.total_clicks(conn)
        per_product = store_db.clicks_per_product(conn)
        per_day = store_db.clicks_per_day(conn, days=7)
        countries = store_db.top_countries(conn, limit=10)
        errors = store_db.get_recent_errors(conn, limit=20)
        subs = store_db.count_subscribers(conn, confirmed_only=True)
        pending = store_db.count_subscribers(conn) - subs
        push = store_db.count_push_subscriptions(conn)
    finally:
        conn.close()

    monitor = None
    if os.path.exists(MONITOR_PATH):
        try:
            with open(MONITOR_PATH, "r", encoding="utf-8") as f:
                monitor = json.load(f)
        except (OSError, ValueError):
            monitor = None

    lines = ["# Weekly report — %s\n" % date,
             "## Store",
             "- Products: %d" % len(products),
             "- Total clicks (all time): %d" % total,
             "- Confirmed subscribers: %d (pending: %d)" % (subs, pending),
             "- Push subscriptions: %d" % push,
             "",
             "## Clicks per product"]
    for row in per_product:
        lines.append("- %s (%s): %d" % (row["title"], row["product_id"], row["n"]))
    lines.append("\n## Clicks per day (last 7 days)")
    for row in per_day:
        lines.append("- %s: %d" % (row["day"], row["n"]))
    lines.append("\n## Top countries")
    for row in countries:
        lines.append("- %s: %d" % (row["country"], row["n"]))
    lines.append("\n## Monitor")
    if monitor:
        lines.append("- Last check %s: %s"
                     % (monitor.get("checked_at"), "OK" if monitor.get("ok") else "FAIL"))
    else:
        lines.append("- No monitor run recorded yet (run scripts/monitor.py).")
    lines.append("\n## Recent errors (%d)" % len(errors))
    for e in errors:
        lines.append("- [%s] %s — %s" % (e["level"], e["created_at"], e["message"]))
    if not errors:
        lines.append("- None.")

    os.makedirs(REPORTS_DIR, exist_ok=True)
    path = os.path.join(REPORTS_DIR, "weekly-%s.md" % date)
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print("Weekly report written: %s (%d clicks total, %d errors)"
          % (path, total, len(errors)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
