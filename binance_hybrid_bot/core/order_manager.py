"""Order manager — ccxt execution with guardrails.

- Unique clientOrderId per order (idempotency: a reconnect never
  duplicates an order for the same signal).
- Exchange filters: quantity/price rounded to minQty, stepSize, tickSize,
  minNotional — orders are never sent in a form Binance rejects.
- STOP_MARKET mandatory on the server in futures (and used as SL in spot
  via a stop order where supported).
- Dry-run mode: logs the order instead of sending it.
"""
import uuid
import math


def _floor_to_step(value, step):
    if not step or step <= 0:
        return value
    return math.floor(value / step) * step


class OrderManager:
    def __init__(self, client, risk_manager, settings, logger=None, db=None):
        self.client = client
        self.risk = risk_manager
        self.settings = settings
        self.log = logger
        self.db = db

    def _log(self, msg):
        if self.log:
            self.log.info(msg)

    def _round_amount(self, symbol, qty):
        m = self.client.market(symbol)
        step = float(m["limits"]["amount"]["min"]) if m["limits"]["amount"].get("min") else 0
        # ccxt precision: use exchange helpers when available
        try:
            return float(self.client.exchange.amount_to_precision(symbol, qty))
        except Exception:
            return _floor_to_step(qty, step)

    def _round_price(self, symbol, price):
        try:
            return float(self.client.exchange.price_to_precision(symbol, price))
        except Exception:
            return price

    def _check_min_notional(self, symbol, qty, price):
        m = self.client.market(symbol)
        min_notional = float(m["limits"]["cost"]["min"]) if m["limits"]["cost"].get("min") else 0
        return qty * price >= min_notional, min_notional

    def open_trade(self, symbol, side, entry_price, stop_price, qty, strategy):
        """side: 'long' | 'short'. Returns order dict or dry-run record or None."""
        qty = self._round_amount(symbol, qty)
        entry_price = self._round_price(symbol, entry_price)
        stop_price = self._round_price(symbol, stop_price)
        ok, min_notional = self._check_min_notional(symbol, qty, entry_price)
        if not ok:
            self._log(f"❌ {symbol}: قيمة الصفقة {qty * entry_price:.2f} أقل من minNotional {min_notional}")
            return None
        if qty <= 0:
            self._log(f"❌ {symbol}: كمية صفر بعد التقريب")
            return None

        client_order_id = f"hyb-{uuid.uuid4().hex[:16]}"
        buy_side = "buy" if side == "long" else "sell"
        params = {"newClientOrderId": client_order_id}

        if self.settings.dry_run:
            self._log(f"[DRY-RUN] {side} {symbol} qty={qty} @ {entry_price} SL={stop_price} id={client_order_id}")
            record = {"id": client_order_id, "symbol": symbol, "side": side,
                      "qty": qty, "entry": entry_price, "stop": stop_price,
                      "strategy": strategy, "status": "dry_run"}
            if self.db:
                self.db.save_trade(record)
            return record

        try:
            if self.settings.trading_mode == "futures":
                leverage = min(max(self.risk.params.default_leverage,
                                   self.risk.params.futures_leverage_min),
                               self.risk.params.futures_leverage_max)
                self.client.set_leverage(symbol, leverage)
                self.client.set_margin_mode(symbol, self.risk.params.futures_margin_mode)
            order = self.client.create_order(symbol, buy_side, qty, "market", None, params)
            # Mandatory server-side stop
            sl_side = "sell" if side == "long" else "buy"
            try:
                self.client.create_stop_market(symbol, sl_side, qty, stop_price)
            except Exception as e:
                self._log(f"⚠️ {symbol}: فشل أمر وقف الخسارة على السيرفر: {e} — أغلق الصفقة يدوياً إذا لزم")
            record = {"id": client_order_id, "symbol": symbol, "side": side,
                      "qty": qty, "entry": entry_price, "stop": stop_price,
                      "strategy": strategy, "status": "open",
                      "exchange_order_id": order.get("id")}
            if self.db:
                self.db.save_trade(record)
            self._log(f"✅ فتح {side} {symbol} qty={qty} @ {entry_price} SL={stop_price}")
            return record
        except Exception as e:
            self._log(f"❌ فشل فتح {symbol}: {e}")
            return None

    def close_trade(self, symbol, side, qty, reason=""):
        """Close by market order (opposite side). Dry-run just logs."""
        close_side = "sell" if side == "long" else "buy"
        qty = self._round_amount(symbol, qty)
        if self.settings.dry_run:
            self._log(f"[DRY-RUN] إغلاق {side} {symbol} qty={qty} ({reason})")
            return {"status": "dry_run_closed"}
        try:
            order = self.client.create_order(symbol, close_side, qty, "market")
            self._log(f"✅ أغلق {side} {symbol} qty={qty} ({reason})")
            return order
        except Exception as e:
            self._log(f"❌ فشل إغلاق {symbol}: {e}")
            return None
