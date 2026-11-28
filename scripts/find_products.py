#!/usr/bin/env python3
"""Automatic product finder (companion to systems 4 and 17).

Discovers high-commission, high-discount, well-rated AliExpress
products through the owner's Affiliate API account and — in --add mode
— merges the best ones into data/products.json, each with an affiliate
link generated with HIS tracking ID.

HONEST LIMITS (read before expecting magic):
* The AliExpress Affiliate API has NO "scan the whole catalogue"
  endpoint. The real method used here is: query
  aliexpress.affiliate.hotproduct.query (global hot products) plus
  aliexpress.affiliate.product.query across a list of popular keywords,
  page through the results, and rank the candidates.
* The owner's API app is currently in "Test / Under Review" status.
  If the API calls fail (app not approved for live calls yet), this
  script logs the EXACT error, exits non-zero and adds NOTHING. It
  never fakes results.
* Only products with a generated s.click.aliexpress.com link (made
  with the owner's tracking ID) are ever added. A candidate without
  such a link is skipped.
* Prices are the API's native USD prices (target_currency=USD). The
  script never invents a price, a rating or a discount.

Auth: same signed-MD5 approach as scripts/refresh_prices.py.
Secrets come ONLY from the environment (never from files):
  ALIEXPRESS_APP_KEY, ALIEXPRESS_APP_SECRET, ALIEXPRESS_TRACKING_ID

Usage:
    python scripts/find_products.py --dry-run
        Rank candidates, write data/product_candidates.json + a
        Markdown report (data/product_candidates.md), add nothing.
    python scripts/find_products.py --add [--max 50]
        Merge the top N candidates into data/products.json, skipping
        items already present (by AliExpress item id) and never
        touching the existing products' links.
"""

import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

API_URL = "https://api-sg.aliexpress.com/sync"

# --- Filters (tune these constants to change what qualifies) ---------------
MIN_RATING = 4.5          # 5-star scale
MIN_ORDERS = 100          # minimum sales volume (orders)
MIN_COMMISSION_RATE = 0.05  # 5% — AliExpress reports this as 0.05 or "5%"
MIN_DISCOUNT = 0.20       # 20% off the original price
MAX_PER_RUN = 50          # default cap of products added per --add run
SLEEP_BETWEEN_CALLS = 0.6  # seconds, to respect API rate limits

# Keywords searched with aliexpress.affiliate.product.query (3 pages each).
KEYWORDS = [
    "electronics", "home gadgets", "kitchen gadgets", "phone accessories",
    "fashion", "fitness", "beauty", "car accessories", "toys", "sports",
]
PAGES_PER_KEYWORD = 2
PAGE_SIZE = 20
HOT_PAGES = 2  # pages of aliexpress.affiliate.hotproduct.query

FIELDS = (
    "product_id,product_title,product_main_image_url,"
    "target_sale_price,target_original_price,discount,evaluate_rate,"
    "lastest_volume,commission_rate,shop_id,"
    "first_level_category_name,second_level_category_name"
)


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


def _find_products_recursive(node, out):
    """Collect every dict that looks like a product (has product_id)."""
    if isinstance(node, dict):
        if node.get("product_id"):
            out.append(node)
        for value in node.values():
            _find_products_recursive(value, out)
    elif isinstance(node, list):
        for item in node:
            _find_products_recursive(item, out)


def extract_products(payload):
    """Pull product dicts out of any AliExpress query response shape."""
    out = []
    _find_products_recursive(payload, out)
    return out


def api_error(payload):
    """Return the API's error dict when the call failed, else None."""
    if not isinstance(payload, dict):
        return {"code": "bad_response", "msg": "Response was not JSON object"}
    err = payload.get("error_response")
    if err:
        return {"code": err.get("code"), "msg": err.get("msg")}
    # Some failures arrive inside resp_result.
    for key, value in payload.items():
        if isinstance(value, dict):
            result = value.get("resp_result", {})
            if isinstance(result, dict) and (
                result.get("error_code") or result.get("error_msg")
            ):
                return {"code": result.get("error_code"),
                        "msg": result.get("error_msg")}
    return None


def _to_float(value, default=None):
    if value is None:
        return default
    try:
        return float(str(value).replace(",", "").replace("%", "").strip())
    except (TypeError, ValueError):
        return default


def _to_int(value, default=0):
    number = _to_float(value, None)
    return int(number) if number is not None else default


