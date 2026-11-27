#!/usr/bin/env python3
"""
filters.py — الفلاتر اللي بتتفحص قبل أي دخول (قبل ما البوت يضغط أي زر)
Pre-entry filters — checked before any trade is placed.

الفلاتر:
  1) trend_filter     — فلتر الترند: الدخول مع الترند بس، مش عكسه
  2) payout_filter    — فلتر العائد: مفيش دخول لو العائد < 85%
  3) sideways_filter  — فلتر السوق العرضي / التذبذب المنخفض: مفيش دخول في السوق النايم أو المتذبذب
  4) time_filter      — فلتر الوقت: دخول في ساعات التداول المسموحة بس
  5) best_asset_filter — فلتر اختيار أفضل أصل من كذا أصل مرشح

كل فلتر بيرجّع (passed: bool, reason: str).
apply_filters() بتجمعهم كلهم: لو أي فلتر رفض، مفيش دخول.
"""
from datetime import datetime

from indicators import bollinger, ema


# ---------------------------------------------------------------------------
# 1) فلتر الترند — الدخول مع الترند بس
# ---------------------------------------------------------------------------
def trend_filter(closes, direction):
    """
    الاتجاه المطلوب لازم يكون مع الترند (EMA9/EMA21/EMA50).
    بيرجّع (True, ...) لو الاتجاه مع الترند، و(False, ...) لو عكسه.
    """
    if len(closes) < 50:
        return False, "بيانات مش كفاية لفلتر الترند"
    e9, e21, e50 = ema(closes, 9), ema(closes, 21), ema(closes, 50)
    if direction == "CALL":
        if e9 > e21 > e50:
            return True, "ترند صاعد واضح (EMA9 > EMA21 > EMA50)"
        return False, "الاتجاه CALL عكس الترند — الفلتر رفض"
    if direction == "PUT":
        if e9 < e21 < e50:
            return True, "ترند هابط واضح (EMA9 < EMA21 < EMA50)"
        return False, "الاتجاه PUT عكس الترند — الفلتر رفض"
    return False, "مفيش اتجاه أصلاً"


# ---------------------------------------------------------------------------
# 2) فلتر العائد — مفيش دخول لو العائد أقل من الحد الأدنى (افتراضي 85%)
# ---------------------------------------------------------------------------
def payout_filter(payout, min_payout=0.85):
    """
    payout: نسبة العائد ككسر عشري (0.92 = 92%) أو كنسبة مئوية (92).
    """
    if payout is None:
        return False, "العائد مش معروف — الفلتر رفض (مش هندخل على عماية)"
    value = payout / 100 if payout > 1 else payout
    breakeven = 100 / (1 + value)
    if value >= min_payout:
        return True, f"العائد {value:.0%} — نقطة التعادل {breakeven:.1f}% فوز"
    return False, f"العائد {value:.0%} أقل من الحد الأدنى {min_payout:.0%} — نقطة التعادل {breakeven:.1f}% عالية أوي"


# ---------------------------------------------------------------------------
# 3) فلتر السوق العرضي / التذبذب المنخفض
# ---------------------------------------------------------------------------
def sideways_filter(closes):
    """
    بيرفض الدخول لو السوق عرضي أو نايم:
    - خطوط EMA التلاتة قريبة من بعض (مفيش ترند)
    - Bollinger bandwidth ضيق جداً (تذبذب منخفض)
    """
    if len(closes) < 50:
        return False, "بيانات مش كفاية لفلتر السوق العرضي"
    e9, e21, e50 = ema(closes, 9), ema(closes, 21), ema(closes, 50)
    price = closes[-1]
    spread = (max(e9, e21, e50) - min(e9, e21, e50)) / price * 100 if price else 0
    bb = bollinger(closes)
    bandwidth = bb["bandwidth"] if bb else 0
    # الخطوط قريبة من بعض (أقل من 0.05% فرق) = سوق عرضي
    if spread < 0.05:
        return False, f"سوق عرضي: خطوط EMA متقاربة (فرق {spread:.3f}%) — الفلتر رفض"
    # نطاق بولينجر ضيق جداً (أقل من 0.10%) = تذبذب منخفض
    if bandwidth < 0.10:
        return False, f"تذبذب منخفض: Bollinger bandwidth {bandwidth:.3f}% — الفلتر رفض"
    return True, f"السوق متحرك: فرق EMA {spread:.3f}%، Bollinger bandwidth {bandwidth:.3f}%"


