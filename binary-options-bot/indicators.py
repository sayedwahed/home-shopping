#!/usr/bin/env python3
"""
indicators.py — كل المؤشرات الفنية في مكان واحد (بايثون صافي، من غير مكتبات خارجية)
All technical indicators in one place (pure Python, no external libraries).

المؤشرات:
  EMA(9/21/50) — المتوسط المتحرك الأسي
  RSI(14) — مؤشر القوة النسبية (Wilder)
  Stochastic(14,3,3) — %K و %D
  MACD(12,26,9) — الخط والماكد والإشارة والهيستوجرام
  Bollinger Bands(20, 2) — الحد العلوي/الوسط/السفلي
  Alligator — فك/أسنان/شفاه بيل ويليامز (SMMA 13/8/5)
  ATR(14) — متوسط المدى الحقيقي (لقياس التذبذب، بيستخدمه فلتر السوق العرضي)

كل الدوال بتاخد list من أسعار الإغلاق (closes) وترجّع آخر قيمة،
ما عدا ema_series اللي بترجّع السلسلة كلها.
شغّل الملف ده لوحده عشان تشوف اختبارات بسيطة:
  python indicators.py
"""
import math


# ---------------------------------------------------------------------------
# أدوات مساعدة
# ---------------------------------------------------------------------------
def _sma(values, period):
    if len(values) < period:
        return None
    return sum(values[-period:]) / period


def _smma(values, period):
    """Smoothed Moving Average — المتوسط الممهّد (بيستخدمه Alligator)."""
    if len(values) < period:
        return None
    result = sum(values[:period]) / period
    for price in values[period:]:
        result = (result * (period - 1) + price) / period
    return result


def _stddev(values, period):
    if len(values) < period:
        return None
    window = values[-period:]
    mean = sum(window) / period
    return math.sqrt(sum((x - mean) ** 2 for x in window) / period)


# ---------------------------------------------------------------------------
# EMA
# ---------------------------------------------------------------------------
def ema_series(values, period):
    """سلسلة EMA كاملة (None لو البيانات أقل من الفترة)."""
    if len(values) < period:
        return [None] * len(values)
    k = 2 / (period + 1)
    out = [None] * (period - 1)
    current = sum(values[:period]) / period
    out.append(current)
    for price in values[period:]:
        current = price * k + current * (1 - k)
        out.append(current)
    return out


def ema(values, period):
    """آخر قيمة EMA."""
    series = ema_series(values, period)
    return series[-1] if series else None


# ---------------------------------------------------------------------------
# RSI (Wilder)
# ---------------------------------------------------------------------------
def rsi(values, period=14):
    if len(values) < period + 1:
        return None
    gains, losses = [], []
    for i in range(1, period + 1):
        change = values[i] - values[i - 1]
        gains.append(max(change, 0.0))
        losses.append(max(-change, 0.0))
    avg_gain = sum(gains) / period
    avg_loss = sum(losses) / period
    for i in range(period + 1, len(values)):
        change = values[i] - values[i - 1]
        avg_gain = (avg_gain * (period - 1) + max(change, 0.0)) / period
        avg_loss = (avg_loss * (period - 1) + max(-change, 0.0)) / period
    if avg_loss == 0:
        return 100.0
    return 100 - (100 / (1 + avg_gain / avg_loss))


# ---------------------------------------------------------------------------
# Stochastic (14, 3, 3) — بيحتاج high/low/close، فالدالة بتاخد الشموع كاملة
# ---------------------------------------------------------------------------
def stochastic(candles, k_period=14, d_period=3):
    """
    candles: list of dicts {'high','low','close'} أو list of [o,h,l,c].
    ترجّع (k, d) آخر قيمة، أو (None, None).
    """
    def _hlc(c):
        if isinstance(c, dict):
            return c["high"], c["low"], c["close"]
        return c[1], c[2], c[3]

    if len(candles) < k_period + d_period:
        return None, None
    k_values = []
    for i in range(k_period - 1, len(candles)):
        window = candles[i - k_period + 1: i + 1]
        highest = max(_hlc(c)[0] for c in window)
        lowest = min(_hlc(c)[1] for c in window)
        close = _hlc(candles[i])[2]
        k_values.append(0.0 if highest == lowest else 100 * (close - lowest) / (highest - lowest))
    if len(k_values) < d_period:
        return k_values[-1], None
    d = sum(k_values[-d_period:]) / d_period
    return k_values[-1], d


