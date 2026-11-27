"""Market filters — one independent check per coin.

Uses pandas + `ta` (NOT pandas-ta, which is unmaintained).
Every filter returns a pass/fail + reason, so the log always says
WHY a trade was skipped instead of going silent.
"""
from dataclasses import dataclass
import pandas as pd
import ta


@dataclass
class FilterResult:
    passed: bool
    regime: str = "unknown"   # 'trend' | 'range' | 'unknown'
    adx: float = 0.0
    atr_pct: float = 0.0
    spread_pct: float = 0.0
    volume_ok: bool = False
    reasons: list = None

    def __post_init__(self):
        if self.reasons is None:
            self.reasons = []


def ohlcv_to_df(ohlcv):
    df = pd.DataFrame(ohlcv, columns=["ts", "open", "high", "low", "close", "volume"])
    df["ts"] = pd.to_datetime(df["ts"], unit="ms")
    return df


def add_indicators(df):
    df = df.copy()
    df["adx"] = ta.trend.ADXIndicator(df["high"], df["low"], df["close"], window=14).adx()
    df["atr"] = ta.volatility.AverageTrueRange(df["high"], df["low"], df["close"], window=14).average_true_range()
    df["vol_sma20"] = df["volume"].rolling(20).mean()
    df["atr_pct"] = df["atr"] / df["close"] * 100
    return df


class MarketFilters:
    def __init__(self, params, mode="spot"):
        self.p = params
        self.mode = mode

    def evaluate(self, df, ticker, order_book, btc_1h_change_pct=None,
                 symbol="", side="long", on_cooldown=False):
        """Run all filters. `side` is 'long' or 'short'."""
        reasons = []
        last = df.iloc[-1]
        adx = float(last["adx"]) if pd.notna(last["adx"]) else 0.0
        atr_pct = float(last["atr_pct"]) if pd.notna(last["atr_pct"]) else 0.0
        vol_ok = bool(last["volume"] > last["vol_sma20"]) if pd.notna(last["vol_sma20"]) else False

        # regime
        if adx > self.p.adx_threshold:
            regime = "trend"
        elif adx < self.p.adx_range_max:
            regime = "range"
        else:
            regime = "neutral"

        # spread
        bid = float(order_book["bids"][0][0]) if order_book.get("bids") else 0.0
        ask = float(order_book["asks"][0][0]) if order_book.get("asks") else 0.0
        spread_pct = (ask - bid) / bid * 100 if bid else 999.0

        # volume
        if not vol_ok:
            reasons.append(f"حجم أقل من SMA20 ({last['volume']:.1f} <= {last['vol_sma20']:.1f})")
        # ATR
        if atr_pct < self.p.atr_min_pct:
            reasons.append(f"ATR% منخفض جداً {atr_pct:.2f}% < {self.p.atr_min_pct}% (تذبذب ميت)")
        if atr_pct > self.p.atr_max_pct:
            reasons.append(f"ATR% عنيف {atr_pct:.2f}% > {self.p.atr_max_pct}%")
        # spread
        if spread_pct > self.p.max_spread_pct:
            reasons.append(f"سبريد {spread_pct:.3f}% > {self.p.max_spread_pct}%")
        # cooldown
        if on_cooldown:
            reasons.append("فترة تبريد بعد صفقة خاسرة")
        # BTC drop filter — LONG on altcoins only; disabled for BTC itself
        # and for SHORT in futures.
        if (side == "long" and symbol != "BTC/USDT" and self.mode == "spot"
                and btc_1h_change_pct is not None
                and btc_1h_change_pct <= -self.p.btc_drop_filter_pct):
            reasons.append(f"BTC هابط {btc_1h_change_pct:.2f}% في آخر ساعة — ممنوع LONG على العملات")
        if (side == "long" and symbol != "BTC/USDT" and self.mode == "futures"
                and btc_1h_change_pct is not None
                and btc_1h_change_pct <= -self.p.btc_drop_filter_pct):
            reasons.append(f"BTC هابط {btc_1h_change_pct:.2f}% في آخر ساعة — ممنوع LONG على العملات")

        return FilterResult(
            passed=len(reasons) == 0,
            regime=regime,
            adx=adx,
            atr_pct=atr_pct,
            spread_pct=spread_pct,
            volume_ok=vol_ok,
            reasons=reasons,
        )
