"""Hybrid strategy engine.

- Trending market -> Trend Following: EMA fast/slow cross, EMA200 filter,
  pullback entry with RSI, ATR-based exit.
- Ranging market -> Mean Reversion: Bollinger Bands + RSI oversold/overbought.
- Spot: BUY/LONG only. Futures: + SHORT.
"""
from dataclasses import dataclass
import pandas as pd
import ta


@dataclass
class Signal:
    side: str = None          # 'long' | 'short' | None
    strategy: str = ""        # 'trend' | 'mean_reversion'
    reason: str = ""
    stop_pct: float = 0.0     # stop distance as % of entry
    atr: float = 0.0


def add_strategy_indicators(df):
    df = df.copy()
    df["ema9"] = ta.trend.EMAIndicator(df["close"], window=9).ema_indicator()
    df["ema21"] = ta.trend.EMAIndicator(df["close"], window=21).ema_indicator()
    df["ema50"] = ta.trend.EMAIndicator(df["close"], window=50).ema_indicator()
    df["ema200"] = ta.trend.EMAIndicator(df["close"], window=200).ema_indicator()
    df["rsi"] = ta.momentum.RSIIndicator(df["close"], window=14).rsi()
    bb = ta.volatility.BollingerBands(df["close"], window=20, window_dev=2)
    df["bb_upper"] = bb.bollinger_hband()
    df["bb_lower"] = bb.bollinger_lband()
    df["bb_mid"] = bb.bollinger_mavg()
    df["atr"] = ta.volatility.AverageTrueRange(df["high"], df["low"], df["close"], window=14).average_true_range()
    return df


class HybridStrategy:
    def __init__(self, mode="spot"):
        self.mode = mode

    def decide(self, df, regime):
        """df must already have strategy indicators. Returns a Signal."""
        if len(df) < 210:
            return Signal(reason=f"بيانات مش كفاية ({len(df)} شمعة، محتاج 210)")
        last = df.iloc[-1]
        prev = df.iloc[-2]
        close = float(last["close"])
        rsi = float(last["rsi"])
        atr = float(last["atr"])
        stop_pct = (atr * 1.5 / close * 100) if close else 0.0

        if regime == "trend":
            return self._trend(df, last, prev, close, rsi, atr, stop_pct)
        if regime == "range":
            return self._mean_reversion(df, last, prev, close, rsi, atr, stop_pct)
        return Signal(reason=f"سوق محايد (لا اتجاهي ولا عرضي واضح) — انتظار")

    def _trend(self, df, last, prev, close, rsi, atr, stop_pct):
        ema9, ema21, ema200 = float(last["ema9"]), float(last["ema21"]), float(last["ema200"])
        cross_up = prev["ema9"] <= prev["ema21"] and ema9 > ema21
        cross_down = prev["ema9"] >= prev["ema21"] and ema9 < ema21
        # LONG: cross up, price above EMA200, pullback RSI 40-60
        if cross_up and close > ema200 and 40 <= rsi <= 65:
            return Signal("long", "trend", f"EMA9 قطع EMA21 لفوق + فوق EMA200 + RSI {rsi:.0f}", stop_pct, atr)
        if self.mode == "futures" and cross_down and close < ema200 and 35 <= rsi <= 60:
            return Signal("short", "trend", f"EMA9 قطع EMA21 لتحت + تحت EMA200 + RSI {rsi:.0f}", stop_pct, atr)
        # Trend continuation: already aligned, pullback to EMA21
        if ema9 > ema21 and close > ema200 and abs(close - ema21) / close < 0.005 and 40 <= rsi <= 60:
            return Signal("long", "trend", f"استمرار ترند صاعد + ارتداد من EMA21 + RSI {rsi:.0f}", stop_pct, atr)
        return Signal(reason=f"ترند: مفيش إشارة (EMA9 {ema9:.2f} / EMA21 {ema21:.2f} / RSI {rsi:.0f})")

    def _mean_reversion(self, df, last, prev, close, rsi, atr, stop_pct):
        bb_l, bb_u = float(last["bb_lower"]), float(last["bb_upper"])
        if close <= bb_l * 1.005 and rsi < 35:
            return Signal("long", "mean_reversion",
                          f"لمس Bollinger السفلي + RSI تشبع بيع {rsi:.0f}", stop_pct, atr)
        if self.mode == "futures" and close >= bb_u * 0.995 and rsi > 65:
            return Signal("short", "mean_reversion",
                          f"لمس Bollinger العلوي + RSI تشبع شراء {rsi:.0f}", stop_pct, atr)
        return Signal(reason=f"عرضي: مفيش إشارة (سعر {close:.2f} / BB {bb_l:.2f}-{bb_u:.2f} / RSI {rsi:.0f})")
