"""Settings — Binance Hybrid Bot.

Spot first, futures-upgradeable. Testnet only by default.
No real API keys here: keys come from .env only.
"""
import os
from dataclasses import dataclass, field

DEFAULT_COINS = ["BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "LINK/USDT"]


@dataclass
class Settings:
    trading_mode: str = "spot"          # 'spot' | 'futures'
    env: str = "testnet"                # 'testnet' | 'live'
    coins: list = field(default_factory=lambda: list(DEFAULT_COINS))
    timeframe: str = "15m"
    poll_seconds: int = 60
    dry_run: bool = True                # True = لا يرسل أي أمر حقيقي
    api_key: str = ""
    api_secret: str = ""
    telegram_token: str = ""
    telegram_chat_id: str = ""
    db_path: str = "data/trades.db"
    log_file: str = "logs/bot.log"
    stop_file: str = "stop.txt"

    def __post_init__(self):
        self.trading_mode = self.trading_mode.lower()
        self.env = self.env.lower()
        if self.trading_mode not in ("spot", "futures"):
            raise ValueError("TRADING_MODE must be 'spot' or 'futures'")
        if self.env not in ("testnet", "live"):
            raise ValueError("ENV must be 'testnet' or 'live'")
        if self.env == "live" and self.dry_run:
            raise ValueError("live + dry_run is contradictory — set dry_run False only with --live-confirm")


def load_settings() -> Settings:
    """Load settings from environment (.env loaded by main before this)."""
    coins_raw = os.getenv("COINS", ",".join(DEFAULT_COINS))
    coins = [c.strip() for c in coins_raw.split(",") if c.strip()]
    return Settings(
        trading_mode=os.getenv("TRADING_MODE", "spot"),
        env=os.getenv("ENV", "testnet"),
        coins=coins,
        timeframe=os.getenv("TIMEFRAME", "15m"),
        poll_seconds=int(os.getenv("POLL_SECONDS", "60")),
        dry_run=os.getenv("DRY_RUN", "true").lower() in ("1", "true", "yes"),
        api_key=os.getenv("BINANCE_API_KEY", "") or os.getenv("BINANCE_TESTNET_API_KEY", ""),
        api_secret=os.getenv("BINANCE_API_SECRET", "") or os.getenv("BINANCE_TESTNET_API_SECRET", ""),
        telegram_token=os.getenv("TELEGRAM_BOT_TOKEN", ""),
        telegram_chat_id=os.getenv("TELEGRAM_CHAT_ID", ""),
        db_path=os.getenv("DB_PATH", "data/trades.db"),
        log_file=os.getenv("LOG_FILE", "logs/bot.log"),
        stop_file=os.getenv("STOP_FILE", "stop.txt"),
    )
