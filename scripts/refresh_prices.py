#!/usr/bin/env python3
"""Daily price refresh for the Flask store (system 4 of the spec).

Updates price_usd / old_price_usd / image / rating in the SQLite database
from the AliExpress Affiliate API, using the same signed (MD5) request
approach as the static store's scripts/update-products.py — but with
target_currency=USD and target_language=EN, because this store is
USD-only and English-only.

It only ever updates the products already in the database: it never adds
products, never invents prices, images or affiliate links.

If the three secrets are missing it exits gracefully (code 0) and changes
nothing, so a scheduled run is a harmless no-op until the owner sets them:
  ALIEXPRESS_APP_KEY, ALIEXPRESS_APP_SECRET, ALIEXPRESS_TRACKING_ID

Usage:
    python scripts/refresh_prices.py            # uses ./data/store.db
    python scripts/refresh_prices.py --db PATH

Run daily (Render Cron Job or APScheduler) once the API app is approved.
"""

import argparse
import hashlib
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import db as store_db  # noqa: E402

API_URL = "https://api-sg.aliexpress.com/sync"


def md5_sign(params, app_secret):
    """AliExpress sign: MD5(secret + sorted key+value pairs + secret)."""
    ordered = sorted(params.items())
    raw = app_secret + "".join(k + str(v) for k, v in ordered) + app_secret
    return hashlib.md5(raw.encode("utf-8")).hexdigest().upper()


def api_call(method, biz_params, app_key, app_secret):
    """One signed AliExpress API call. Returns parsed JSON or raises."""
    params = {
        "method": method,
        "app_key": app_key,
        "sign_method": "md5",
        "format": "json",
        "v": "2.0",
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime()),
    }
    params.update(biz_params)
    params["sign"] = md5_sign(params, app_secret)
    data = urllib.parse.urlencode(params).encode("utf-8")
    req = urllib.request.Request(API_URL, data=data, method="POST")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def refresh_one(conn, product, app_key, app_secret, tracking_id, stamp):
    """Refresh one product row from the affiliate productdetail API (USD)."""
    result = api_call(
        "aliexpress.affiliate.productdetail.get",
        {
            "product_ids": product["aliexpress_item_id"],
            "fields": (
                "product_id,product_title,target_sale_price,target_original_price,"
                "product_main_image_url,evaluate_rate"
            ),
            "target_currency": "USD",
            "target_language": "EN",
            "tracking_id": tracking_id,
        },
        app_key,
        app_secret,
    )
    resp = result.get("aliexpress_affiliate_productdetail_get_response", {})
    items = (resp.get("resp_result", {}) or {}).get("result", {}) or {}
    products = items.get("products", {}).get("product", []) if isinstance(items, dict) else []
    if not products:
        print(f"  no API data returned for {product['id']}")
        return False
    info = products[0]
    updates = {}
    sale = info.get("target_sale_price")
    if sale:
        try:
            price = float(str(sale).replace(",", ""))
            if price > 0 and price != product["price_usd"]:
                updates["price_usd"] = round(price, 2)
        except (TypeError, ValueError):
            pass
    original = info.get("target_original_price")
    if original:
        try:
            old = float(str(original).replace(",", ""))
            if old > 0 and old != product["old_price_usd"]:
                updates["old_price_usd"] = round(old, 2)
        except (TypeError, ValueError):
            pass
    image = info.get("product_main_image_url")
    if image and image != product["image_url"]:
        updates["image_url"] = image
    rating = info.get("evaluate_rate")
    if rating:
        try:
            rate = float(str(rating).replace("%", ""))
            if rate > 0:
                updates["rating"] = round(rate, 1)
        except (TypeError, ValueError):
            pass
    if updates:
        if "price_usd" in updates or "old_price_usd" in updates:
            new = updates.get("price_usd", product["price_usd"])
            old = updates.get("old_price_usd", product["old_price_usd"])
            if old and new and old > new:
                updates["discount_percent"] = round((old - new) / old * 100)
        sets = ", ".join(f"{k} = ?" for k in updates) + ", updated_at = ?"
        conn.execute(
            f"UPDATE products SET {sets} WHERE id = ?",
            (*updates.values(), stamp, product["id"]),
        )
        print(f"  updated {product['id']}: {updates}")
        return True
    return False


def main():
    parser = argparse.ArgumentParser(description="Refresh prices from AliExpress API.")
    parser.add_argument("--db", default=store_db.DB_PATH)
    args = parser.parse_args()

    app_key = os.environ.get("ALIEXPRESS_APP_KEY")
    app_secret = os.environ.get("ALIEXPRESS_APP_SECRET")
    tracking_id = os.environ.get("ALIEXPRESS_TRACKING_ID")

    if not app_key or not app_secret or not tracking_id:
        missing = [
            name
            for name, value in (
                ("ALIEXPRESS_APP_KEY", app_key),
                ("ALIEXPRESS_APP_SECRET", app_secret),
                ("ALIEXPRESS_TRACKING_ID", tracking_id),
            )
            if not value
        ]
        print(
            "AliExpress API secrets are missing (" + ", ".join(missing) + "). "
            "Skipping the API refresh; the database was not changed."
        )
        return 0

    store_db.init_db(args.db)
    conn = store_db.connect(args.db)
    stamp = datetime.now(timezone.utc).isoformat()
    changed = 0
    try:
        products = conn.execute("SELECT * FROM products").fetchall()
        for product in products:
            print(f"Refreshing {product['id']} ({product['aliexpress_item_id']}) ...")
            try:
                if refresh_one(conn, product, app_key, app_secret, tracking_id, stamp):
                    changed += 1
            except Exception as exc:  # noqa: BLE001 - never corrupt the DB
                print(f"  API call failed for {product['id']}: {exc}. Keeping old data.")
        conn.commit()
    finally:
        conn.close()
    print(f"Done. {changed} product(s) updated." if changed else "No product data changed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