def stochastic_from_closes(closes, k_period=14, d_period=3):
    """نسخة مبسطة من Stochastic بتعتبر الإغلاق هو high/low (لما مفيش غير الإغلاق)."""
    if len(closes) < k_period + d_period:
        return None, None
    fake = [{"high": c, "low": c, "close": c} for c in closes]
    # high/low من الإغلاق بس مش دقيقة — عشان كده بنستخدم نطاق متحرك:
    k_values = []
    for i in range(k_period - 1, len(closes)):
        window = closes[i - k_period + 1: i + 1]
        highest, lowest = max(window), min(window)
        k_values.append(0.0 if highest == lowest else 100 * (closes[i] - lowest) / (highest - lowest))
    d = sum(k_values[-d_period:]) / d_period
    return k_values[-1], d


# ---------------------------------------------------------------------------
# MACD (12, 26, 9)
# ---------------------------------------------------------------------------
def macd(values, fast=12, slow=26, signal_period=9):
    """ترجّع dict فيه macd_line و signal و histogram، أو None لو البيانات قليلة."""
    if len(values) < slow + signal_period:
        return None
    fast_e = ema_series(values, fast)
    slow_e = ema_series(values, slow)
    macd_line = []
    for f, s in zip(fast_e, slow_e):
        macd_line.append(None if f is None or s is None else f - s)
    clean = [x for x in macd_line if x is not None]
    if len(clean) < signal_period:
        return None
    signal = ema(clean, signal_period)
    line = clean[-1]
    return {"macd": line, "signal": signal, "histogram": line - signal}


# ---------------------------------------------------------------------------
# Bollinger Bands (20, 2)
# ---------------------------------------------------------------------------
def bollinger(values, period=20, std_mult=2.0):
    """ترجّع dict فيه upper و middle و lower و bandwidth (نسبة مئوية)."""
    middle = _sma(values, period)
    sd = _stddev(values, period)
    if middle is None or sd is None:
        return None
    upper, lower = middle + std_mult * sd, middle - std_mult * sd
    bandwidth = 0.0 if middle == 0 else (upper - lower) / middle * 100
    return {"upper": upper, "middle": middle, "lower": lower, "bandwidth": bandwidth}


# ---------------------------------------------------------------------------
# Alligator (Bill Williams) — SMMA: Jaw 13 (shift 8), Teeth 8 (shift 5), Lips 5 (shift 3)
# (الـ shift للإشارة المتقدمة؛ هنا بنحسب القيمة الحالية من غير إزاحة للتبسيط)
# ---------------------------------------------------------------------------
def alligator(values):
    """ترجّع dict فيه jaw و teeth و lips، أو None لو البيانات قليلة."""
    if len(values) < 13:
        return None
    return {
        "jaw": _smma(values, 13),    # الفك — الأبطأ
        "teeth": _smma(values, 8),   # الأسنان
        "lips": _smma(values, 5),    # الشفاه — الأسرع
    }


# ---------------------------------------------------------------------------
# ATR — لقياس التذبذب
# ---------------------------------------------------------------------------
def atr(candles, period=14):
    """متوسط المدى الحقيقي كنسبة مئوية من السعر. candles زي stochastic."""
    def _hlc(c):
        if isinstance(c, dict):
            return c["high"], c["low"], c["close"]
        return c[1], c[2], c[3]

    if len(candles) < period + 1:
        return None
    trs = []
    for i in range(1, len(candles)):
        high, low, _ = _hlc(candles[i])
        prev_close = _hlc(candles[i - 1])[2]
        trs.append(max(high - low, abs(high - prev_close), abs(low - prev_close)))
    if len(trs) < period:
        return None
    avg_tr = sum(trs[-period:]) / period
    price = _hlc(candles[-1])[2]
    return avg_tr / price * 100 if price else None