def normalise_rating(raw):
    """evaluate_rate arrives as 4.9, or as a percentage like '97%'.

    Returns a 0-5 float, or None when it cannot be read."""
    value = _to_float(raw, None)
    if value is None:
        return None
    if value > 5:  # a percentage (e.g. 97) -> 5-star scale
        return round(value / 20.0, 1)
    return round(value, 1)


def normalise_rate(raw):
    """commission_rate arrives as 0.08 or '8%'. Returns 0-1 float."""
    value = _to_float(raw, None)
    if value is None:
        return None
    if value > 1:  # a percentage (e.g. 8) -> fraction
        return value / 100.0
    return value


def normalise_candidate(raw):
    """Turn one raw API product into a candidate dict (or None)."""
    item_id = str(raw.get("product_id") or "").strip()
    title = (raw.get("product_title") or "").strip()
    if not item_id or not title:
        return None
    price = _to_float(raw.get("target_sale_price"), None)
    if price is None or price <= 0:
        price = _to_float(raw.get("sale_price"), None)
    if price is None or price <= 0:
        return None
    original = _to_float(raw.get("target_original_price"), None)
    if original is None or original <= 0:
        original = _to_float(raw.get("original_price"), None)
    discount = normalise_rate(raw.get("discount"))
    if discount is None and original and original > price:
        discount = (original - price) / original
    rating = normalise_rating(raw.get("evaluate_rate"))
    sales = _to_int(raw.get("lastest_volume"),
                    _to_int(raw.get("sale_volume"),
                            _to_int(raw.get("volume"), 0)))
    commission = normalise_rate(raw.get("commission_rate"))
    if commission is None:
        commission = normalise_rate(raw.get("hot_product_commission_rate"))
    category = (raw.get("first_level_category_name")
                or raw.get("second_level_category_name")
                or raw.get("category_name") or "General")
    return {
        "aliexpress_item_id": item_id,
        "title": title,
        "image": (raw.get("product_main_image_url") or "").strip() or None,
        "price_usd": round(price, 2),
        "old_price_usd": round(original, 2) if original and original > price else None,
        "discount": round(discount, 2) if discount is not None else None,
        "rating": rating,
        "sales": sales,
        "commission_rate": commission,
        "category": str(category).strip(),
        "shop_id": str(raw.get("shop_id") or ""),
    }


def score(candidate):
    """Rank key: commission x discount x rating x sales volume.

    Sales use log10 so a 100k-seller does not drown out a 500-seller
    with a much better commission. Missing data scores 0 on that factor.
    """
    import math

    commission = candidate.get("commission_rate") or 0
    discount = candidate.get("discount") or 0
    rating = candidate.get("rating") or 0
    sales = candidate.get("sales") or 0
    return commission * discount * rating * math.log10(1 + sales)


def qualifies(candidate):
    """True when the candidate passes every configured filter."""
    if candidate["rating"] is None or candidate["rating"] < MIN_RATING:
        return False
    if candidate["sales"] < MIN_ORDERS:
        return False
    if candidate["commission_rate"] is None or \
            candidate["commission_rate"] < MIN_COMMISSION_RATE:
        return False
    if candidate["discount"] is None or candidate["discount"] < MIN_DISCOUNT:
        return False
    return True


def fetch_candidates(app_key, app_secret, tracking_id):
    """Query hot products + keywords. Returns (candidates, errors).

    `errors` collects the exact API error of every failed call. When
    every call fails, the caller must abort the run.
    """
    seen = {}
    errors = []
    base = {
        "fields": FIELDS,
        "target_currency": "USD",
        "target_language": "EN",
        "tracking_id": tracking_id,
    }
    # When the very first call fails with an auth error (bad key, bad
    # signature, app not approved for live calls), every later call
    # would fail the same way — abort the run instead of burning 20+
    # useless calls. Other errors (timeouts, one bad keyword) only
    # skip that single call.
    abort_all = [False]

    def run_query(method, extra):
        if abort_all[0]:
            return []
        params = dict(base)
        params.update(extra)
        try:
            payload = api_call(method, params, app_key, app_secret)
        except Exception as exc:  # noqa: BLE001 - a failed call is data
            errors.append({"method": method, "error": str(exc)})
            return []
        err = api_error(payload)
        if err:
            errors.append({"method": method, "error": err})
            code = str(err.get("code") or "")
            first_failure = len(errors) == 1
            if first_failure and any(
                word in code for word in ("AppKey", "Signature", "Auth")
            ):
                abort_all[0] = True
            return []
        return [normalise_candidate(p) for p in extract_products(payload)]

    # 1. Global hot products.
    for page in range(1, HOT_PAGES + 1):
        for cand in run_query("aliexpress.affiliate.hotproduct.query",
                              {"page_no": page, "page_size": PAGE_SIZE}):
            if cand:
                seen.setdefault(cand["aliexpress_item_id"], cand)
        time.sleep(SLEEP_BETWEEN_CALLS)

    # 2. Keyword searches.
    for keyword in KEYWORDS:
        for page in range(1, PAGES_PER_KEYWORD + 1):
            for cand in run_query(
                    "aliexpress.affiliate.product.query",
                    {"keywords": keyword, "page_no": page,
                     "page_size": PAGE_SIZE}):
                if cand:
                    seen.setdefault(cand["aliexpress_item_id"], cand)
            time.sleep(SLEEP_BETWEEN_CALLS)

    return list(seen.values()), errors


