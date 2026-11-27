#!/usr/bin/env python3
"""
bot_browser.py — البوت الرئيسي: تداول آلي على حساب Pocket Option التجريبي
عن طريق أتمتة المتصفح (Browser Automation) مثل الإنسان.
Main bot: automated trading on the Pocket Option DEMO account via browser
automation, like a human — no session token, no API, no login data.

إزاي بيشتغل:
  1) بيفتح متصفح Chrome حقيقي (Playwright) ببروفايل محلي على جهازك.
  2) انت بتسجّل دخولك بنفسك في المتصفح، وبتبدّل للرصيد التجريبي (Demo) بنفسك.
  3) البوت بيتأكد من نص الواجهة إن الحساب ديمو، وبيطلب تأكيدك في الطرفية قبل أول صفقة.
  4) القرار بيتاخد من محرك الاستراتيجيات (strategies.py) + الفلاتر (filters.py)
     على أسعار عامة من Yahoo Finance (من غير أي اتصال بالمنصة).
  5) التنفيذ = ضغطة زر CALL / PUT في واجهة الموقع بس، مع تأخيرات عشوائية تشبه الإنسان.
  6) كل صفقة بتتسجل في trades.csv: الاستراتيجية، المؤشرات اللي وافقت، الفلاتر، النتيجة.

التشغيل:
  python bot_browser.py              # وضع ورقي (DRY_RUN=True) — بيقولك كان هيضغط إيه من غير ما يضغط
  python bot_browser.py --live       # تنفيذ حقيقي على الديمو (بعد اختبار أسابيع)
  python bot_browser.py --once       # دورة قرار واحدة ويخرج (للتجربة)
  python bot_browser.py --strategy trend_ema_rsi --symbol GBPUSD=X

الإيقاف: دوس Ctrl+C، أو دوس زر STOP الأحمر اللي البوت بيحطه على الصفحة،
أو اعمل ملف فاضي اسمه stop.txt جنب البوت.

⚠️ تحذير صريح: أتمتة الواجهة دي برضه مخالفة لشروط استخدام Pocket Option،
وممكن تؤدي لحظر الحساب حتى على الديمو. ده للتعلم والتجربة على الديمو فقط،
وبمبالغ صغيرة جداً. مفيش أي ضمان ربح.
"""
import argparse
import csv
import random
import re
import sys
import time
from datetime import date, datetime
from pathlib import Path

import config
from filters import apply_filters
from indicators import compute_all
from signals import fetch_closes_yfinance
from strategies import evaluate, list_strategies

TRADES_FILE = Path("trades.csv")
TRADES_HEADER = [
    "date", "time", "asset", "direction", "stake", "expiry",
    "entry_price", "result", "profit", "mode", "strategy", "votes",
    "filters_passed", "payout", "rsi",
]
STOP_FILE = Path("stop.txt")


def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def human_delay(min_s=0.8, max_s=2.5):
    """تأخير عشوائي تشبه الإنسان قبل أي ضغطة."""
    delay = random.uniform(min_s, max_s)
    log(f"  ... انتظار {delay:.1f} ثانية (تأخير بشري)")
    time.sleep(delay)