# ---------------------------------------------------------------------------
# compute_all — كل المؤشرات مرة واحدة من أسعار الإغلاق
# ---------------------------------------------------------------------------
def compute_all(closes, candles=None):
    """
    ترجّع dict بآخر قيمة لكل مؤشر.
    candles اختياري (لـ Stochastic و ATR الدقيقين)؛ لو مش موجود بنستخدم الإغلاق بس.
    """
    source = candles if candles else [{"high": c, "low": c, "close": c} for c in closes]
    stoch_k, stoch_d = stochastic(source)
    macd_v = macd(closes)
    bb = bollinger(closes)
    gator = alligator(closes)
    return {
        "close": closes[-1] if closes else None,
        "ema9": ema(closes, 9),
        "ema21": ema(closes, 21),
        "ema50": ema(closes, 50),
        "rsi": rsi(closes, 14),
        "stoch_k": stoch_k,
        "stoch_d": stoch_d,
        "macd": macd_v["macd"] if macd_v else None,
        "macd_signal": macd_v["signal"] if macd_v else None,
        "macd_hist": macd_v["histogram"] if macd_v else None,
        "bb_upper": bb["upper"] if bb else None,
        "bb_middle": bb["middle"] if bb else None,
        "bb_lower": bb["lower"] if bb else None,
        "bb_bandwidth": bb["bandwidth"] if bb else None,
        "gator_jaw": gator["jaw"] if gator else None,
        "gator_teeth": gator["teeth"] if gator else None,
        "gator_lips": gator["lips"] if gator else None,
        "atr_pct": atr(source),
    }


# ---------------------------------------------------------------------------
# اختبارات بسيطة — شغّل: python indicators.py
# ---------------------------------------------------------------------------
def _run_tests():
    print("اختبارات indicators.py ...")
    # 1) EMA: سلسلة ثابتة لازم EMA بتاعها يساوي نفس القيمة
    flat = [100.0] * 60
    assert ema(flat, 9) == 100.0, "EMA of flat series"
    # 2) EMA: سلسلة صاعدة لازم EMA9 > EMA21 > EMA50
    up = [100 + i * 0.5 for i in range(60)]
    assert ema(up, 9) > ema(up, 21) > ema(up, 50), "EMA ordering on uptrend"
    # 3) RSI: سلسلة صاعدة كلها لازم RSI عالي (>70)، وهابطة كلها RSI واطي (<30)
    assert rsi(up, 14) > 70, f"RSI uptrend {rsi(up, 14)}"
    down = [130 - i * 0.5 for i in range(60)]
    assert rsi(down, 14) < 30, f"RSI downtrend {rsi(down, 14)}"
    # 4) Stochastic: إغلاق عند أعلى النطاق لازم %K عالي
    candles = [{"high": 110, "low": 100, "close": 109} for _ in range(20)]
    k, d = stochastic(candles)
    assert k is not None and k > 80, f"Stoch K {k}"
    # 5) MACD: سلسلة صاعدة لازم MACD موجب
    m = macd(up)
    assert m and m["macd"] > 0, f"MACD {m}"
    # 6) Bollinger: السعر لازم يكون جوّه النطاق في سلسلة ثابتة، والـ bandwidth صفر
    bb = bollinger(flat)
    assert bb and bb["bandwidth"] == 0.0, f"BB {bb}"
    # 7) Alligator: في ترند صاعد لازم lips > teeth > jaw
    g = alligator(up)
    assert g and g["lips"] > g["teeth"] > g["jaw"], f"Alligator {g}"
    # 8) compute_all بيرجّع كل المفاتيح
    all_v = compute_all(up)
    assert all_v["ema9"] is not None and all_v["rsi"] is not None and all_v["macd"] is not None
    # 9) بيانات قليلة بترجّع None من غير ما تضرب
    assert ema([1, 2, 3], 9) is None and rsi([1, 2, 3]) is None
    print("كل الاختبارات نجحت ✅ — EMA/RSI/Stochastic/MACD/Bollinger/Alligator شغالين.")
    print("مثال على ترند صاعد:", {k: (round(v, 3) if isinstance(v, float) else v) for k, v in all_v.items()})


if __name__ == "__main__":
    _run_tests()
