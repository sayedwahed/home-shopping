#!/usr/bin/env python3
"""
signals.py — أداة مساعدة: مولّد إشارات من مصدر أسعار عام (من غير أي اتصال بمنصة تداول)
Helper tool: signal generator from a public price source. No platform connection,
no login, no session token, no API key.

مصدر الأسعار: Yahoo Finance (yfinance) — بيانات سوق عامة، من غير حساب.
الأصل الافتراضي EURUSD=X (زوج حقيقي). أصول OTC بتاعة المنصات مش موجودة
في أي مصدر عام، فالإشارات دي للأزواج الحقيقية في ساعات السوق.

الاستخدام:
  python signals.py                      # إشارات حية كل دقيقة (Ctrl+C للإيقاف)
  python signals.py --once               # فحص مرة واحدة ويخرج
  python signals.py --symbol GBPUSD=X --strategy trend_ema_rsi
  python signals.py --csv candles.csv    # إشارات من ملف CSV فيه عمود close
  python signals.py --synthetic-demo     # بيانات تجريبية للتجربة بس (مش سوق حقيقي)

كل إشارة بتتسجل في signals.csv: الوقت، الأصل، الاتجاه، سعر الدخول، مدة الصفقة،
الاستراتيجية، المؤشرات اللي وافقت، ونتيجتها (بتتحسم على الشمعة اللي بعدها).
"""
import argparse
import csv
import random
import sys
import time
from datetime import datetime
from pathlib import Path

import config
from indicators import compute_all
from strategies import evaluate, list_strategies

SIGNALS_FILE = Path("signals.csv")
SIGNALS_HEADER = [
    "time", "symbol", "direction", "entry_price", "expiry",
    "strategy", "votes", "reason", "result", "exit_price",
]