def log_trade(row):
    exists = TRADES_FILE.exists()
    with TRADES_FILE.open("a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=TRADES_HEADER)
        if not exists:
            writer.writeheader()
        writer.writerow(row)
    log(f"  سُجّلت الصفقة: {row['direction']} | {row['strategy']} | "
        f"وافقت: {row['votes']} | النتيجة: {row['result']} | الربح: {row['profit']}")


# ---------------------------------------------------------------------------
# قراءة الواجهة — UI reading (best-effort: تصميم الموقع ممكن يتغيّر)
# ---------------------------------------------------------------------------
def inject_stop_button(page):
    """بيحط زر STOP أحمر على الصفحة — دوس عليه في أي وقت عشان البوت يوقف."""
    page.evaluate(
        """() => {
            if (document.getElementById('muse-stop-btn')) return;
            const b = document.createElement('button');
            b.id = 'muse-stop-btn';
            b.textContent = '⛔ STOP BOT';
            b.style.cssText = 'position:fixed;top:10px;right:10px;z-index:999999;'
                + 'background:#c0392b;color:#fff;font-size:16px;font-weight:bold;'
                + 'padding:10px 16px;border:none;border-radius:8px;cursor:pointer;';
            b.onclick = () => { window.__STOP_BOT__ = true; b.textContent = '⏹ STOPPED'; };
            document.body.appendChild(b);
        }"""
    )


def stop_requested(page=None):
    if STOP_FILE.exists():
        return True
    if page is not None:
        try:
            return bool(page.evaluate("() => !!window.__STOP_BOT__"))
        except Exception:
            return False
    return False


def page_text(page):
    try:
        return page.evaluate("() => document.body.innerText") or ""
    except Exception:
        return ""


def confirm_demo(page):
    """
    تأكيد الديمو من نص الواجهة: لازم كلمة Demo تكون ظاهرة في الصفحة.
    بيرجّع True لو لقاها، False لو مش لاقيها.
    """
    text = page_text(page)
    # كلمة Demo بتظهر جنب الرصيد في Pocket Option لما تكون على الحساب التجريبي
    return "Demo" in text or "demo" in text.lower()


def read_payout(page, fallback):
    """بيحاول يقرا نسبة العائد (%) من الواجهة. لو معرفش، بيرجّع القيمة الاحتياطية."""
    try:
        text = page_text(page)
        matches = re.findall(r"(\d{1,3})\s*%", text)
        values = [int(m) for m in matches if 50 <= int(m) <= 99]
        if values:
            return max(values) / 100
    except Exception:
        pass
    return fallback


def read_balance(page):
    """بيحاول يقرا الرصيد من الواجهة (أكبر مبلغ بالدولار ظاهر). بيرجّع None لو معرفش."""
    try:
        text = page_text(page)
        amounts = [float(a.replace(",", "")) for a in re.findall(r"\$\s*([\d,]+\.\d{2})", text)]
        return max(amounts) if amounts else None
    except Exception:
        return None


def click_direction(page, direction):
    """
    بيضغط زر CALL أو PUT في الواجهة — بيجرّب كذا محدد (selector) لأن تصميم
    الموقع ممكن يتغيّر. لو مفيش ولا واحد ظاهر، بيرجّع False (ومفيش صفقة).
    """
    label = "Call" if direction == "CALL" else "Put"
    attempts = [
        lambda: page.get_by_role("button", name=re.compile(label, re.I)).first,
        lambda: page.locator(f"button:has-text('{label}')").first,
        lambda: page.locator(f"text={label.upper()}").first,
    ]
    for get_locator in attempts:
        try:
            loc = get_locator()
            if loc.is_visible(timeout=3000):
                # حركة ماوس عشوائية قبل الضغطة — تشبه الإنسان
                box = loc.bounding_box()
                if box:
                    page.mouse.move(
                        box["x"] + random.uniform(2, box["width"] - 2),
                        box["y"] + random.uniform(2, box["height"] - 2),
                        steps=random.randint(3, 8),
                    )
                loc.click(timeout=5000)
                return True
        except Exception:
            continue
    return False


def set_amount(page, stake):
    """بيحاول يحط مبلغ الصفقة في خانة المبلغ. لو معرفش، بيرجّع False."""
    selectors = [
        "input[inputmode='decimal']",
        "input[type='number']",
        "input[placeholder*='$']",
    ]
    for sel in selectors:
        try:
            loc = page.locator(sel).first
            if loc.is_visible(timeout=2000):
                human_delay(0.5, 1.2)
                loc.click()
                loc.fill(str(stake))
                return True
        except Exception:
            continue
    log("  ⚠️ مش قادر ألاقي خانة المبلغ — هكمل بالمبلغ الافتراضي في الواجهة.")
    return False


# ---------------------------------------------------------------------------
# البوت
# ---------------------------------------------------------------------------
class BrowserBot:
    def __init__(self, args):
        self.strategy = args.strategy
        self.symbol = args.symbol
        self.dry_run = args.dry_run if args.dry_run is not None else config.DRY_RUN
        self.live = args.live
        if self.live:
            self.dry_run = False
        self.once = args.once
        self.trades_today = 0
        self.daily_profit = 0.0
        self.consecutive_losses = 0
        self.unknown_results = 0
        self.last_trade_time = 0.0
        self.last_close = None

    def limits_hit(self):
        if self.trades_today >= config.MAX_TRADES:
            log(f"وصلنا لأقصى عدد صفقات اليوم ({config.MAX_TRADES}) — إيقاف.")
            return True
        if self.daily_profit <= -config.DAILY_LOSS_LIMIT:
            log(f"وصلنا لحد الخسارة اليومية (${config.DAILY_LOSS_LIMIT:.2f}) — إيقاف.")
            return True
        if self.consecutive_losses >= config.MAX_CONSECUTIVE_LOSSES:
            log("3 خساير ورا بعض — إيقاف لحماية الحساب.")
            return True
        if self.unknown_results >= 3:
            log("3 نتائج مش معروفة ورا بعض — إيقاف عشان مش هندخل على عماية.")
            return True
        return False

    def record_result(self, result, profit):
        self.trades_today += 1
        self.daily_profit += profit
        if result == "win":
            self.consecutive_losses = 0
            self.unknown_results = 0
        elif result == "loss":
            self.consecutive_losses += 1
            self.unknown_results = 0
        elif result == "unknown":
            self.unknown_results += 1
        log(f"  اليوم: {self.trades_today} صفقات | صافي الربح التقديري: ${self.daily_profit:.2f} "
            f"| خساير متتالية: {self.consecutive_losses}")

    def run(self):
        log("=" * 65)
        log("بوت Pocket Option — أتمتة متصفح على حساب الديمو")
        log(f"الاستراتيجية: {self.strategy} | الأصل: {self.symbol} -> {config.ASSET_ON_POCKET}")
        log(f"مدة الصفقة: {config.EXPIRY}ث | المبلغ: ${config.STAKE}")
        if self.dry_run:
            log("الوضع الورقي DRY_RUN=True — مفيش أي ضغطة زر حقيقية هتحصل.")
        else:
            log("⚠️ وضع التنفيذ --live — البوت هيضغط CALL/PUT فعلاً في المتصفح!")
        log("=" * 65)

        if not self.dry_run and config.MARTINGALE:
            log("المارتينجال ممنوع — إيقاف.")
            return 1

        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            log("مكتبة Playwright مش متسطّبة. شغّل:")
            log("  pip install -r requirements.txt")
            log("  playwright install chromium")
            return 1

        with sync_playwright() as pw:
            log("بفتح Chrome ...")
            context = pw.chromium.launch_persistent_context(
                user_data_dir=config.USER_DATA_DIR,
                headless=config.HEADLESS,
                args=["--start-maximized"],
            )
            page = context.pages[0] if context.pages else context.new_page()
            page.goto(config.POCKET_URL)
            log("المتصفح اتفتح. سجّل دخولك بنفسك في Pocket Option، وبدّل للرصيد التجريبي (Demo).")
            log("البوت مش هيطلب منك أي بيانات دخول — انت اللي بتسجّل بنفسك.")
            input("لما تخلّص الدخول وتبقى على حساب الديمو، دوس Enter هنا ... ")

            # --- تأكيد الديمو من الواجهة + تأكيد يدوي ---
            if config.DEMO_ONLY and not confirm_demo(page):
                log("❌ مش لاقي كلمة Demo في الواجهة — ممكن تكون على حساب حقيقي. البوت وقف نفسه.")
                context.close()
                return 1
            log("✅ الواجهة بتقول إن الحساب ديمو.")
            if not self.dry_run:
                answer = input("تأكيد أخير: الحساب ده ديمو فعلاً؟ اكتب YES عشان نبدأ التنفيذ، أو أي حاجة تانية للإلغاء: ").strip()
                if answer != "YES":
                    log("اتلغى بطلب منك.")
                    context.close()
                    return 0

            inject_stop_button(page)
            log("زر STOP الأحمر اتحط على الصفحة — دوس عليه في أي وقت عشان توقف البوت.")
            log("البوت شغال... دوس Ctrl+C للإيقاف.")
            payout = read_payout(page, config.PAYOUT)
            log(f"نسبة العائد المقروءة من الواجهة: {payout:.0%} (نقطة التعادل {100 / (1 + payout):.1f}% فوز)")

            try:
                while True:
                    if stop_requested(page):
                        log("تم طلب الإيقاف (زر STOP أو ملف stop.txt).")
                        break
                    if self.limits_hit():
                        break

                    closes = fetch_closes_yfinance(self.symbol)
                    if len(closes) < 60:
                        log("بيانات مش كفاية من Yahoo Finance — هحاول تاني...")
                        time.sleep(config.POLL_SECONDS)
                        continue
                    if closes[-1] == self.last_close:
                        time.sleep(config.POLL_SECONDS)
                        continue
                    self.last_close = closes[-1]

                    # --- القرار: استراتيجية + فلاتر ---
                    res = evaluate(self.strategy, closes)
                    ind = compute_all(closes)
                    if res is None or res["direction"] is None:
                        log(f"سعر {closes[-1]} | RSI {ind['rsi']:.1f} | مفيش إشارة ({res['reason'] if res else ''})")
                        if self.once:
                            break
                        time.sleep(config.POLL_SECONDS)
                        continue

                    direction = res["direction"]
                    allowed, failed, details = apply_filters(
                        closes, direction, payout,
                        allowed_hours=config.ALLOWED_HOURS,
                        blocked_hours=config.BLOCKED_HOURS,
                        min_payout=config.MIN_PAYOUT,
                    )
                    log(f"إشارة: {direction} | استراتيجية {self.strategy} | وافقت: {', '.join(res['votes'])}")
                    log(f"  سبب الإشارة: {res['reason']}")
                    for name, reason in details.items():
                        log(f"  فلتر {name}: {'✅' if name not in failed else '❌'} {reason}")
                    if not allowed:
                        log(f"  الفلاتر رفضت الدخول ({', '.join(failed)}) — تخطّي الإشارة.")
                        if self.once:
                            break
                        time.sleep(config.POLL_SECONDS)
                        continue
                    if time.time() - self.last_trade_time < config.COOLDOWN_SECONDS:
                        log("  لسه في فترة التهدئة — تخطّي.")
                        if self.once:
                            break
                        time.sleep(config.POLL_SECONDS)
                        continue

                    self.last_trade_time = time.time()
                    base_row = {
                        "date": str(date.today()), "time": datetime.now().strftime("%H:%M:%S"),
                        "asset": config.ASSET_ON_POCKET, "direction": direction,
                        "stake": config.STAKE, "expiry": config.EXPIRY,
                        "entry_price": closes[-1], "result": "", "profit": 0.0,
                        "mode": "DRY_RUN" if self.dry_run else "REAL-DEMO",
                        "strategy": self.strategy, "votes": ",".join(res["votes"]),
                        "filters_passed": "yes", "payout": payout,
                        "rsi": round(ind["rsi"], 1) if ind["rsi"] is not None else "",
                    }

                    if self.dry_run:
                        log(f"  [ورقي] كان هيدخل {direction} بسعر {closes[-1]} — من غير ضغطة زر.")
                        base_row.update({"result": "paper", "profit": 0.0})
                        log_trade(base_row)
                        self.trades_today += 1
                    else:
                        result, profit = self.execute_trade(page, direction, payout, base_row)
                        self.record_result(result, profit)

                    if self.once:
                        break
                    time.sleep(config.POLL_SECONDS)
            except KeyboardInterrupt:
                log("البوت اتوقف بطلب منك (Ctrl+C).")
            finally:
                context.close()
                log(f"النهاية: {self.trades_today} صفقات | صافي الربح التقديري: ${self.daily_profit:.2f}")
        return 0

    def execute_trade(self, page, direction, payout, base_row):
        """ينفّذ الصفقة بالضغط في الواجهة، وبعدين يحاول يعرف النتيجة من تغيّر الرصيد."""
        balance_before = read_balance(page)
        human_delay(1.0, 2.5)
        set_amount(page, config.STAKE)
        human_delay(0.8, 2.0)
        if not click_direction(page, direction):
            log("  ❌ مش قادر ألاقي زر CALL/PUT في الواجهة — الصفقة اتلغت. (تصميم الموقع ممكن يكون اتغيّر — حدّث المحددات في click_direction)")
            return "unknown", 0.0
        log(f"  ✅ ضغط {direction} على {config.ASSET_ON_POCKET} بمبلغ ${config.STAKE} — مستني النتيجة...")
        time.sleep(config.EXPIRY + 10)
        balance_after = read_balance(page)
        if balance_before is not None and balance_after is not None:
            diff = round(balance_after - balance_before, 2)
            expected_win = round(config.STAKE * payout, 2)
            if abs(diff - expected_win) < 0.05:
                result, profit = "win", expected_win
            elif abs(diff + config.STAKE) < 0.05:
                result, profit = "loss", -config.STAKE
            elif abs(diff) < 0.01:
                result, profit = "draw", 0.0
            else:
                result, profit = "unknown", 0.0
                log(f"  ⚠️ تغيّر الرصيد غير متوقع ({balance_before} -> {balance_after}) — النتيجة غير معروفة.")
        else:
            result, profit = "unknown", 0.0
            log("  ⚠️ مش قادر أقرا الرصيد من الواجهة — النتيجة غير معروفة.")
        base_row.update({"result": result, "profit": round(profit, 2)})
        log_trade(base_row)
        return result, profit


def main():
    parser = argparse.ArgumentParser(description="Pocket Option demo bot via browser automation (no API, no session token)")
    parser.add_argument("--strategy", default=config.STRATEGY, choices=list_strategies())
    parser.add_argument("--symbol", default=config.SYMBOL, help="رمز Yahoo Finance للقرار (افتراضي EURUSD=X)")
    parser.add_argument("--live", action="store_true", help="تنفيذ حقيقي بالضغط في المتصفح (على الديمو بس)")
    parser.add_argument("--dry-run", action="store_true", help="وضع ورقي: تحليل بس من غير ضغط")
    parser.add_argument("--once", action="store_true", help="دورة قرار واحدة ويخرج")
    args = parser.parse_args()
    bot = BrowserBot(args)
    return bot.run()


if __name__ == "__main__":
    raise SystemExit(main())
