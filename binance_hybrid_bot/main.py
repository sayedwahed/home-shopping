#!/usr/bin/env python3
"""Binance Hybrid Bot — main loop.

Spot first, futures-upgradeable. Testnet only by default.
Usage:
  python main.py --mode spot --env testnet            # dry-run on Testnet (default, safe)
  python main.py --mode spot --env testnet --live     # real Testnet orders (needs .env keys)
  python main.py --mode spot --env testnet --live --once  # ONE pass, then exit (GitHub Actions)
  python main.py --mode spot --env testnet --once     # one dry-run pass, no orders
  python main.py --mode futures --env testnet --leverage 2 --live
  python main.py --mode spot --env live --live-confirm   # REAL money — only after weeks on Testnet

Safety:
- Default is testnet + dry-run (no orders sent at all).
- Live mode refuses to run without --live-confirm.
- Kill-switch: create stop.txt, or Telegram /stop — the loop stops opening
  new trades immediately.
- Every iteration is wrapped in try/except + auto-reconnect; an error in
  one coin never kills the whole loop or drops open trades.
"""
import argparse
import os
import sys
import time
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
from config.settings import load_settings
from config.risk_params import RiskParams, get_coin_params
from core.exchange_client import ExchangeClient
from core.filters import MarketFilters, ohlcv_to_df, add_indicators
from core.strategy import HybridStrategy, add_strategy_indicators
from core.risk_manager import RiskManager
from core.order_manager import OrderManager
from data.db_handler import DBHandler
from utils.logger import get_logger
from utils.telegram_bot import TelegramBot


def parse_args():
    p = argparse.ArgumentParser(description="Binance Hybrid Bot")
    p.add_argument("--mode", choices=["spot", "futures"], default=None)
    p.add_argument("--env", choices=["testnet", "live"], default=None)
    p.add_argument("--leverage", type=int, default=2)
    p.add_argument("--live", action="store_true", help="send real orders (testnet keys by default)")
    p.add_argument("--once", action="store_true",
                   help="run ONE full pass over all coins, then exit 0 (GitHub Actions cron)")
    p.add_argument("--live-confirm", action="store_true",
                   help="REQUIRED for real-money live trading")
    return p.parse_args()


def btc_1h_change(client):
    """BTC/USDT % change over the last hour (4 x 15m candles)."""
    try:
        ohlcv = client.fetch_ohlcv("BTC/USDT", "15m", limit=5)
        if len(ohlcv) >= 5:
            return (ohlcv[-1][4] - ohlcv[-5][4]) / ohlcv[-5][4] * 100
    except Exception:
        pass
    return None


def main():
    load_dotenv()
    args = parse_args()
    if args.mode:
        os.environ["TRADING_MODE"] = args.mode
    if args.env:
        os.environ["ENV"] = args.env
    settings = load_settings()
    # --live turns off dry-run; without it, orders are only logged.
    settings.dry_run = not args.live
    if settings.env == "live" and not args.live_confirm:
        print("⛔ LIVE mode refused: add --live-confirm only after weeks on Testnet. "
              "Real money is at stake.")
        sys.exit(2)
    if settings.env == "live":
        print("⚠️  LIVE MODE — real money. Kill-switch: create stop.txt or Telegram /stop.")

    log = get_logger(log_file=settings.log_file)
    log.info(f"Starting Binance Hybrid Bot | mode={settings.trading_mode} env={settings.env} "
             f"dry_run={settings.dry_run} coins={settings.coins}")
    tg = TelegramBot(settings.telegram_token, settings.telegram_chat_id, log, settings.stop_file)
    db = DBHandler(settings.db_path)
    client = None
    for attempt in range(5):
        try:
            client = ExchangeClient(settings, log)
            break
        except Exception as e:
            log.error(f"الاتصال بـ Binance فشل (محاولة {attempt + 1}/5): {e}")
            log.error("تأكد أن Binance متاح من موقعك/شبكتك، ثم أعد التشغيل.")
            time.sleep(10 * (attempt + 1))
    if client is None:
        log.error("تعذر الاتصال بـ Binance بعد 5 محاولات — إيقاف البوت بأمان.")
        sys.exit(3)
    strategy = HybridStrategy(mode=settings.trading_mode)
    risk_params = RiskParams()
    risk_params.default_leverage = args.leverage
    # Equity: testnet balance if keys exist, else a paper 1000 USDT for sizing in dry-run.
    try:
        bal = client.fetch_balance()
        equity = float(bal.get("total", {}).get("USDT", 0) or 0)
    except Exception:
        equity = 0.0
    if equity <= 0:
        equity = 1000.0
        log.info("No balance readable (no keys / dry-run) — using paper equity $1000 for sizing.")
    risk = RiskManager(risk_params, equity=equity)
    orders = OrderManager(client, risk, settings, log, db)
    tg.send(f"🤖 Binance Hybrid Bot started | {settings.trading_mode} / {settings.env} "
            f"| dry_run={settings.dry_run}")

    cooldown_until = {}  # symbol -> timestamp

    if args.once:
        # GitHub Actions mode: one pass, then exit 0. No sleep, no loop.
        stats = run_one_pass(client, settings, strategy, risk, orders, db, tg, log, cooldown_until)
        log.info(f"مرة واحدة (--once) اكتملت: {stats}")
        tg.send(f"🤖 جولة واحدة اكتملت | فُحص {stats['coins_checked']} عملات، "
                f"إشارات {stats['signals']}, صفقات فُتحت {stats['trades_opened']}")
        sys.exit(0)

    while True:
        try:
            run_one_pass(client, settings, strategy, risk, orders, db, tg, log, cooldown_until)
            time.sleep(settings.poll_seconds)
        except KeyboardInterrupt:
            log.info("Stopped by user.")
            break
        except Exception as e:
            log.error(f"Main loop error: {e}\n{traceback.format_exc()[:800]}")
            tg.send(f"⚠️ خطأ في حلقة البوت: {e} — إعادة المحاولة بعد 30 ثانية")
            if not client.reconnect():
                time.sleep(30)
            time.sleep(30)