def _find_links_recursive(node, out):
    """Collect dicts carrying both source_value and promotion_link."""
    if isinstance(node, dict):
        if node.get("source_value") and node.get("promotion_link"):
            out.append(node)
        for value in node.values():
            _find_links_recursive(value, out)
    elif isinstance(node, list):
        for item in node:
            _find_links_recursive(item, out)


def generate_links(item_ids, app_key, app_secret, tracking_id):
    """Generate affiliate links with the owner's tracking ID.

    Returns {item_id: s.click URL}. A product whose link is missing or
    is not an s.click.aliexpress.com URL is left out — it is never added.
    """
    links = {}
    for start in range(0, len(item_ids), 50):
        chunk = item_ids[start:start + 50]
        source_values = ",".join(
            "https://www.aliexpress.com/item/%s.html" % item_id
            for item_id in chunk
        )
        payload = api_call(
            "aliexpress.affiliate.link.generate",
            {"promotion_link_type": 0, "source_values": source_values,
             "tracking_id": tracking_id},
            app_key, app_secret,
        )
        err = api_error(payload)
        if err:
            raise RuntimeError("link.generate failed: %s" % err)
        found = []
        _find_links_recursive(payload, found)
        for entry in found:
            source = entry.get("source_value", "")
            match = re.search(r"/item/(\d+)\.html", source)
            url = (entry.get("promotion_link") or "").strip()
            if match and url.startswith("https://s.click.aliexpress.com/"):
                links[match.group(1)] = url
        time.sleep(SLEEP_BETWEEN_CALLS)
    return links


def _slug(title, item_id):
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:60].strip("-")
    return slug or ("product-%s" % item_id)


def to_store_product(candidate, affiliate_link, used_ids):
    """Convert a ranked candidate into a products.json entry."""
    product_id = _slug(candidate["title"], candidate["aliexpress_item_id"])
    suffix = 2
    while product_id in used_ids:
        product_id = "%s-%d" % (_slug(candidate["title"],
                                      candidate["aliexpress_item_id"]), suffix)
        suffix += 1
    used_ids.add(product_id)
    category = candidate["category"] or "General"
    discount = candidate["discount"]
    return {
        "id": product_id,
        "name_en": candidate["title"],
        "name": candidate["title"],
        "description_en": candidate["title"],
        "description": candidate["title"],
        "category_en": category,
        "category": category.lower().replace(" ", "-"),
        "price_usd": candidate["price_usd"],
        "old_price_usd": candidate["old_price_usd"],
        "image": candidate["image"],
        "affiliate_link": affiliate_link,
        "aliexpress_item_id": candidate["aliexpress_item_id"],
        "rating": candidate["rating"],
        "sales_note_en": ("Over %s sold" % f"{candidate['sales']:,}"
                          if candidate["sales"] >= 1000 else None),
        "sales_note": None,
        "discount_percent": (round(discount * 100)
                             if discount is not None else None),
    }


