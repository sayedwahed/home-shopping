"""Dynamic pricing rules (system 17 of the spec).

Rules for an affiliate store — the final price is charged on AliExpress,
so the store must never invent prices, fake a discount, or mark a price
up or down:

* The displayed price is always the live API price (price_usd).
* A "was" (old) price is shown ONLY when the API reported a real
  original price that is higher than the sale price. If old_price_usd
  is missing, equal to, or lower than the sale price, no "was" price
  is shown at all — no fake discount is ever displayed.
* The discount percent shown is always computed from those two real
  numbers, never stored or invented separately.

Policy knobs live in the settings table (never in code):
* pricing_show_was_only_when_real  "1" (default) — show the old price
  only when it is a real, higher original price.
* pricing_margin_percent           "0" (default) — reserved for a
  future own-price display. It is NEVER applied to affiliate display
  prices: marking an AliExpress price up or down would mislead the
  visitor, so a non-zero value is ignored and logged as a warning.
"""

import db as store_db


def pricing_policy(conn):
    """Read the pricing policy from settings (with safe defaults)."""
    try:
        margin = float(
            store_db.get_setting(conn, "pricing_margin_percent", "0") or "0"
        )
    except ValueError:
        margin = 0.0
    show_was = (
        store_db.get_setting(conn, "pricing_show_was_only_when_real", "1") or "1"
    ) != "0"
    return {"margin_percent": margin, "show_was_only_when_real": show_was}


def display_price(product, policy=None):
    """Return (price, old_price, discount_percent) for display.

    `product` is a row/dict with price_usd / old_price_usd /
    discount_percent. old_price is returned only when it is a real
    original price higher than the sale price; otherwise None.
    discount_percent is recomputed from the two real prices.
    """
    policy = policy or {"margin_percent": 0.0, "show_was_only_when_real": True}
    price = float(product["price_usd"])
    old = product.get("old_price_usd")
    old = float(old) if old is not None else None

    if not policy.get("show_was_only_when_real", True):
        return price, None, None
    if old is None or old <= price:
        return price, None, None
    discount = round((old - price) / old * 100)
    return price, old, discount


def check_margin_policy(conn):
    """Warn when a non-zero margin is configured (it is ignored for
    affiliate display prices — see the module docstring)."""
    policy = pricing_policy(conn)
    if policy["margin_percent"]:
        store_db.log_error(
            conn, "warning",
            "pricing_margin_percent is %s but affiliate display prices "
            "are never marked up; the setting is ignored."
            % policy["margin_percent"],
            context="pricing",
        )
        return False
    return True


def featured_order(products):
    """Order products for the storefront: biggest real discount first,
    then price ascending. Used by the index when sort=featured."""
    def key(p):
        _price, _old, discount = display_price(p)
        return (-(discount or 0), float(p["price_usd"]))

    return sorted(products, key=key)
