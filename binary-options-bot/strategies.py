#!/usr/bin/env python3
"""
strategies.py — محرك الاستراتيجيات (قابلة للتبديل من config.py)
Strategy engine — switchable from config.py (STRATEGY setting).

كل استراتيجية بتاخد أسعار الإغلاق (closes) وشموع كاملة اختيارية (candles)،
وترجّع dict:
  {
    "direction": "CALL" | "PUT" | None,
    "votes": ["EMA", "RSI", ...],   # المؤشرات اللي وافقت على الاتجاه ده
    "reason": "شرح قصير بالعربي",
  }

الاستراتيجيات:
  1) trend_ema_rsi      — ترند: EMA9/EMA21 + RSI
  2) reversal_rsi_stoch — انعكاس: RSI متطرف + Stochastic متقاطع
  3) pullback           — ترند + ارتداد: EMA50 ترند، و RSI/Stoch بيرجعوا من منطقة تشبع
  4) alligator_rsi      — Alligator + RSI
  5) confluence         — دخول بس لو 3 مؤشرات على الأقل اتفقوا على نفس الاتجاه

مفيش استراتيجية مضمونة — كلهم بيتقاسوا في backtest.py، واللي نسبة فوزه
تحت نقطة التعادل (~52% عند payout 92%) بيخسر على المدى الطويل.
"""
from indicators import compute_all

# أسماء الاستراتيجيات المتاحة (المفتاح هو اللي بيتكتب في config.py)
STRATEGIES = {}


def _register(name):
    def deco(fn):
        STRATEGIES[name] = fn
        return fn
    return deco


def _result(direction, votes, reason):
    return {"direction": direction, "votes": votes, "reason": reason}


# ---------------------------------------------------------------------------
# 1) ترند: EMA + RSI
# ---------------------------------------------------------------------------
@_register("trend_ema_rsi")
def trend_ema_rsi(closes, candles=None):
    ind = compute_all(closes, candles)
    if ind["ema9"] is None or ind["ema21"] is None or ind["rsi"] is None:
        return _result(None, [], "بيانات مش كفاية")
    if ind["rsi"] >= 70 or ind["rsi"] <= 30:
        return _result(None, [], f"RSI متطرف ({ind['rsi']:.0f}) — مفيش دخول")
    if ind["ema9"] > ind["ema21"] and ind["close"] > ind["ema9"] and ind["rsi"] < 65:
        return _result("CALL", ["EMA", "RSI"], "EMA9 فوق EMA21 والسعر فوق EMA9 و RSI تحت 65")
    if ind["ema9"] < ind["ema21"] and ind["close"] < ind["ema9"] and ind["rsi"] > 35:
        return _result("PUT", ["EMA", "RSI"], "EMA9 تحت EMA21 والسعر تحت EMA9 و RSI فوق 35")
    return _result(None, [], "مفيش ترند واضح")


# ---------------------------------------------------------------------------
# 2) انعكاس: RSI + Stochastic
# ---------------------------------------------------------------------------
@_register("reversal_rsi_stoch")
def reversal_rsi_stoch(closes, candles=None):
    ind = compute_all(closes, candles)
    if ind["rsi"] is None or ind["stoch_k"] is None or ind["stoch_d"] is None:
        return _result(None, [], "بيانات مش كفاية")
    # تشبع بيع + Stochastic طالع من تحت 20 = انعكاس لفوق
    if ind["rsi"] < 30 and ind["stoch_k"] < 20 and ind["stoch_k"] > ind["stoch_d"]:
        return _result("CALL", ["RSI", "Stochastic"], "RSI تحت 30 و Stochastic طالع من منطقة تشبع البيع")
    # تشبع شراء + Stochastic نازل من فوق 80 = انعكاس لتحت
    if ind["rsi"] > 70 and ind["stoch_k"] > 80 and ind["stoch_k"] < ind["stoch_d"]:
        return _result("PUT", ["RSI", "Stochastic"], "RSI فوق 70 و Stochastic نازل من منطقة تشبع الشراء")
    return _result(None, [], "مفيش منطقة انعكاس")


# ---------------------------------------------------------------------------
# 3) Pullback: ترند EMA50 + ارتداد RSI/Stochastic
# ---------------------------------------------------------------------------
@_register("pullback")
def pullback(closes, candles=None):
    ind = compute_all(closes, candles)
    if ind["ema50"] is None or ind["ema9"] is None or ind["rsi"] is None:
        return _result(None, [], "بيانات مش كفاية")
    # ترند صاعد (السعر فوق EMA50) + هبوط مؤقت: RSI نزل تحت 45 وبيرجع
    if ind["close"] > ind["ema50"] and ind["ema9"] > ind["ema50"] and 35 < ind["rsi"] < 50:
        return _result("CALL", ["EMA50", "RSI"], "ترند صاعد + RSI ارتد من منطقة منخفضة (Pullback)")
    # ترند هابط + صعود مؤقت
    if ind["close"] < ind["ema50"] and ind["ema9"] < ind["ema50"] and 50 < ind["rsi"] < 65:
        return _result("PUT", ["EMA50", "RSI"], "ترند هابط + RSI ارتد من منطقة مرتفعة (Pullback)")
    return _result(None, [], "مفيش Pullback واضح")