def write_candidates(candidates, path_json, path_md):
    data = {"generated_at": datetime.now(timezone.utc).isoformat(),
            "count": len(candidates), "candidates": candidates}
    with open(path_json, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    lines = ["# Product candidates — %s\n"
             % datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
             "Filters: rating >= %s, orders >= %d, commission >= %.0f%%, "
             "discount >= %.0f%%. Ranked by commission x discount x rating "
             "x log10(sales).\n"
             % (MIN_RATING, MIN_ORDERS, MIN_COMMISSION_RATE * 100,
                MIN_DISCOUNT * 100)]
    for i, cand in enumerate(candidates, 1):
        lines.append(
            "%d. **%s** — $%.2f%s, rating %s, %s orders, commission %.1f%%, "
            "discount %.0f%%, score %.2f — item %s"
            % (i, cand["title"], cand["price_usd"],
               (" (was $%.2f)" % cand["old_price_usd"])
               if cand["old_price_usd"] else "",
               cand["rating"], f"{cand['sales']:,}",
               (cand["commission_rate"] or 0) * 100,
               (cand["discount"] or 0) * 100,
               cand.get("score", 0), cand["aliexpress_item_id"]))
    with open(path_md, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    return path_json, path_md


def main():
    parser = argparse.ArgumentParser(
        description="Find AliExpress products and add them to the store.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--dry-run", action="store_true",
                       help="Rank candidates and write the report; add nothing.")
    group.add_argument("--add", action="store_true",
                       help="Merge the top N candidates into data/products.json.")
    parser.add_argument("--max", type=int, default=MAX_PER_RUN,
                        help="Max products to add per --add run (default 50).")
    args = parser.parse_args()

    app_key = os.environ.get("ALIEXPRESS_APP_KEY")
    app_secret = os.environ.get("ALIEXPRESS_APP_SECRET")
    tracking_id = os.environ.get("ALIEXPRESS_TRACKING_ID")
    missing = [name for name, value in (
        ("ALIEXPRESS_APP_KEY", app_key),
        ("ALIEXPRESS_APP_SECRET", app_secret),
        ("ALIEXPRESS_TRACKING_ID", tracking_id),
    ) if not value]
    if missing:
        print("ERROR: missing AliExpress credentials: %s. "
              "Set them as environment variables; nothing was added."
              % ", ".join(missing))
        return 2

    print("Querying the AliExpress Affiliate API (hot products + %d keywords)..."
          % len(KEYWORDS))
    raw, errors = fetch_candidates(app_key, app_secret, tracking_id)
    if not raw:
        print("ERROR: no products returned. API errors seen:")
        for err in errors:
            print("  - %s" % (err,))
        print("If the app is still in Test / Under Review, the API refuses "
              "live calls — wait for approval and try again. Nothing added.")
        return 2
    if errors:
        print("Note: %d API call(s) failed (see above); continuing with "
              "the %d product(s) that did return." % (len(errors), len(raw)))

    ranked = sorted(
        (dict(c, score=score(c)) for c in raw if qualifies(c)),
        key=lambda c: c["score"], reverse=True)
    print("Fetched %d unique product(s); %d pass the filters."
          % (len(raw), len(ranked)))

    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    products_path = os.path.join(base_dir, "data", "products.json")
    with open(products_path, "r", encoding="utf-8") as f:
        store_data = json.load(f)
    existing_ids = {str(p.get("aliexpress_item_id"))
                    for p in store_data.get("products", [])}
    new_ranked = [c for c in ranked
                  if c["aliexpress_item_id"] not in existing_ids]
    print("%d candidate(s) are new (not already in the store)."
          % len(new_ranked))

    if args.dry_run:
        top = new_ranked[:args.max]
        json_path, md_path = write_candidates(
            top,
            os.path.join(base_dir, "data", "product_candidates.json"),
            os.path.join(base_dir, "data", "product_candidates.md"))
        print("Dry run: wrote %d candidate(s) to %s and %s. "
              "Nothing was added to the store."
              % (len(top), json_path, md_path))
        return 0

    # --add: generate affiliate links for the top N, then merge.
    top = new_ranked[:args.max]
    if not top:
        print("Nothing new to add.")
        return 0
    print("Generating affiliate links for the top %d candidate(s)..."
          % len(top))
    try:
        links = generate_links(
            [c["aliexpress_item_id"] for c in top],
            app_key, app_secret, tracking_id)
    except Exception as exc:  # noqa: BLE001 - link failure must abort the add
        print("ERROR: %s Nothing was added." % exc)
        return 2
    used_ids = {p.get("id") for p in store_data.get("products", [])}
    added = []
    for cand in top:
        link = links.get(cand["aliexpress_item_id"])
        if not link:
            print("  skipped %s: no affiliate link generated for it."
                  % cand["aliexpress_item_id"])
            continue
        added.append(to_store_product(cand, link, used_ids))
    if not added:
        print("ERROR: no affiliate links could be generated. Nothing added.")
        return 2
    store_data["products"].extend(added)
    with open(products_path, "w", encoding="utf-8") as f:
        json.dump(store_data, f, indent=2, ensure_ascii=False)
    print("Added %d product(s) to data/products.json (total now %d). "
          "Run `python seed.py` to load them into the database."
          % (len(added), len(store_data["products"])))
    return 0


if __name__ == "__main__":
    sys.exit(main())
