"""Database layer for Home Shopping (Flask store) — dual backend.

Postgres-first (Render + free Neon Postgres): when the DATABASE_URL
environment variable is set, every query goes through psycopg2 to
Postgres. Otherwise the local SQLite file is used: data/store.db for
local development, or /tmp/store.db on Vercel (env VERCEL=1), because
Vercel's filesystem is read-only except /tmp. The rest of the app
(app.py, seed.py, scripts/refresh_prices.py) uses this module only,
so it never has to know which backend is active.

Tables (system 2 of the spec):
  products  - the catalog. Only products seeded from data/products.json
              (the owner's own AliExpress affiliate links) ever exist here.
  clicks    - one row per explicit "Continue to AliExpress" press on the
              /go/<id> page. Stores an IP *hash*, never the full IP.
  settings  - simple key/value store.

Every table has created_at / updated_at. Indexes exist on the columns the
storefront queries (category, price, created_at, product_id).

Dialect differences handled here (callers always write SQLite-style SQL):
  - placeholders: ``?`` (positional) and ``:name`` (named) are translated
    to psycopg2's ``%s`` / ``%(name)s`` on Postgres.
  - ``INTEGER PRIMARY KEY AUTOINCREMENT`` (SQLite) becomes
    ``BIGSERIAL PRIMARY KEY`` on Postgres.
  - ``INSERT OR REPLACE`` (SQLite) becomes ``INSERT ... ON CONFLICT ...
    DO UPDATE`` on Postgres.
"""

import json
import os
import re
import sqlite3
import urllib.parse

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")


def _default_db_path():
    """SQLite file location for the fallback backend.

    An explicit STORE_DB_PATH always wins. On Vercel (env VERCEL=1)
    the deployment filesystem is read-only except /tmp, so the SQLite
    file must live in /tmp — writing to data/store.db there would fail.
    Local runs keep data/store.db exactly as before.
    """
    explicit = os.environ.get("STORE_DB_PATH")
    if explicit:
        return explicit
    if os.environ.get("VERCEL") == "1":
        return os.path.join("/tmp", "store.db")
    return os.path.join(DATA_DIR, "store.db")


DB_PATH = _default_db_path()
DATABASE_URL = os.environ.get("DATABASE_URL") or ""
SEED_PATH = os.path.join(DATA_DIR, "products.json")

USE_POSTGRES = bool(DATABASE_URL)


def backend():
    """'postgres' when DATABASE_URL is set, otherwise 'sqlite'."""
    return "postgres" if USE_POSTGRES else "sqlite"


def describe():
    """Human-readable backend description (never includes credentials)."""
    if USE_POSTGRES:
        parsed = urllib.parse.urlparse(DATABASE_URL)
        host = parsed.hostname or "?"
        dbname = (parsed.path or "").lstrip("/") or "?"
        return f"Postgres ({host}/{dbname})"
    return f"SQLite ({DB_PATH})"


def _schema_sql(postgres):
    """Schema, equivalent on both backends (same columns, same indexes)."""
    clicks_id = (
        "BIGSERIAL PRIMARY KEY" if postgres
        else "INTEGER PRIMARY KEY AUTOINCREMENT"
    )
    return """
CREATE TABLE IF NOT EXISTS products (
    id                  TEXT PRIMARY KEY,
    title               TEXT NOT NULL,
    title_ar            TEXT,
    description         TEXT,
    category            TEXT NOT NULL,
    price_usd           REAL NOT NULL,
    old_price_usd       REAL,
    currency            TEXT NOT NULL DEFAULT 'USD',
    image_url           TEXT,
    affiliate_url       TEXT NOT NULL,
    aliexpress_item_id  TEXT,
    rating              REAL,
    reviews             TEXT,
    discount_percent    INTEGER,
    clicks              INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_price ON products(price_usd);
CREATE INDEX IF NOT EXISTS idx_products_created ON products(created_at);
CREATE INDEX IF NOT EXISTS idx_products_discount ON products(discount_percent);

CREATE TABLE IF NOT EXISTS clicks (
    id          %s,
    product_id  TEXT NOT NULL,
    ref         TEXT,
    ip_hash     TEXT,
    country     TEXT,
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clicks_product ON clicks(product_id);
CREATE INDEX IF NOT EXISTS idx_clicks_created ON clicks(created_at);

CREATE TABLE IF NOT EXISTS settings (
    key         TEXT PRIMARY KEY,
    value       TEXT,
    updated_at  TEXT NOT NULL
);
""" % clicks_id


class Connection:
    """Thin wrapper making sqlite3 and psycopg2 look identical.

    Exposes .execute(sql, params=None) -> cursor with .fetchone() /
    .fetchall(), .executescript(sql), .commit(), .close(). Rows support
    access by column name (row["title"]) on both backends.
    """

    def __init__(self, raw, postgres):
        self._raw = raw
        self.postgres = postgres

    def _adapt(self, sql, params):
        """Translate SQLite-style placeholders to psycopg2 style."""
        if not self.postgres:
            return sql, params
        if isinstance(params, dict):
            sql = re.sub(r":([A-Za-z_][A-Za-z0-9_]*)", r"%(\1)s", sql)
        elif params is not None:
            sql = sql.replace("?", "%s")
        return sql, params

    def execute(self, sql, params=None):
        sql, params = self._adapt(sql, params)
        if self.postgres:
            cur = self._raw.cursor()
            cur.execute(sql, params)
            return cur
        if params is None:
            return self._raw.execute(sql)
        return self._raw.execute(sql, params)

    def executescript(self, sql):
        if self.postgres:
            cur = self._raw.cursor()
            for stmt in sql.split(";"):
                if stmt.strip():
                    cur.execute(stmt)
            return cur
        return self._raw.executescript(sql)

    def commit(self):
        return self._raw.commit()

    def close(self):
        return self._raw.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


