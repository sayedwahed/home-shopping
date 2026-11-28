#!/usr/bin/env python3
"""09:00 Blogger post job (system 19 of the spec).

Builds a short draft post from the store's best-clicked product and
hands it to the Blogger publisher in DRY-RUN mode by default — it only
logs what it WOULD publish. A live publish needs --live AND Blogger
credentials AND is still refused by this build (see publishers/base.py);
the owner publishes from the Blogger dashboard after review.

Usage:
    python scripts/blogger_post.py            # dry run (default)
    python scripts/blogger_post.py --live     # still dry-run unless live is enabled
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import db as store_db  # noqa: E402
from publishers.registry import get_publisher  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description="Draft the daily Blogger post.")
    parser.add_argument("--live", action="store_true",
                        help="Attempt a live publish (refused by this build)")
    args = parser.parse_args()

    conn = store_db.connect()
    try:
        per_product = store_db.clicks_per_product(conn)
    finally:
        conn.close()
    if not per_product:
        print("No products in the database — nothing to post.")
        return 0
    top = per_product[0]
    title = "Deal of the day: %s" % top["title"]
    body = (
        "%s is one of our most-clicked deals on Home Shopping. "
        "Price: $%.2f on AliExpress (prices change, check the store for "
        "the current price). Our links are affiliate links — we may earn "
        "a commission at no extra cost to you."
        % (top["title"], 0.0)
    )
    # The real price comes from the product row; rebuild the body with it.
    conn = store_db.connect()
    try:
        product = store_db.get_product(conn, top["product_id"])
    finally:
        conn.close()
    if product:
        body = (
            "%s is one of our most-clicked deals on Home Shopping. "
            "Current price: $%.2f on AliExpress (prices change — check "
            "the store for the current price). Our links are affiliate "
            "links: we may earn a commission at no extra cost to you."
            % (product["title"], float(product["price_usd"]))
        )
    result = get_publisher("blogger").publish_draft(
        title, body, image_url=product["image_url"] if product else None,
        dry_run=not args.live,
    )
    print("%s: %s" % (result["status"], result["detail"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
