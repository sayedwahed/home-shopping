#!/usr/bin/env python3
"""
backtest.py — مقارنة الاستراتيجيات على بيانات قديمة (من غير أي فلوس حقيقية)
Compare all strategies on historical data — no real money involved.

الاستخدام:
  python backtest.py                        # بيانات تجريبية (شموع مولّدة عشوائياً)
  python backtest.py --csv candles.csv     # ملف CSV فيه عمود close
  python backtest.py --csv candles.csv --stake 1 --payout 0.92
  python backtest.py --strategy confluence # استراتيجية واحدة بس

كل استراتيجية بتتقيّم شمعة شمعة، والإشارة بتتحسم على الشمعة اللي بعدها.
النتيجة: جدول مقارنة — عدد الصفقات، نسبة الفوز، صافي الربح لكل استراتيجية،
مقارنة بنقطة التعادل المطلوبة (100 / (1 + payout)).

⚠️ الباك-تست على بيانات مولّدة أو قديمة مش ضمان لأي نتيجة مستقبلية.
ولو نسبة فوز استراتيجية أقل من نقطة التعادل، هي بتخسر على المدى الطويل.
"""
import argparse
import csv
import random
import sys
from pathlib import Path

from strategies import STRATEGIES, list_strategies


def load_csv(path):
    closes = []
    with Path(path).open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames is None:
            raise ValueError("ملف CSV فاضي أو من غير هيدر.")
        col = next((c for c in reader.fieldnames if c.strip().lower() in ("close", "price")), None)
        if col is None:
            raise ValueError(f"مش لاقي عمود close في الملف. الأعمدة الموجودة: {reader.fieldnames}")
        for row in reader:
            try:
                closes.append(float(row[col]))
            except (TypeError, ValueError):
                continue
    return closes


def synthetic_closes(n=500, seed=42):
    """شموع تجريبية: random walk حوالين 1.0850 — للتجربة بس، مش بيانات حقيقية."""
    rng = random.Random(seed)
    price, closes = 1.0850, []
    for _ in range(n):
        price += rng.gauss(0, 0.0004)
        closes.append(round(price, 5))
    return closes


def run_strategy(name, closes, stake, payout):
    """شغّل استراتيجية واحدة على الشموع، ورجّع إحصائياتها."""
    fn = STRATEGIES[name]
    wins = losses = draws = 0
    profit = 0.0
    equity = [0.0]
    for i in range(60, len(closes) - 1):
        res = fn(closes[: i + 1])
        if res is None or res["direction"] is None:
            continue
        entry, exit_price = closes[i], closes[i + 1]
        if exit_price == entry:
            draws += 1
        elif (res["direction"] == "CALL" and exit_price > entry) or (res["direction"] == "PUT" and exit_price < entry):
            wins += 1
            profit += stake * payout
        else:
            losses += 1
            profit -= stake
        equity.append(profit)
    total = wins + losses + draws
    win_rate = (wins / total * 100) if total else 0.0
    max_dd, peak = 0.0, 0.0
    for value in equity:
        peak = max(peak, value)
        max_dd = max(max_dd, peak - value)
    return {
        "trades": total, "wins": wins, "losses": losses, "draws": draws,
        "win_rate": win_rate, "profit": profit, "max_drawdown": max_dd,
    }


def main():
    parser = argparse.ArgumentParser(description="Compare binary-options strategies (backtest)")
    parser.add_argument("--csv", help="ملف CSV فيه عمود close")
    parser.add_argument("--stake", type=float, default=1.0, help="مبلغ الصفقة (افتراضي 1)")
    parser.add_argument("--payout", type=float, default=0.92, help="نسبة الربح (افتراضي 0.92)")
    parser.add_argument("--strategy", choices=list_strategies(), help="استراتيجية واحدة بس (افتراضي: كلهم)")
    args = parser.parse_args()

    if args.csv:
        try:
            closes = load_csv(args.csv)
        except (OSError, ValueError) as exc:
            print(f"خطأ في قراءة الملف: {exc}", file=sys.stderr)
            return 1
        source = f"ملف {args.csv}"
    else:
        closes = synthetic_closes()
        source = "بيانات تجريبية مولّدة (seed=42) — مش بيانات سوق حقيقية"

    if len(closes) < 100:
        print("عدد الشموع قليل جداً (محتاج 100 على الأقل).", file=sys.stderr)
        return 1

    names = [args.strategy] if args.strategy else list_strategies()
    breakeven = 100 / (1 + args.payout)
    print("=" * 78)
    print(f"المصدر: {source} | عدد الشموع: {len(closes)} | مبلغ الصفقة: ${args.stake:.2f}")
    print(f"نقطة التعادل المطلوبة (payout {args.payout:.0%}): {breakeven:.1f}% فوز")
    print("=" * 78)
    print(f"{'الاستراتيجية':<22} {'صفقات':>7} {'فوز':>5} {'خسارة':>7} {'نسبة الفوز':>11} {'صافي الربح':>12}  الحكم")
    print("-" * 78)
    best = None
    for name in names:
        r = run_strategy(name, closes, args.stake, args.payout)
        verdict = "✅ فوق التعادل" if r["trades"] and r["win_rate"] >= breakeven else ("⚠️ تحت التعادل" if r["trades"] else "— مفيش إشارات")
        if r["trades"] and (best is None or r["win_rate"] > best[1]["win_rate"]):
            best = (name, r)
        print(f"{name:<22} {r['trades']:>7} {r['wins']:>5} {r['losses']:>7} {r['win_rate']:>10.1f}% "
              f"${r['profit']:>11.2f}  {verdict}  (أقصى تراجع ${r['max_drawdown']:.2f})")
    print("=" * 78)
    if best:
        print(f"أعلى نسبة فوز في البيانات دي: {best[0]} ({best[1]['win_rate']:.1f}%) — بس ده مش ضمان للمستقبل.")
    print("نصيحة: متشغّلش أي استراتيجية بفلوس حقيقية قبل ما تختبرها على الديمو أسابيع.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
