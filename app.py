"""Home Shopping — Flask affiliate store (systems 1-4 of the spec).

English-only, USD-only storefront for the owner's 3 AliExpress affiliate
products. No Arabic UI, no EGP display, no currency conversion.

Routes:
  /                     storefront (search / category filter / sort)
  /product/<id>         product page
  /go/<id>              disclosure interstitial — shows the product, an
                        affiliate-link notice and a "Continue to AliExpress"
                        button. NO auto-redirect, NO hidden JS, NO popups.
  /go/<id>/continue     POST only: records the click (only when the button
                        is pressed) and redirects to the affiliate URL.
  /health               {"status": "ok"}
  /sitemap.xml          dynamic sitemap (home + every product page)
  /robots.txt           allows crawling, points at the sitemap

Every response carries security headers (CSP, HSTS, X-Frame-Options,
X-Content-Type-Options, Referrer-Policy). The session cookie is HttpOnly
with SameSite=Lax.
"""

import os
from datetime import datetime, timezone

from flask import (
    Flask,
    abort,
    g,
    redirect,
    render_template,
    request,
    session,
    url_for,
)

import db as store_db
import geo

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def create_app():
    app = Flask(__name__)
    app.config["SECRET_KEY"] = os.environ.get(
        "SECRET_KEY", "dev-only-change-me-in-production"
    )
    # Session cookie: HttpOnly + SameSite=Lax (spec system 1).
    app.config["SESSION_COOKIE_HTTPONLY"] = True
    app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
    app.config["SESSION_COOKIE_SECURE"] = (
        os.environ.get("SESSION_COOKIE_SECURE", "0") == "1"
    )
    app.config["PERMANENT_SESSION_LIFETIME"] = 60 * 60 * 24 * 14  # 14 days

    @app.before_request
    def _before_request():
        g.db = store_db.connect()
        # Country detection: once per session, country code only.
        if "country" not in session:
            session["country"] = geo.detect_country(geo.client_ip(request))
        g.locale = geo.active_locale()
        g.country = session.get("country", geo.DEFAULT_COUNTRY)

    @app.teardown_request
    def _teardown_request(_exc=None):
        conn = getattr(g, "db", None)
        if conn is not None:
            conn.close()

    @app.after_request
    def _security_headers(resp):
        # Every response carries these headers (spec system 1).
        resp.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "img-src 'self' https://ae-pic-a1.aliexpress-media.com data:; "
            "style-src 'self'; script-src 'self'; "
            "font-src 'self'; object-src 'none'; "
            "base-uri 'self'; frame-ancestors 'none'"
        )
        resp.headers["Strict-Transport-Security"] = (
            "max-age=63072000; includeSubDomains"
        )
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        return resp

    @app.context_processor
    def _inject_globals():
        return {"locale": getattr(g, "locale", geo.active_locale()),
                "country": getattr(g, "country", geo.DEFAULT_COUNTRY)}

    def _base_url():
        return os.environ.get("BASE_URL") or request.url_root.rstrip("/")

    @app.route("/")
    def index():
        q = (request.args.get("q") or "").strip()
        cat = request.args.get("cat") or "all"
        sort = request.args.get("sort") or "featured"
        max_price = request.args.get("max_price")
        try:
            max_price = float(max_price) if max_price not in (None, "") else None
        except ValueError:
            max_price = None
        products = store_db.get_all_products(
            g.db, q=q or None, category=cat, sort=sort, max_price=max_price
        )
        categories = store_db.get_categories(g.db)
        return render_template(
            "index.html",
            products=products,
            categories=categories,
            q=q,
            cat=cat,
            sort=sort,
            max_price=max_price,
            base_url=_base_url(),
        )

    @app.route("/product/<product_id>")
    def product_page(product_id):
        product = store_db.get_product(g.db, product_id)
        if product is None:
            abort(404)
        related = [
            p for p in store_db.get_all_products(g.db, category=product["category"])
            if p["id"] != product_id
        ]
        return render_template(
            "product.html", product=product, related=related,
            base_url=_base_url(),
        )

    @app.route("/go/<product_id>")
    def go_page(product_id):
        """Disclosure interstitial (spec system 5, read-only page).

        Shows the product image + title, a clear affiliate-link notice and
        a button. Nothing redirects automatically; nothing is recorded
        until the visitor presses the button (POST /go/<id>/continue).
        """
        product = store_db.get_product(g.db, product_id)
        if product is None:
            abort(404)
        ref = (request.args.get("ref") or "").strip()[:64]
        return render_template(
            "go.html", product=product, ref=ref, base_url=_base_url()
        )

    @app.route("/go/<product_id>/continue", methods=["POST"])
    def go_continue(product_id):
        """Record the click, then redirect to the affiliate URL.

        This is the ONLY place a click is recorded: an explicit press of
        the "Continue to AliExpress" button. The full IP is never stored —
        only its SHA-256 hash (see geo.ip_hash).
        """
        product = store_db.get_product(g.db, product_id)
        if product is None:
            abort(404)
        ref = (request.form.get("ref") or "").strip()[:64]
        stamp = datetime.now(timezone.utc).isoformat()
        store_db.record_click(
            g.db,
            product_id,
            ref or None,
            geo.ip_hash(geo.client_ip(request)),
            session.get("country", geo.DEFAULT_COUNTRY),
            stamp,
        )
        return redirect(product["affiliate_url"], code=302)

    @app.route("/health")
    def health():
        return {"status": "ok"}

    @app.route("/sitemap.xml")
    def sitemap():
        products = store_db.get_all_products(g.db)
        base = _base_url()
        xml = ['<?xml version="1.0" encoding="UTF-8"?>',
               '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
        xml.append("<url><loc>%s/</loc></url>" % base)
        for p in products:
            xml.append(
                "<url><loc>%s%s</loc></url>"
                % (base, url_for("product_page", product_id=p["id"]))
            )
        xml.append("</urlset>")
        return "\n".join(xml), 200, {"Content-Type": "application/xml"}

    @app.route("/robots.txt")
    def robots():
        base = _base_url()
        body = (
            "User-agent: *\n"
            "Allow: /\n"
            "Disallow: /go/\n"
            "Sitemap: %s/sitemap.xml\n" % base
        )
        return body, 200, {"Content-Type": "text/plain"}

    @app.errorhandler(404)
    def not_found(_err):
        return render_template("404.html"), 404

    return app


app = create_app()

# Serverless hosts (e.g. Vercel) have no shell to run seed.py, so create
# the tables and seed the 3 products at import time. The seed is
# idempotent (re-runs preserve click counts); seed_from_json() calls
# init_db() itself, and the __main__ block below does the same for
# local runs.
store_db.seed_from_json()

if __name__ == "__main__":
    store_db.init_db()
    store_db.seed_from_json()
    app.run(host="127.0.0.1", port=5000, debug=False)
