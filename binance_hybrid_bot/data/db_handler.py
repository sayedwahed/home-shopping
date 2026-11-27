"""SQLite trade storage + state reconciliation helpers.

Every trade is stored with its unique clientOrderId, so a restart or
reconnect never loses track of open trades. `reconcile()` compares the
local open trades against the exchange's open orders/balances so the bot
never thinks a trade is still open after it was closed manually or by SL.
"""
import sqlite3
import json
import os


class DBHandler:
    def __init__(self, path="data/trades.db"):
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self._init()

    def _init(self):
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS trades (
                id TEXT PRIMARY KEY,
                symbol TEXT, side TEXT, qty REAL, entry REAL, stop REAL,
                strategy TEXT, status TEXT, exchange_order_id TEXT,
                pnl REAL DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                closed_at TIMESTAMP, extra TEXT
            )""")
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS daily_stats (
                day TEXT PRIMARY KEY, pnl REAL DEFAULT 0, trades INTEGER DEFAULT 0
            )""")
        self.conn.commit()

    def save_trade(self, record):
        self.conn.execute(
            """INSERT OR REPLACE INTO trades
               (id, symbol, side, qty, entry, stop, strategy, status, exchange_order_id, extra)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (record.get("id"), record.get("symbol"), record.get("side"),
             record.get("qty"), record.get("entry"), record.get("stop"),
             record.get("strategy"), record.get("status"),
             record.get("exchange_order_id"), json.dumps(record, default=str)))
        self.conn.commit()

    def update_trade(self, trade_id, status=None, pnl=None):
        if status is not None:
            self.conn.execute("UPDATE trades SET status=? WHERE id=?", (status, trade_id))
        if pnl is not None:
            self.conn.execute("UPDATE trades SET pnl=? WHERE id=?", (pnl, trade_id))
        if status == "closed":
            self.conn.execute("UPDATE trades SET closed_at=CURRENT_TIMESTAMP WHERE id=?", (trade_id,))
        self.conn.commit()

    def open_trades(self):
        rows = self.conn.execute("SELECT * FROM trades WHERE status IN ('open','dry_run')").fetchall()
        return [dict(r) for r in rows]

    def all_trades(self, limit=200):
        rows = self.conn.execute(
            "SELECT * FROM trades ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
        return [dict(r) for r in rows]

    def reconcile(self, exchange_open_order_ids):
        """Mark local 'open' trades as 'closed_external' if the exchange
        no longer has them open (closed manually / by SL / by TP)."""
        known = set(exchange_open_order_ids or [])
        changed = []
        for t in self.open_trades():
            ex_id = t.get("exchange_order_id")
            if ex_id and ex_id not in known:
                self.update_trade(t["id"], status="closed_external")
                changed.append(t["id"])
        return changed

    def close(self):
        self.conn.close()
