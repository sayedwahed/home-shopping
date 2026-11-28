"""Home Shopping — Flask affiliate store (systems 1-23 of the spec).

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
                        CSRF-protected + rate-limited (system 22).
  /health               {"status": "ok"}
  /sitemap.xml          dynamic sitemap (home + every product page)
  /robots.txt           allows crawling, points at the sitemap
  /manifest.json        PWA manifest (system 9)
  /sw.js                service worker — static assets only (system 9)
  /subscribe            email signup, double opt-in (system 11)
  /confirm/<token>      confirm a subscription
  /unsubscribe/<token>  one-click unsubscribe
  /api/push/subscribe   web-push opt-in (system 10)
  /api/push/unsubscribe web-push opt-out
  /admin                admin login (systems 7-8)
  /admin/dashboard      product count, clicks, last 20 errors
  /admin/analytics      clicks per product/day, top countries
  /admin/export/csv     anonymised clicks export (admin only)
  /admin/publish        publishers status + dry-run drafts (system 12)
  /logout               (POST) end the admin session

Every response carries security headers (CSP, HSTS, X-Frame-Options,
X-Content-Type-Options, Referrer-Policy). The session cookie is HttpOnly
with SameSite=Lax. Admin sessions are signed; "Remember me" lasts 14 days.
"""

import csv
import io
import os
import re
from datetime import datetime, timedelta, timezone

from flask import (
    Flask,
    abort,
    g,
    jsonify,
    redirect,
    render_template,
    request,
    send_from_directory,
    session,
    url_for,
)

