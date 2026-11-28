#!/usr/bin/env python3
"""Weekly SEO review (system 14 of the spec).

White-hat checks only — no rank scraping from Google, no crawling of
other sites:

* /sitemap.xml is reachable and lists every product URL
* /robots.txt is reachable and points at the sitemap
* / and every /product/<id> return 200 with a <title> and a
  meta description
* the product count matches the database

Writes a Markdown report to reports/seo-review-YYYY-MM-DD.md and
prints a one-line summary. Exit code 1 when any check fails.

Usage:
    python scripts/seo_review.py
    BASE_URL=https://sayedwahed.pythonanywhere.com python scripts/seo_review.py
"""

import html as html_lib
import os
import re
import sys
from datetime import datetime, timezone

import requests

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import db as store_db  # noqa: E402

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPORTS_DIR = os.path.join(BASE_DIR, "reports")


def _get(base, path, timeout=15):
    try:
        resp = requests.get(base + path, timeout=timeout)
        return resp.status_code, resp.text
    except Exception as exc:  # noqa: BLE001 - a failed check is data
        return None, "ERROR: %s" % exc


def main():
    base = (os.environ.get("BASE_URL") or "http://127.0.0.1:5000").rstrip("/")
    date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    checks = []  # (name, ok, detail)

    conn = store_db.connect()
    try:
        products = store_db.get_all_products(conn)
    finally:
        conn.close()
    checks.append(("Product count in database", len(products) == 3,
                   "%d product(s) (expected 3)" % len(products)))

    status, sitemap = _get(base, "/sitemap.xml")
    sitemap_ok = status == 200 and "<urlset" in sitemap
    missing = [p["id"] for p in products
               if ("/product/%s" % p["id"]) not in sitemap]
    checks.append(("Sitemap reachable", sitemap_ok,
                   "HTTP %s" % status))
    checks.append(("Sitemap lists all products", sitemap_ok and not missing,
                   "missing: %s" % ", ".join(missing) if missing
                   else "all %d product URLs present" % len(products)))

    status, robots = _get(base, "/robots.txt")
    checks.append(("Robots.txt reachable and points at sitemap",
                   status == 200 and "Sitemap:" in robots and "sitemap.xml" in robots,
                   "HTTP %s" % status))

    status, home = _get(base, "/")
    checks.append(("Homepage 200 with title + meta description",
                   status == 200 and "<title>" in home
                   and 'name="description"' in home,
                   "HTTP %s" % status))

    for p in products:
        status, html = _get(base, "/product/%s" % p["id"])
        # Jinja escapes apostrophes etc. in <title>; unescape first.
        plain = html_lib.unescape(html)
        has_title = "<title>" in html and p["title"][:30] in plain
        has_desc = 'name="description"' in html
        has_jsonld = '"@type": "Product"' in html or '"@type":"Product"' in html
        checks.append(("Product page /product/%s" % p["id"],
                       status == 200 and has_title and has_desc and has_jsonld,
                       "HTTP %s, title=%s, meta=%s, json-ld=%s"
                       % (status, has_title, has_desc, has_jsonld)))

    failed = [c for c in checks if not c[1]]
    os.makedirs(REPORTS_DIR, exist_ok=True)
    report_path = os.path.join(REPORTS_DIR, "seo-review-%s.md" % date)
    lines = ["# SEO review — %s\n" % date,
             "Base URL checked: %s\n" % base,
             "## Checks\n"]
    for name, ok, detail in checks:
        lines.append("- [%s] %s — %s" % ("x" if ok else " ", name, detail))
    lines.append("\nResult: %d/%d checks passed."
                 % (len(checks) - len(failed), len(checks)))
    if failed:
        lines.append("Failures need a look before the next review.")
    with open(report_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print("SEO review %s: %d/%d checks passed. Report: %s"
          % ("OK" if not failed else "FAILED",
             len(checks) - len(failed), len(checks), report_path))
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