# ---------------------------------------------------------------------------
# 4) فلتر الوقت
# ---------------------------------------------------------------------------
def time_filter(now=None, allowed_hours=None, blocked_hours=None):
    """
    allowed_hours: set/list بالساعات المسموحة (0-23) — لو None يبقى كل الساعات مسموحة.
    blocked_hours: ساعات ممنوعة (مثلاً أول ساعة في السوق أو آخر الليل).
    """
    now = now or datetime.now()
    hour = now.hour
    if blocked_hours and hour in blocked_hours:
        return False, f"الساعة {hour}:00 ممنوعة حسب فلتر الوقت"
    if allowed_hours is not None and hour not in allowed_hours:
        return False, f"الساعة {hour}:00 برّه ساعات التداول المسموحة {sorted(allowed_hours)}"
    return True, f"الساعة {hour}:00 ضمن ساعات التداول"


# ---------------------------------------------------------------------------
# 5) فلتر اختيار أفضل أصل
# ---------------------------------------------------------------------------
def best_asset_filter(candidates):
    """
    candidates: dict {symbol: closes} — لكل أصل مرشح.
    بيرتّب الأصول بقوة الترند: فرق EMA9 عن EMA50 + اتساق الاتجاه،
    ويرجّع (best_symbol, ranking) أو (None, []) لو مفيش أصل صالح.
    """
    ranking = []
    for symbol, closes in candidates.items():
        if not closes or len(closes) < 50:
            continue
        e9, e21, e50 = ema(closes, 9), ema(closes, 21), ema(closes, 50)
        price = closes[-1]
        if not price:
            continue
        trend_strength = abs(e9 - e50) / price * 100
        aligned = 1 if (e9 > e21 > e50 or e9 < e21 < e50) else 0
        score = trend_strength * 10 + aligned
        ranking.append((symbol, round(score, 3), round(trend_strength, 4)))
    ranking.sort(key=lambda x: x[1], reverse=True)
    if not ranking:
        return None, []
    return ranking[0][0], ranking


# ---------------------------------------------------------------------------
# تجميع الفلاتر — apply_filters
# ---------------------------------------------------------------------------
def apply_filters(closes, direction, payout, now=None, allowed_hours=None,
                  blocked_hours=None, min_payout=0.85):
    """
    بيشغّل كل الفلاتر على إشارة واحدة.
    بيرجّع (allowed: bool, failed: [أسماء الفلاتر اللي رفضت], details: {اسم: سبب}).
    """
    checks = {
        "trend": trend_filter(closes, direction),
        "payout": payout_filter(payout, min_payout),
        "sideways": sideways_filter(closes),
        "time": time_filter(now, allowed_hours, blocked_hours),
    }
    failed = [name for name, (ok, _) in checks.items() if not ok]
    details = {name: reason for name, (_, reason) in checks.items()}
    return len(failed) == 0, failed, details


if __name__ == "__main__":
    up = [100 + i * 0.5 for i in range(80)]
    flat = [100.0 + (0.01 if i % 2 else -0.01) for i in range(80)]
    print("--- ترند صاعد + CALL ---")
    print("  trend:", trend_filter(up, "CALL"))
    print("  payout 92%:", payout_filter(0.92))
    print("  payout 70%:", payout_filter(0.70))
    print("  sideways:", sideways_filter(up))
    print("  apply_filters:", apply_filters(up, "CALL", 0.92))
    print("--- سوق عرضي (flat) ---")
    print("  sideways:", sideways_filter(flat))
    print("  apply_filters:", apply_filters(flat, "CALL", 0.92))
    print("--- أفضل أصل ---")
    print("  best:", best_asset_filter({"EURUSD": up, "GBPUSD": flat, "USDJPY": [50 + i * 0.1 for i in range(80)]}))
    print("\nاختبار filters.py خلص ✅")