import auth as admin_auth
import db as store_db
import geo
import image_utils
import mail as mail_mod
import pricing as pricing_mod
import push as push_mod
import security
from publishers.registry import get_publisher, status_list as publisher_status

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


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
    # Template helper (system 16): serve the optimized local copy of a
    # product image when one exists, else the original remote URL.
    app.jinja_env.globals["optimized_image"] = image_utils.optimized_url

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
        return {
            "locale": getattr(g, "locale", geo.active_locale()),
            "country": getattr(g, "country", geo.DEFAULT_COUNTRY),
            "csrf_token": security.get_csrf_token(),
            # VAPID public key is public by design; empty when push is off.
            "vapid_public_key": os.environ.get("VAPID_PUBLIC_KEY", ""),
        }

    def _base_url():
        return os.environ.get("BASE_URL") or request.url_root.rstrip("/")

    def _apply_pricing(products):
        """Apply the pricing rules (system 17) to product rows.

        Rows become plain dicts; price_usd stays the live API price,
        old_price_usd is kept ONLY when it is a real higher original
        price, and discount_percent is recomputed from the two.
        """
        policy = pricing_mod.pricing_policy(g.db)
        out = []
        for p in products:
            d = dict(p)
            price, old, discount = pricing_mod.display_price(d, policy)
            d["price_usd"] = price
            d["old_price_usd"] = old
            d["discount_percent"] = discount
            out.append(d)
        return out

    def _parse_created(value):
        """Parse a products.created_at ISO string to an aware datetime."""
        if not value:
            return None
        try:
            return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None

    def _new_product_ids(conn, days=3):
        """IDs of products added within the last `days` days (real dates)."""
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        ids = set()
        for row in conn.execute("SELECT id, created_at FROM products"):
            created = _parse_created(row["created_at"])
            if created is not None and created >= cutoff:
                ids.add(row["id"])
        return ids

    def _deal_of_the_day(products):
        """Product with the highest real discount (tie-break: rating).

        `products` are _apply_pricing dicts. Returns None when no product
        has a discount — the hero card is then hidden entirely.
        """
        discounted = [p for p in products if p.get("discount_percent")]
        if not discounted:
            return None
        return max(discounted,
                   key=lambda p: (p["discount_percent"], p.get("rating") or 0))

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
        products = _apply_pricing(products)
        if sort == "featured":
            products = pricing_mod.featured_order(products)
        # Pagination: 24 products per page (the catalog grows by up to
        # 50 auto-added products a day; the homepage must stay fast).
        try:
            page = int(request.args.get("page") or 1)
        except ValueError:
            page = 1
        page = max(page, 1)
        PER_PAGE = 24
        total = len(products)
        total_pages = max((total + PER_PAGE - 1) // PER_PAGE, 1)
        page = min(page, total_pages)
        page_products = products[(page - 1) * PER_PAGE:page * PER_PAGE]
        categories = store_db.get_categories(g.db)
        # NEW badge + New arrivals + Deal of the Day (all from real data).
        new_ids = _new_product_ids(g.db)
        show_newest = total > 8 and not q and cat == "all" and max_price is None
        newest = []
        if total > 8:
            newest = _apply_pricing(
                store_db.get_all_products(g.db, sort="newest"))[:8]
        deal = _deal_of_the_day(
            _apply_pricing(store_db.get_all_products(g.db)))
        return render_template(
            "index.html",
            products=page_products,
            categories=categories,
            q=q,
            cat=cat,
            sort=sort,
            max_price=max_price,
            base_url=_base_url(),
            page=page,
            total_pages=total_pages,
            total=total,
            new_ids=new_ids,
            newest=newest,
            show_newest=show_newest,
            deal=deal,
        )

    @app.route("/product/<product_id>")
    def product_page(product_id):
        product = store_db.get_product(g.db, product_id)
        if product is None:
            abort(404)
        product = _apply_pricing([product])[0]
        related = [
            p for p in store_db.get_all_products(g.db, category=product["category"])
            if p["id"] != product_id
        ]
        related = _apply_pricing(related)
        new_ids = _new_product_ids(g.db)
        return render_template(
            "product.html", product=product, related=related,
            base_url=_base_url(), new_ids=new_ids,
            is_new=product["id"] in new_ids,
        )

    @app.route("/about")
    def about_page():
        return render_template("about.html", base_url=_base_url())

    @app.route("/go/<product_id>")
    def go_page(product_id):
        """Disclosure interstitial (spec system 5, read-only page).

        Shows the product image + title, a clear affiliate-link notice and
        a button. Nothing redirects automatically; nothing is recorded
        until the visitor presses the button (POST /go/<id>/continue).
        There is no direct <a> link to AliExpress anywhere on this page
        (or anywhere on the store): the only way out is the disclosed
        POST + 302, so no rel="nofollow sponsored" attribute is needed
        on any rendered link.
        """
        product = store_db.get_product(g.db, product_id)
        if product is None:
            abort(404)
        product = _apply_pricing([product])[0]
        ref = (request.args.get("ref") or "").strip()[:64]
        return render_template(
            "go.html", product=product, ref=ref, base_url=_base_url()
        )

    @app.route("/go/<product_id>/continue", methods=["POST"])
    @security.rate_limit(security.go_continue_limiter,
                         lambda: geo.ip_hash(geo.client_ip(request)))
    @security.csrf_protect
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
        xml.append("<url><loc>%s/about</loc></url>" % base)
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

    # --- PWA (system 9) ----------------------------------------------------

    @app.route("/manifest.json")
    def manifest():
        return send_from_directory(
            os.path.join(BASE_DIR, "static"),
            "manifest.json",
            mimetype="application/manifest+json",
        )

    @app.route("/sw.js")
    def service_worker():
        resp = send_from_directory(
            os.path.join(BASE_DIR, "static", "js"),
            "sw.js",
            mimetype="application/javascript",
        )
        resp.headers["Service-Worker-Allowed"] = "/"
        resp.headers["Cache-Control"] = "no-cache"
        return resp

    # --- Email double opt-in (system 11) ------------------------------------

    @app.route("/subscribe", methods=["GET"])
    def subscribe_form():
        return render_template("subscribe.html", message=None,
                               base_url=_base_url())

    @app.route("/subscribe", methods=["POST"])
    @security.csrf_protect
    def subscribe_post():
        email = (request.form.get("email") or "").strip().lower()
        if not EMAIL_RE.match(email or ""):
            return render_template(
                "subscribe.html",
                message="Please enter a valid email address.",
                base_url=_base_url())
        existing = store_db.get_subscriber_by_email(g.db, email)
        if existing and existing["confirmed"]:
            return render_template(
                "subscribe.html",
                message="This email is already subscribed.",
                base_url=_base_url())
        token, token_hash, expires = mail_mod.make_confirm_token()
        stamp = datetime.now(timezone.utc).isoformat()
        store_db.upsert_pending_subscriber(g.db, email, token_hash, expires, stamp)
        confirm_url = _base_url() + url_for("confirm_subscription", token=token)
        unsub_url = _base_url() + url_for("unsubscribe", token=token)
        if mail_mod.smtp_configured():
            result = mail_mod.send_mail(
                email,
                "Confirm your Home Shopping subscription",
                "Hi,\n\nPlease confirm your subscription to Home Shopping "
                "deal alerts by opening this link (valid 24 hours):\n%s\n\n"
                "If you did not ask for this, ignore this email.\n"
                "Unsubscribe any time: %s\n" % (confirm_url, unsub_url),
            )
            if result["status"] == "sent":
                message = ("Thanks! A confirmation email was sent to %s. "
                           "Open the link inside it to confirm." % email)
            else:
                message = ("Your address was saved, but the confirmation "
                           "email could not be sent (%s). Please try again "
                           "later." % result.get("detail", "send error"))
        else:
            message = ("Email sending is not configured on this store yet, "
                       "so no confirmation email was sent. Your address "
                       "was saved as pending — it will be confirmed once "
                       "email sending is enabled.")
        return render_template("subscribe.html", message=message,
                               base_url=_base_url())

    @app.route("/confirm/<token>")
    def confirm_subscription(token):
        stamp = datetime.now(timezone.utc).isoformat()
        ok = store_db.confirm_subscriber(g.db, mail_mod.hash_token(token), stamp)
        if ok:
            return render_template(
                "message.html", title="Subscription confirmed",
                message="Thanks — your subscription is confirmed. "
                        "You will only get deal alerts, and every email "
                        "carries an unsubscribe link.",
                base_url=_base_url())
        return render_template(
            "message.html", title="Confirmation failed",
            message="This confirmation link is invalid or has expired. "
                    "Please subscribe again to get a fresh link.",
            base_url=_base_url())

    @app.route("/unsubscribe/<token>")
    def unsubscribe(token):
        stamp = datetime.now(timezone.utc).isoformat()
        ok = store_db.unsubscribe_subscriber(g.db, mail_mod.hash_token(token), stamp)
        if ok:
            return render_template(
                "message.html", title="Unsubscribed",
                message="You have been unsubscribed. No more emails will "
                        "be sent to this address.",
                base_url=_base_url())
        return render_template(
            "message.html", title="Unsubscribe failed",
            message="This unsubscribe link is invalid or was already used.",
            base_url=_base_url())

    # --- Web push opt-in/out (system 10) ------------------------------------

    @app.route("/api/push/subscribe", methods=["POST"])
    def push_subscribe():
        token = request.headers.get("X-CSRF-Token", "")
        if not security.validate_csrf_token(token):
            return jsonify({"error": "Invalid CSRF token."}), 403
        data = request.get_json(silent=True) or {}
        endpoint = data.get("endpoint") or ""
        keys = data.get("keys") or {}
        if not endpoint.startswith("https://") or not keys.get("p256dh"):
            return jsonify({"error": "Invalid push subscription."}), 400
        stamp = datetime.now(timezone.utc).isoformat()
        store_db.save_push_subscription(
            g.db, endpoint, keys.get("p256dh"), keys.get("auth"),
            session.get("country", geo.DEFAULT_COUNTRY), stamp)
        return jsonify({"status": "ok"})

    @app.route("/api/push/unsubscribe", methods=["POST"])
    def push_unsubscribe():
        token = request.headers.get("X-CSRF-Token", "")
        if not security.validate_csrf_token(token):
            return jsonify({"error": "Invalid CSRF token."}), 403
        data = request.get_json(silent=True) or {}
        endpoint = data.get("endpoint") or ""
        if endpoint:
            store_db.delete_push_subscription(g.db, endpoint)
        return jsonify({"status": "ok"})

    # --- Admin (systems 7, 8, 12, 18) ---------------------------------------

    @app.route("/admin", methods=["GET"])
    def admin_login():
        if admin_auth.is_admin_logged_in():
            return redirect(url_for("admin_dashboard"))
        return render_template(
            "admin/login.html",
            not_configured=not admin_auth.admin_configured(),
            error=None, locked=False, lock_seconds=0,
        )

    @app.route("/admin/login", methods=["POST"])
    @security.rate_limit(security.admin_login_limiter,
                         lambda: geo.ip_hash(geo.client_ip(request)))
    @security.csrf_protect
    def admin_login_post():
        if not admin_auth.admin_configured():
            admin_auth.admin_abort_unconfigured()
        if admin_auth.is_locked(g.db):
            return render_template(
                "admin/login.html", not_configured=False,
                error=None, locked=True,
                lock_seconds=admin_auth.lock_remaining_seconds(g.db),
            )
        username = (request.form.get("username") or "").strip()
        password = request.form.get("password") or ""
        if (username == os.environ.get("ADMIN_USER")
                and admin_auth.verify_admin_password(password)):
            admin_auth.clear_failed_logins(g.db)
            session["admin_user"] = username
            session.permanent = bool(request.form.get("remember"))
            return redirect(url_for("admin_dashboard"))
        admin_auth.record_failed_login(
            g.db, geo.ip_hash(geo.client_ip(request)))
        return render_template(
            "admin/login.html", not_configured=False,
            error="Invalid username or password.",
            locked=False, lock_seconds=0,
        )

    @app.route("/logout", methods=["POST"])
    @security.csrf_protect
    def admin_logout():
        session.pop("admin_user", None)
        return redirect(url_for("index"))

    @app.route("/admin/dashboard", methods=["GET"])
    @admin_auth.login_required
    def admin_dashboard():
        products = store_db.get_all_products(g.db)
        return render_template(
            "admin/dashboard.html",
            backend=store_db.describe(),
            auth_mode=admin_auth.auth_mode(),
            product_count=len(products),
            total_clicks=store_db.total_clicks(g.db),
            per_product=store_db.clicks_per_product(g.db),
            errors=store_db.get_recent_errors(g.db, limit=20),
            error_count=store_db.get_error_count(g.db),
            confirmed_subs=store_db.count_subscribers(g.db, confirmed_only=True),
            pending_subs=(store_db.count_subscribers(g.db)
                          - store_db.count_subscribers(g.db, confirmed_only=True)),
            push_count=store_db.count_push_subscriptions(g.db),
            publishers=publisher_status(),
        )

    @app.route("/admin/analytics", methods=["GET"])
    @admin_auth.login_required
    def admin_analytics():
        return render_template(
            "admin/analytics.html",
            total_clicks=store_db.total_clicks(g.db),
            product_count=len(store_db.get_all_products(g.db)),
            per_product_day=store_db.clicks_per_product_day(g.db, days=30),
            per_day=store_db.clicks_per_day(g.db, days=30),
            countries=store_db.top_countries(g.db, limit=10),
        )

    @app.route("/admin/export/csv", methods=["GET"])
    @admin_auth.login_required
    def admin_export_csv():
        rows = g.db.execute(
            "SELECT created_at, product_id, ref, ip_hash, country "
            "FROM clicks ORDER BY created_at DESC"
        ).fetchall()
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(["created_at", "product_id", "ref", "ip_hash", "country"])
        for r in rows:
            writer.writerow([r["created_at"], r["product_id"], r["ref"] or "",
                             r["ip_hash"] or "", r["country"] or ""])
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
        resp = app.response_class(
            buf.getvalue(), mimetype="text/csv",
            headers={"Content-Disposition":
                     "attachment; filename=home-shopping-clicks-%s.csv" % stamp},
        )
        return resp

    @app.route("/admin/publish", methods=["GET"])
    @admin_auth.login_required
    def admin_publish():
        return render_template(
            "admin/publish.html", publishers=publisher_status(), result=None)

    @app.route("/admin/publish/run", methods=["POST"])
    @admin_auth.login_required
    @security.csrf_protect
    def admin_publish_run():
        name = (request.form.get("platform") or "").strip()
        title = (request.form.get("title") or "").strip()[:200]
        body = (request.form.get("body") or "").strip()
        image_url = (request.form.get("image_url") or "").strip()[:500] or None
        pub = get_publisher(name)
        if pub is None or not title or not body:
            result = {"platform": name or "?",
                      "status": "error",
                      "detail": "Choose a platform and fill in title and body."}
        else:
            result = pub.publish_draft(title, body, image_url=image_url,
                                       dry_run=True)
        return render_template(
            "admin/publish.html", publishers=publisher_status(),
            result=result)

    @app.errorhandler(404)
    def not_found(_err):
        return render_template("404.html"), 404

    @app.errorhandler(500)
    def server_error(err):
        try:
            conn = store_db.connect()
            try:
                store_db.log_error(conn, "error",
                                   "Unhandled 500: %s" % err,
                                   context=request.path)
            finally:
                conn.close()
        except Exception:
            pass
        return ("Something went wrong on our side. "
                "Please try again later."), 500

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
