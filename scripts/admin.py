#!/usr/bin/env python3
"""Admin commands (system 23 of the spec).

    python scripts/admin.py fix      re-run the seed + check DB integrity
    python scripts/admin.py analyze  clicks/products summary
    python scripts/admin.py scan     env vars, security headers, pricing rules
    python scripts/admin.py backup   run the daily backup
    python scripts/admin.py evolve   status of all 23 systems + next step

Every subcommand prints plain results and exits 0 on success.
"""

import argparse
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import auth as admin_auth  # noqa: E402
import db as store_db  # noqa: E402
import pricing as pricing_mod  # noqa: E402
from publishers.registry import status_list as publisher_status  # noqa: E402

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SYSTEM_STATUS = [
    (1, "Flask store + security headers", "done"),
    (2, "SQLite/Postgres DB (15 tables planned, 6 live)", "done"),
    (3, "Geo / locale (EN + USD only)", "done"),
    (4, "Catalog via AliExpress Affiliate API", "done"),
    (5, "/go/<id> disclosure page", "done"),
    (6, "Click tracking (ip_hash only)", "done"),
    (7, "Admin panel", "done"),
    (8, "Auth hardening (bcrypt hash, CSRF, lockout)", "done"),
    (9, "PWA manifest + service worker", "done"),
    (10, "FCM push (opt-in, disabled without keys)", "stub-disabled"),
    (11, "Email double opt-in (disabled without SMTP)", "stub-disabled"),
    (12, "Official-API publishing (dry-run only)", "stub-disabled"),
    (13, "Qwen 7B content agency (disabled without Ollama)", "stub-disabled"),
    (14, "White-hat SEO + weekly review", "done"),
    (15, "Legal videos only (policy)", "done"),
    (16, "Image optimization (Pillow)", "done"),
    (17, "Dynamic pricing matrix (no fake discounts)", "done"),
    (18, "Analytics + CSV export", "done"),
    (19, "Scheduled jobs (needs a host with cron)", "blocked"),
    (20, "Self-monitoring", "done"),
    (21, "Daily backups (keep 30)", "done"),
    (22, "Defensive security (rate limits, pip-audit)", "done"),
    (23, "Admin commands (this CLI)", "done"),
]


def cmd_fix(_args):
    inserted, updated = store_db.seed_from_json()
    conn = store_db.connect()
    try:
        if conn.postgres:
            conn.execute("SELECT 1").fetchone()
            integrity = "Postgres connection OK"
        else:
            row = conn.execute("PRAGMA integrity_check").fetchone()
            integrity = "integrity_check: %s" % row[0]
        products = conn.execute("SELECT COUNT(*) AS n FROM products").fetchone()["n"]
        clicks = store_db.total_clicks(conn)
    finally:
        conn.close()
    print("fix: seed re-run (%d inserted, %d updated), %s, "
          "%d product(s), %d click(s)." % (inserted, updated, integrity,
                                            products, clicks))
    return 0


def cmd_analyze(_args):
    conn = store_db.connect()
    try:
        products = store_db.get_all_products(conn)
        total = store_db.total_clicks(conn)
        per_product = store_db.clicks_per_product(conn)
        per_day = store_db.clicks_per_day(conn, days=7)
        countries = store_db.top_countries(conn, limit=10)
        subs = store_db.count_subscribers(conn, confirmed_only=True)
        errors = store_db.get_error_count(conn)
    finally:
        conn.close()
    print("analyze: %d product(s), %d click(s) total, "
          "%d confirmed subscriber(s), %d error(s) logged."
          % (len(products), total, subs, errors))
    print("Clicks per product:")
    for row in per_product:
        print("  %s: %d" % (row["title"], row["n"]))
    print("Clicks per day (last 7 days):")
    for row in per_day:
        print("  %s: %d" % (row["day"], row["n"]))
    print("Top countries:")
    for row in countries:
        print("  %s: %d" % (row["country"], row["n"]))
    return 0


