#!/usr/bin/env python3
"""Refresh Home Shopping product data from the AliExpress Affiliate API.

Reads products.json (the single source of truth). It only ever updates the
products already listed there -- it never adds products, never invents
prices, images or affiliate links, and never writes a generic search link.

If the three secrets are missing, the script exits gracefully (code 0) and
changes nothing, so the scheduled workflow is a harmless no-op until the
owner adds the secrets in GitHub Settings > Secrets and variables > Actions:
  ALIEXPRESS_APP_KEY, ALIEXPRESS_APP_SECRET, ALIEXPRESS_TRACKING_ID

When the secrets are present it calls the AliExpress Open Platform
(affiliate productdetail API) with a signed (MD5) request for each
aliexpress_item_id, and updates price_egp / old_price_egp / image from the
response. Affiliate links already stored in products.json are kept as-is;
they are only replaced when the API returns a fresh link for the same item.
Any API failure leaves products.json untouched.
"""

import hashlib
import json
import os
import sys
import time
import urllib.parse
import urllib.request

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRODUCTS_PATH = os.path.join(BASE_DIR, "products.json")

# AliExpress Open Platform gateway (affiliate APIs).
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


def refresh_product(product, app_key, app_secret, tracking_id):
    """Refresh one product in place from the affiliate productdetail API.

    Returns True if at least one field was updated from the API response.
    """
    result = api_call(
        "aliexpress.affiliate.productdetail.get",
        {
            "product_ids": product["aliexpress_item_id"],
            "fields": (
                "product_id,product_title,target_sale_price,target_original_price,"
                "product_main_image_url,evaluate_rate"
            ),
            "target_currency": "EGP",
            "target_language": "AR",
            "tracking_id": tracking_id,
        },
        app_key,
        app_secret,
    )
    resp = result.get("aliexpress_affiliate_productdetail_get_response", {})
    items = (resp.get("resp_result", {}) or {}).get("result", {}) or {}
    products = items.get("products", {}).get("product", []) if isinstance(items, dict) else []
    if not products:
        print(f"  no API data returned for {product['id']} ({product['aliexpress_item_id']})")
        return False
    info = products[0]
    updated = False
    sale = info.get("target_sale_price")
    if sale:
        try:
            price = float(str(sale).replace(",", ""))
            if price > 0 and price != product.get("price_egp"):
                product["price_egp"] = round(price, 2)
                updated = True
        except (TypeError, ValueError):
            pass
    original = info.get("target_original_price")
    if original:
        try:
            old = float(str(original).replace(",", ""))
            if old > 0 and old != product.get("old_price_egp"):
                product["old_price_egp"] = round(old, 2)
                updated = True
        except (TypeError, ValueError):
            pass
    image = info.get("product_main_image_url")
    if image and image != product.get("image_url"):
        product["image_url"] = image
        updated = True
    rating = info.get("evaluate_rate")
    if rating:
        try:
            rate = float(str(rating).replace("%", ""))
            if rate > 0:
                product["rating"] = round(rate, 1)
                updated = True
        except (TypeError, ValueError):
            pass
    if product.get("price_egp") and product.get("old_price_egp"):
        old, new = product["old_price_egp"], product["price_egp"]
        if old > new:
            product["discount_percent"] = round((old - new) / old * 100)
            updated = True
    return updated


def main():
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
            "Skipping the API refresh; products.json was not changed. "
            "Add the secrets in GitHub Settings > Secrets and variables > "
            "Actions, then run the workflow again."
        )
        return 0

    with open(PRODUCTS_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    products = data.get("products", [])
    if not products:
        print("products.json has no products; nothing to refresh.")
        return 0

    changed = False
    for product in products:
        print(f"Refreshing {product['id']} ({product['aliexpress_item_id']}) ...")
        try:
            if refresh_product(product, app_key, app_secret, tracking_id):
                changed = True
                print(f"  updated {product['id']}")
        except Exception as exc:  # noqa: BLE001 - never corrupt products.json
            print(f"  API call failed for {product['id']}: {exc}. Keeping old data.")
            continue

    if not changed:
        print("No product data changed; products.json was not rewritten.")
        return 0

    with open(PRODUCTS_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print("products.json updated.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