def connect(db_path=DB_PATH):
    """Open a connection to the active backend.

    Postgres when DATABASE_URL is set (db_path is ignored), otherwise
    the local SQLite file. Rows are accessible by column name.
    """
    if USE_POSTGRES:
        import psycopg2
        from psycopg2.extras import RealDictCursor

        raw = psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)
        return Connection(raw, postgres=True)
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    raw = sqlite3.connect(db_path)
    raw.row_factory = sqlite3.Row
    return Connection(raw, postgres=False)


def init_db(db_path=DB_PATH):
    """Create all tables and indexes (safe to run repeatedly)."""
    conn = connect(db_path)
    try:
        conn.executescript(_schema_sql(conn.postgres))
        conn.commit()
    finally:
        conn.close()


def seed_from_json(seed_path=SEED_PATH, db_path=DB_PATH, stamp="2026-11-28T00:00:00Z"):
    """Seed products from products.json.

    Idempotent: re-running updates the product fields but preserves the
    existing clicks count and original created_at. Products that are in
    the DB but no longer in products.json are left untouched (never
    auto-deleted); only the owner edits products.json.
    Returns (inserted, updated) counts.
    """
    with open(seed_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    init_db(db_path)
    conn = connect(db_path)
    inserted = updated = 0
    try:
        for p in data.get("products", []):
            row = conn.execute(
                "SELECT id FROM products WHERE id = ?", (p["id"],)
            ).fetchone()
            values = {
                "id": p["id"],
                "title": p.get("name_en") or p.get("name"),
                "title_ar": p.get("name"),
                "description": p.get("description_en") or p.get("description", ""),
                "category": p.get("category_en") or p.get("category", ""),
                "price_usd": p.get("price_usd"),
                "old_price_usd": p.get("old_price_usd"),
                "currency": "USD",
                "image_url": p.get("image"),
                "affiliate_url": p.get("affiliate_link"),
                "aliexpress_item_id": p.get("aliexpress_item_id"),
                "rating": p.get("rating"),
                "reviews": p.get("sales_note_en") or p.get("sales_note"),
                "discount_percent": p.get("discount_percent"),
            }
            if row is None:
                conn.execute(
                    """INSERT INTO products
                       (id, title, title_ar, description, category, price_usd,
                        old_price_usd, currency, image_url, affiliate_url,
                        aliexpress_item_id, rating, reviews, discount_percent,
                        clicks, created_at, updated_at)
                       VALUES (:id, :title, :title_ar, :description, :category,
                        :price_usd, :old_price_usd, :currency, :image_url,
                        :affiliate_url, :aliexpress_item_id, :rating, :reviews,
                        :discount_percent, 0, :stamp, :stamp)""",
                    {**values, "stamp": stamp},
                )
                inserted += 1
            else:
                conn.execute(
                    """UPDATE products SET
                           title=:title, title_ar=:title_ar,
                           description=:description, category=:category,
                           price_usd=:price_usd, old_price_usd=:old_price_usd,
                           currency=:currency, image_url=:image_url,
                           affiliate_url=:affiliate_url,
                           aliexpress_item_id=:aliexpress_item_id,
                           rating=:rating, reviews=:reviews,
                           discount_percent=:discount_percent,
                           updated_at=:stamp
                       WHERE id=:id""",
                    {**values, "stamp": stamp},
                )
                updated += 1
        set_setting(conn, "seed_source", "data/products.json", stamp)
        conn.commit()
    finally:
        conn.close()
    return inserted, updated


def get_all_products(conn, q=None, category=None, sort="featured", max_price=None):
    """Storefront catalog query: search, category filter, sort, max price.

    sort: featured (default order) | newest | discount | price-asc | price-desc
    """
    sql = "SELECT * FROM products WHERE 1=1"
    params = []
    if q:
        sql += " AND (title LIKE ? OR description LIKE ? OR category LIKE ?)"
        like = "%" + q + "%"
        params += [like, like, like]
    if category and category != "all":
        sql += " AND category = ?"
        params.append(category)
    if max_price is not None:
        sql += " AND price_usd <= ?"
        params.append(max_price)

    order = {
        "newest": "created_at DESC, id ASC",
        "discount": "discount_percent DESC, id ASC",
        "price-asc": "price_usd ASC",
        "price-desc": "price_usd DESC",
    }.get(sort, "created_at DESC, id ASC")
    sql += " ORDER BY " + order
    return conn.execute(sql, params).fetchall()


def get_product(conn, product_id):
    return conn.execute(
        "SELECT * FROM products WHERE id = ?", (product_id,)
    ).fetchone()


def get_categories(conn):
    rows = conn.execute(
        "SELECT DISTINCT category FROM products ORDER BY category"
    ).fetchall()
    return [r["category"] for r in rows]


def record_click(conn, product_id, ref, ip_hash, country, stamp):
    """Record one explicit outbound click and bump the product counter."""
    conn.execute(
        "INSERT INTO clicks (product_id, ref, ip_hash, country, created_at) "
        "VALUES (?, ?, ?, ?, ?)",
        (product_id, ref, ip_hash, country, stamp),
    )
    conn.execute(
        "UPDATE products SET clicks = clicks + 1, updated_at = ? WHERE id = ?",
        (stamp, product_id),
    )
    conn.commit()


def get_setting(conn, key, default=None):
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(conn, key, value, stamp):
    if conn.postgres:
        conn.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "
            "updated_at = EXCLUDED.updated_at",
            (key, value, stamp),
        )
    else:
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value, updated_at) "
            "VALUES (?, ?, ?)",
            (key, value, stamp),
        )
    conn.commit()