def log_signal(row):
    exists = SIGNALS_FILE.exists()
    with SIGNALS_FILE.open("a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=SIGNALS_HEADER)
        if not exists:
            writer.writeheader()
        writer.writerow(row)


def load_csv(path):
    closes = []
    with Path(path).open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        col = next((c for c in reader.fieldnames if c.strip().lower() in ("close", "price")), None)
        if col is None:
            raise ValueError(f"مش لاقي عمود close. الأعمدة: {reader.fieldnames}")
        for row in reader:
            try:
                closes.append(float(row[col]))
            except (TypeError, ValueError):
                continue
    return closes


def synthetic_closes(n=300, seed=42):
    rng = random.Random(seed)
    price, closes = 1.0850, []
    for _ in range(n):
        price += rng.gauss(0, 0.0004)
        closes.append(round(price, 5))
    return closes


def fetch_closes_yfinance(symbol, period="1d", interval="1m"):
    """يجيب أسعار الإغلاق من Yahoo Finance. بيرجّع list فاضي لو فشل."""
    try:
        import yfinance as yf
    except ImportError:
        print("مكتبة yfinance مش متسطّبة. شغّل:  pip install -r requirements.txt", file=sys.stderr)
        return []
    try:
        df = yf.download(symbol, period=period, interval=interval, progress=False, auto_adjust=False)
        if df is None or df.empty:
            return []
        close_col = df["Close"]
        # yfinance أحياناً بيرجّع DataFrame بعمود واحد متعدد المستويات
        if hasattr(close_col, "columns"):
            close_col = close_col.iloc[:, 0]
        return [float(x) for x in close_col.dropna().tolist()]
    except Exception as exc:  # noqa: BLE001 - أي فشل في الشبكة لازم يتسجّل ومايوقّفش الأداة
        print(f"فشل جلب الأسعار من Yahoo Finance: {exc}", file=sys.stderr)
        return []


def format_signal(closes, symbol, strategy_name, expiry):
    """يقيّم الاستراتيجية على آخر الشموع ويرجّع dict الإشارة أو None."""
    res = evaluate(strategy_name, closes)
    if res is None or res["direction"] is None:
        return None
    ind = compute_all(closes)
    return {
        "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "symbol": symbol,
        "direction": res["direction"],
        "entry_price": closes[-1],
        "expiry": expiry,
        "strategy": strategy_name,
        "votes": ",".join(res["votes"]),
        "reason": res["reason"],
        "result": "pending",
        "exit_price": "",
        "rsi": round(ind["rsi"], 1) if ind["rsi"] is not None else "",
    }


def resolve_pending(pending, exit_price):
    """يحسم إشارة معلّقة بسعر الإغلاق الجديد."""
    if pending is None:
        return None
    direction = pending["direction"]
    entry = pending["entry_price"]
    if exit_price == entry:
        pending["result"] = "draw"
    elif (direction == "CALL" and exit_price > entry) or (direction == "PUT" and exit_price < entry):
        pending["result"] = "win"
    else:
        pending["result"] = "loss"
    pending["exit_price"] = exit_price
    log_signal({k: pending.get(k, "") for k in SIGNALS_HEADER})
    print(f"  نتيجة الإشارة السابقة: {pending['result']} (دخول {entry} -> خروج {exit_price})")
    return pending["result"]


def main():
    parser = argparse.ArgumentParser(description="Live signals from public market data (no platform connection)")
    parser.add_argument("--symbol", default=config.SYMBOL, help="رمز Yahoo Finance (افتراضي EURUSD=X)")
    parser.add_argument("--strategy", default=config.STRATEGY, choices=list_strategies())
    parser.add_argument("--expiry", type=int, default=config.EXPIRY)
    parser.add_argument("--once", action="store_true", help="فحص مرة واحدة ويخرج")
    parser.add_argument("--csv", help="ملف CSV فيه عمود close بدل الأسعار الحية")
    parser.add_argument("--synthetic-demo", action="store_true", help="بيانات تجريبية للتجربة بس")
    args = parser.parse_args()

    if args.strategy not in list_strategies():
        print(f"استراتيجية مش معروفة: {args.strategy}. المتاح: {list_strategies()}", file=sys.stderr)
        return 1

    # --- وضع ملف CSV / بيانات تجريبية: فحص مرة واحدة ---
    if args.csv or args.synthetic_demo:
        closes = load_csv(args.csv) if args.csv else synthetic_closes()
        source = f"ملف {args.csv}" if args.csv else "بيانات تجريبية (مش سوق حقيقي)"
        print(f"المصدر: {source} | الاستراتيجية: {args.strategy} | عدد الشموع: {len(closes)}")
        signal = format_signal(closes, args.symbol, args.strategy, args.expiry)
        if signal is None:
            print("مفيش إشارة دلوقتي.")
            return 0
        print(f"إشارة: {signal['direction']} على {signal['symbol']} بسعر {signal['entry_price']} "
              f"| مدة {signal['expiry']}ث | استراتيجية {signal['strategy']} "
              f"| وافقت: {signal['votes']} | RSI {signal['rsi']}")
        print("دي إشارة بس — التنفيذ يدوي من عندك في المنصة (على الديمو).")
        return 0

    # --- وضع حي: Yahoo Finance ---
    print(f"إشارات حية: {args.symbol} | استراتيجية: {args.strategy} | مدة الصفقة: {args.expiry}ث")
    print("المصدر: Yahoo Finance (عام، من غير حساب). دوس Ctrl+C للإيقاف.")
    print("الإشارات بتتسجل في signals.csv — وانت بتنفذها يدوياً في المنصة على الديمو.")
    last_key = None
    pending = None
    wins = losses = 0
    while True:
        closes = fetch_closes_yfinance(args.symbol)
        if len(closes) < 60:
            print("بيانات مش كفاية أو فشل الجلب — هحاول تاني بعد 30 ثانية...")
            if args.once:
                return 1
            time.sleep(30)
            continue
        key = closes[-1]
        # اشتغل بس على شمعة جديدة (سعر إغلاق اتغيّر)
        if key != last_key:
            last_key = key
            if pending is not None:
                result = resolve_pending(pending, closes[-1])
                pending = None
                if result == "win":
                    wins += 1
                elif result == "loss":
                    losses += 1
            signal = format_signal(closes, args.symbol, args.strategy, args.expiry)
            ind = compute_all(closes)
            print(f"[{datetime.now().strftime('%H:%M:%S')}] سعر {closes[-1]} | "
                  f"RSI {ind['rsi']:.1f}" if ind["rsi"] is not None else "", end="")
            if signal is None:
                print(" | مفيش إشارة.")
            else:
                print(f"\n  >>> إشارة: {signal['direction']} | دخول فوري | مدة {signal['expiry']}ث "
                      f"| استراتيجية {signal['strategy']} | وافقت: {signal['votes']}")
                print(f"      {signal['reason']}")
                pending = signal
            print(f"  (نتائج الإشارات اللي اتحسمت: فوز {wins} — خسارة {losses})")
        if args.once:
            return 0
        time.sleep(config.POLL_SECONDS)


if __name__ == "__main__":
    raise SystemExit(main())
