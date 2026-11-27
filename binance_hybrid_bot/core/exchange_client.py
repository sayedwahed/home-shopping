"""Exchange client — ccxt Binance wrapper.

- Public market data works WITHOUT keys.
- Trading needs keys from .env only (never hardcoded).
- Testnet via ccxt set_sandbox_mode(True). Default: testnet + dry-run.
- No live trading unless the caller explicitly confirms it.
"""
import time
import ccxt


class ExchangeClient:
    def __init__(self, settings, logger=None):
        self.settings = settings
        self.log = logger
        self.exchange = None
        self._connect()

    def _connect(self):
        opts = {"enableRateLimit": True}
        if self.settings.api_key and self.settings.api_secret:
            opts["apiKey"] = self.settings.api_key
            opts["secret"] = self.settings.api_secret
        ex_class = ccxt.binanceusdm if self.settings.trading_mode == "futures" else ccxt.binance
        self.exchange = ex_class(opts)
        if self.settings.env == "testnet":
            self.exchange.set_sandbox_mode(True)
        self.exchange.load_markets()

    def _log(self, msg):
        if self.log:
            self.log.info(msg)

    # ---- public data (no keys needed) ----
    def fetch_ohlcv(self, symbol, timeframe=None, limit=200):
        tf = timeframe or self.settings.timeframe
        return self.exchange.fetch_ohlcv(symbol, tf, limit=limit)

    def fetch_ticker(self, symbol):
        return self.exchange.fetch_ticker(symbol)

    def fetch_order_book(self, symbol, limit=5):
        return self.exchange.fetch_order_book(symbol, limit)

    def market(self, symbol):
        return self.exchange.market(symbol)

    # ---- account (keys needed) ----
    def fetch_balance(self):
        return self.exchange.fetch_balance()

    def fetch_open_orders(self, symbol=None):
        return self.exchange.fetch_open_orders(symbol)

    def fetch_my_trades(self, symbol, limit=50):
        return self.exchange.fetch_my_trades(symbol, limit=limit)

    def fetch_position(self, symbol):
        if self.settings.trading_mode != "futures":
            return None
        positions = self.exchange.fetch_positions([symbol])
        for p in positions or []:
            if p.get("symbol") == symbol and float(p.get("contracts") or 0) != 0:
                return p
        return None

    # ---- orders (keys needed) ----
    def create_order(self, symbol, side, amount, order_type="market", price=None, params=None):
        return self.exchange.create_order(symbol, order_type, side, amount, price, params or {})

    def create_stop_market(self, symbol, side, amount, stop_price):
        """Server-side STOP_MARKET — mandatory in futures, used as SL everywhere."""
        params = {"stopPrice": stop_price}
        if self.settings.trading_mode == "futures":
            params["reduceOnly"] = True
        return self.exchange.create_order(symbol, "STOP_MARKET", side, amount, None, params)

    def set_leverage(self, symbol, leverage):
        if self.settings.trading_mode == "futures":
            return self.exchange.set_leverage(leverage, symbol)
        return None

    def set_margin_mode(self, symbol, mode="isolated"):
        if self.settings.trading_mode == "futures":
            try:
                return self.exchange.set_margin_mode(mode, symbol)
            except Exception as e:  # already isolated / not supported on testnet pair
                self._log(f"set_margin_mode skipped for {symbol}: {e}")
        return None

    def reconnect(self, tries=3):
        for i in range(tries):
            try:
                self._connect()
                return True
            except Exception as e:
                self._log(f"reconnect attempt {i + 1} failed: {e}")
                time.sleep(2 ** i)
        return False