def run_one_pass(client, settings, strategy, risk, orders, db, tg, log, cooldown_until):
    """One full pass over all configured coins.

    Shared by the continuous loop and --once (GitHub Actions cron).
    Returns stats: {coins_checked, signals, trades_opened, stopped}.
    Never raises for a single coin's error — it logs and moves on.
    """
    stats = {"coins_checked": 0, "signals": 0, "trades_opened": 0, "stopped": False}
    if os.path.exists(settings.stop_file):
        log.warning("Kill-switch stop.txt found — no new trades. Remove it to resume.")
        tg.send("⛔ Kill-switch active (stop.txt) — bot paused, no new trades.")
        stats["stopped"] = True
        return stats
    tg.check_stop_command()
    risk.reset_day_if_needed()
    btc_change = btc_1h_change(client)
    open_trades = db.open_trades()

    for symbol in settings.coins:
        stats["coins_checked"] += 1
        try:
            params = get_coin_params(symbol)
            ohlcv = client.fetch_ohlcv(symbol, limit=250)
            df = add_strategy_indicators(add_indicators(ohlcv_to_df(ohlcv)))
            ticker = client.fetch_ticker(symbol)
            book = client.fetch_order_book(symbol)
            price = float(ticker["last"])
            on_cd = time.time() < cooldown_until.get(symbol, 0)

            filters = MarketFilters(params, mode=settings.trading_mode)
            # Try LONG first (spot only allows long); in futures also try SHORT.
            for side in (["long"] if settings.trading_mode == "spot" else ["long", "short"]):
                fr = filters.evaluate(df, ticker, book, btc_1h_change_pct=btc_change,
                                      symbol=symbol, side=side, on_cooldown=on_cd)
                if not fr.passed:
                    log.info(f"{symbol} [{side}] فلاتر رفضت: {'; '.join(fr.reasons)}")
                    continue
                sig = strategy.decide(df, fr.regime)
                if not sig.side or sig.side != side:
                    log.info(f"{symbol} [{side}] لا إشارة: {sig.reason}")
                    continue
                stats["signals"] += 1
                allowed, why = risk.can_open_new_trade(len(open_trades))
                if not allowed:
                    log.info(f"{symbol}: ممنوع فتح صفقة — {why}")
                    tg.send(f"⛔ قاطع مخاطر: {why}")
                    continue
                stop_price = price * (1 - sig.stop_pct / 100) if side == "long" \
                    else price * (1 + sig.stop_pct / 100)
                qty = risk.position_size(price, stop_price)
                rec = orders.open_trade(symbol, side, price, stop_price, qty, sig.strategy)
                if rec:
                    open_trades.append(rec)
                    stats["trades_opened"] += 1
                    tg.send(f"✅ فتح {side} {symbol} @ {price:.2f} | {sig.strategy} | {sig.reason}")
                break  # one direction per coin per loop
        except Exception as e:
            log.error(f"{symbol} error: {e}\n{traceback.format_exc()[:500]}")
            continue

    # State reconciliation (every pass, cheap): local open vs exchange open.
    try:
        ex_open = client.fetch_open_orders()
        changed = db.reconcile([o.get("id") for o in ex_open])
        for cid in changed:
            log.warning(f"مصالحة: صفقة {cid} أُغلقت خارج البوت — حدّثنا الحالة")
    except Exception as e:
        log.warning(f"reconcile skipped: {e}")
    return stats


if __name__ == "__main__":
    main()
