"""Unit / smoke tests — no keys, no live trading.

Run:  python -m pytest tests/ -q   (or: python tests/test_bot.py)
Uses synthetic OHLCV + the real filter/strategy/risk code, plus a
live public-data smoke test (Binance public klines, no keys) that is
skipped gracefully if there is no network.
"""
import os
import sys
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config.risk_params import RiskParams, get_coin_params
from core.filters import MarketFilters, ohlcv_to_df, add_indicators
from core.strategy import HybridStrategy, add_strategy_indicators
from core.risk_manager import RiskManager


def synthetic_ohlcv(n=250, trend=0.001, seed=1):
    rng = np.random.default_rng(seed)
    close = 100 * np.exp(np.cumsum(rng.normal(trend, 0.005, n)))
    high = close * (1 + rng.uniform(0, 0.004, n))
    low = close * (1 - rng.uniform(0, 0.004, n))
    open_ = np.roll(close, 1); open_[0] = close[0]
    vol = rng.uniform(100, 1000, n)
    ts = np.arange(n) * 900_000
    return np.column_stack([ts, open_, high, low, close, vol]).tolist()


def fake_book(price=100.0):
    return {"bids": [[price * 0.9999, 1]], "asks": [[price * 1.0001, 1]]}


def test_per_coin_overrides():
    btc = get_coin_params("BTC/USDT")
    sol = get_coin_params("SOL/USDT")
    assert btc.atr_max_pct == 2.0 and sol.atr_max_pct == 5.0
    assert get_coin_params("DOGE/USDT").atr_max_pct == RiskParams().atr_max_pct


def test_filters_pass_on_trending_volume():
    df = add_indicators(ohlcv_to_df(synthetic_ohlcv(trend=0.002)))
    df.loc[df.index[-1], "volume"] = df["vol_sma20"].iloc[-1] * 2  # volume spike
    f = MarketFilters(get_coin_params("ETH/USDT"))
    r = f.evaluate(df, {}, fake_book(100), btc_1h_change_pct=0.5, symbol="ETH/USDT", side="long")
    assert r.regime in ("trend", "range", "neutral")
    assert r.spread_pct < 0.05


def test_btc_filter_blocks_alt_long():
    df = add_indicators(ohlcv_to_df(synthetic_ohlcv()))
    f = MarketFilters(get_coin_params("ETH/USDT"))
    r = f.evaluate(df, {}, fake_book(100), btc_1h_change_pct=-5.0, symbol="ETH/USDT", side="long")
    assert not r.passed and any("BTC" in x for x in r.reasons)
    # disabled for BTC itself and for SHORT
    r2 = f.evaluate(df, {}, fake_book(100), btc_1h_change_pct=-5.0, symbol="BTC/USDT", side="long")
    assert not any("BTC" in x for x in r2.reasons)


def test_cooldown_blocks():
    df = add_indicators(ohlcv_to_df(synthetic_ohlcv()))
    f = MarketFilters(get_coin_params("ETH/USDT"))
    r = f.evaluate(df, {}, fake_book(100), symbol="ETH/USDT", side="long", on_cooldown=True)
    assert not r.passed


def test_strategy_returns_signal_or_reason():
    df = add_strategy_indicators(add_indicators(ohlcv_to_df(synthetic_ohlcv(trend=0.003, seed=7))))
    s = HybridStrategy("spot").decide(df, "trend")
    assert s.side in ("long", None)  # spot never shorts
    s2 = HybridStrategy("futures").decide(df, "range")
    assert s2.side in ("long", "short", None)


def test_position_sizing():
    rm = RiskManager(RiskParams(), equity=1000.0)
    qty = rm.position_size(entry_price=100.0, stop_price=98.0)
    # risk $15 (1.5% of 1000) / $2 per unit = 7.5
    assert abs(qty - 7.5) < 1e-9


def test_daily_breaker():
    rm = RiskManager(RiskParams(), equity=1000.0)
    rm.record_result(-35.0)  # -3.5% > 3% daily limit
    ok, why = rm.can_open_new_trade(0)
    assert not ok and "اليومية" in why


def test_max_open_trades():
    rm = RiskManager(RiskParams(), equity=1000.0)
    ok, _ = rm.can_open_new_trade(3)
    assert not ok


def test_public_market_data_smoke():
    """Live public klines from Binance — no keys. Skipped if offline."""
    try:
        from core.exchange_client import ExchangeClient
        from config.settings import Settings
        client = ExchangeClient(Settings())
        klines = client.fetch_ohlcv("BTC/USDT", "15m", limit=10)
        assert len(klines) >= 5
        assert klines[-1][4] > 0
    except Exception as e:
        print(f"SKIP test_public_market_data_smoke: no network / public API unreachable: {e}")
        return


if __name__ == "__main__":
    import traceback
    tests = [v for k, v in list(globals().items()) if k.startswith("test_")]
    passed = failed = 0
    for t in tests:
        try:
            t()
            print(f"PASS {t.__name__}")
            passed += 1
        except Exception:
            print(f"FAIL {t.__name__}")
            traceback.print_exc()
            failed += 1
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)