def cmd_scan(_args):
    print("scan: environment (names only, never values)")
    env_names = [
        "DATABASE_URL", "SECRET_KEY", "BASE_URL",
        "ADMIN_USER", "ADMIN_PASS_HASH", "ADMIN_PASS",
        "ALIEXPRESS_APP_KEY", "ALIEXPRESS_APP_SECRET", "ALIEXPRESS_TRACKING_ID",
        "SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_FROM",
        "FCM_SERVER_KEY", "OLLAMA_HOST",
    ]
    for name in env_names:
        value = os.environ.get(name)
        if name == "SECRET_KEY":
            state = "set (custom)" if value and value != "dev-only-change-me-in-production" else "DEFAULT — set a real one"
        else:
            state = "set" if value else "unset"
        print("  %s: %s" % (name, state))
    print("  admin auth mode: %s" % admin_auth.auth_mode())
    for pub in publisher_status():
        print("  publisher %s: %s" % (pub["name"], pub["status"]))

    print("scan: security headers (test client, GET /)")
    from app import app as flask_app

    client = flask_app.test_client()
    resp = client.get("/")
    for header in ("Content-Security-Policy", "Strict-Transport-Security",
                   "X-Frame-Options", "X-Content-Type-Options",
                   "Referrer-Policy"):
        print("  %s: %s" % (header, "present" if header in resp.headers else "MISSING"))
    print("  homepage status: %s" % resp.status_code)

    print("scan: pricing rules (display_price on all products)")
    conn = store_db.connect()
    try:
        policy = pricing_mod.pricing_policy(conn)
        for p in store_db.get_all_products(conn):
            price, old, discount = pricing_mod.display_price(p, policy)
            print("  %s: $%.2f%s" % (
                p["id"], price,
                (" (was $%.2f, -%d%%)" % (old, discount)) if old else ""))
        pricing_mod.check_margin_policy(conn)
    finally:
        conn.close()

    print("scan: outdated pip packages")
    try:
        proc = subprocess.run(
            [sys.executable, "-m", "pip", "list", "--outdated",
             "--format=json"],
            capture_output=True, text=True, timeout=120)
        import json

        outdated = json.loads(proc.stdout or "[]")
        print("  %d package(s) outdated." % len(outdated))
        for pkg in outdated:
            print("    %s %s -> %s" % (pkg["name"], pkg["version"],
                                       pkg["latest_version"]))
    except Exception as exc:  # noqa: BLE001 - scan must not crash
        print("  could not list outdated packages: %s" % exc)
    return 0


def cmd_backup(_args):
    sys.path.insert(0, os.path.join(BASE_DIR, "scripts"))
    import backup as backup_mod

    return backup_mod.main()


def cmd_evolve(_args):
    print("System status (23 systems):")
    done = sum(1 for _n, _d, s in SYSTEM_STATUS if s == "done")
    for num, desc, status in SYSTEM_STATUS:
        print("  %2d. [%s] %s" % (num, status, desc))
    print("Done: %d/23." % done)
    pending = [(n, d) for n, d, s in SYSTEM_STATUS if s != "done"]
    if pending:
        num, desc = pending[0]
        print("Suggested next step: system %d — %s." % (num, desc))
        print("  (10-13 need the owner's credentials/accounts; "
              "19 needs a host with cron.)")
    else:
        print("All 23 systems are done.")
    return 0


def main():
    parser = argparse.ArgumentParser(description="Home Shopping admin commands.")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("fix", help="Re-run seed + check DB integrity")
    sub.add_parser("analyze", help="Clicks/products summary")
    sub.add_parser("scan", help="Env vars, headers, pricing rules")
    sub.add_parser("backup", help="Run the daily backup")
    sub.add_parser("evolve", help="Status of all 23 systems + next step")
    args = parser.parse_args()
    commands = {"fix": cmd_fix, "analyze": cmd_analyze, "scan": cmd_scan,
                "backup": cmd_backup, "evolve": cmd_evolve}
    return commands[args.command](args)


if __name__ == "__main__":
    sys.exit(main())