# ---------------------------------------------------------------------------
# 4) Alligator + RSI
# ---------------------------------------------------------------------------
@_register("alligator_rsi")
def alligator_rsi(closes, candles=None):
    ind = compute_all(closes, candles)
    if ind["gator_lips"] is None or ind["rsi"] is None:
        return _result(None, [], "بيانات مش كفاية")
    if ind["rsi"] >= 70 or ind["rsi"] <= 30:
        return _result(None, [], f"RSI متطرف ({ind['rsi']:.0f}) — مفيش دخول")
    # التمساح فاتح بقه لفوق: lips > teeth > jaw + السعر فوق الشفاه
    if ind["gator_lips"] > ind["gator_teeth"] > ind["gator_jaw"] and ind["close"] > ind["gator_lips"] and ind["rsi"] < 65:
        return _result("CALL", ["Alligator", "RSI"], "Alligator مرتب لفوق والسعر فوق الشفاه")
    if ind["gator_lips"] < ind["gator_teeth"] < ind["gator_jaw"] and ind["close"] < ind["gator_lips"] and ind["rsi"] > 35:
        return _result("PUT", ["Alligator", "RSI"], "Alligator مرتب لتحت والسعر تحت الشفاه")
    if ind["gator_lips"] > ind["gator_teeth"] > ind["gator_jaw"] or ind["gator_lips"] < ind["gator_teeth"] < ind["gator_jaw"]:
        return _result(None, [], "Alligator مرتب بس RSI مش مناسب للدخول")
    return _result(None, [], "التمساح نايم (الخطوط متشابكة) — مفيش دخول")


# ---------------------------------------------------------------------------
# 5) Confluence: دخول بس لو 3 مؤشرات على الأقل اتفقوا
# ---------------------------------------------------------------------------
def _votes_for(closes, candles=None):
    """بيحسب صوت كل مؤشر: +1 لـ CALL، -1 لـ PUT، 0 محايد."""
    ind = compute_all(closes, candles)
    votes = {}  # name -> +1 / -1 / 0
    if ind["ema9"] is not None and ind["ema21"] is not None:
        votes["EMA"] = 1 if ind["ema9"] > ind["ema21"] else (-1 if ind["ema9"] < ind["ema21"] else 0)
    if ind["rsi"] is not None:
        votes["RSI"] = 1 if ind["rsi"] < 45 else (-1 if ind["rsi"] > 55 else 0)
    if ind["stoch_k"] is not None and ind["stoch_d"] is not None:
        votes["Stochastic"] = 1 if ind["stoch_k"] > ind["stoch_d"] and ind["stoch_k"] < 80 else (
            -1 if ind["stoch_k"] < ind["stoch_d"] and ind["stoch_k"] > 20 else 0)
    if ind["macd_hist"] is not None:
        votes["MACD"] = 1 if ind["macd_hist"] > 0 else -1
    if ind["bb_upper"] is not None and ind["close"] is not None:
        # السعر قريب من الحد السفلي = فرصة شراء، قريب من العلوي = فرصة بيع
        votes["Bollinger"] = 1 if ind["close"] < ind["bb_middle"] else -1
    if ind["gator_lips"] is not None:
        votes["Alligator"] = 1 if ind["gator_lips"] > ind["gator_teeth"] > ind["gator_jaw"] else (
            -1 if ind["gator_lips"] < ind["gator_teeth"] < ind["gator_jaw"] else 0)
    return votes, ind


@_register("confluence")
def confluence(closes, candles=None, min_votes=3):
    votes, ind = _votes_for(closes, candles)
    call_votes = [name for name, v in votes.items() if v == 1]
    put_votes = [name for name, v in votes.items() if v == -1]
    if ind["rsi"] is not None and (ind["rsi"] >= 70 or ind["rsi"] <= 30):
        return _result(None, [], f"RSI متطرف ({ind['rsi']:.0f}) — Confluence بيرفض الدخول")
    if len(call_votes) >= min_votes and len(call_votes) > len(put_votes):
        return _result("CALL", call_votes, f"اتفاق {len(call_votes)} مؤشرات: {', '.join(call_votes)}")
    if len(put_votes) >= min_votes and len(put_votes) > len(call_votes):
        return _result("PUT", put_votes, f"اتفاق {len(put_votes)} مؤشرات: {', '.join(put_votes)}")
    return _result(None, [], f"مفيش اتفاق كافي (CALL: {len(call_votes)}، PUT: {len(put_votes)})")


# ---------------------------------------------------------------------------
# واجهة موحدة
# ---------------------------------------------------------------------------
def evaluate(strategy_name, closes, candles=None):
    """قيّم استراتيجية واحدة بالاسم. لو الاسم مش معروف، بيرجّع None."""
    fn = STRATEGIES.get(strategy_name)
    if fn is None:
        return None
    return fn(closes, candles)


def evaluate_all(closes, candles=None):
    """قيّم كل الاستراتيجيات مرة واحدة — بيرجّع dict بالاسم."""
    return {name: fn(closes, candles) for name, fn in STRATEGIES.items()}


def list_strategies():
    return sorted(STRATEGIES.keys())


if __name__ == "__main__":
    # اختبار سريع على ترند صاعد وهابط — random walk بانحراف (زي السوق الحقيقي،
    # مش خط مستقيم مثالي لأن الخط المثالي بيخلي RSI = 100 وكل الاستراتيجيات ترفض صح)
    import random
    rng = random.Random(7)
    up, price = [], 100.0
    for _ in range(80):
        price += 0.12 + rng.gauss(0, 0.5)
        up.append(round(price, 2))
    down, price = [], 140.0
    for _ in range(80):
        price += -0.12 + rng.gauss(0, 0.5)
        down.append(round(price, 2))
    print("الاستراتيجيات المتاحة:", list_strategies())
    for label, data in [("صاعد", up), ("هابط", down)]:
        print(f"\n--- ترند {label} ---")
        for name, res in evaluate_all(data).items():
            print(f"  {name:20s} -> {res['direction'] or 'مفيش':6s} | أصوات: {res['votes']} | {res['reason']}")
    print("\nاختبار strategies.py خلص ✅")
