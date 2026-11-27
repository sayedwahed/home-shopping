"""Risk parameters + per-coin overrides.

Defaults are the user's agreed spec. Change ONE variable at a time
and measure the effect — never tune several rules at once.
"""
from dataclasses import dataclass, field


@dataclass
class RiskParams:
    max_risk_per_trade_pct: float = 1.5   # أقصى مخاطرة للصفقة من الرصيد
    max_daily_loss_pct: float = 3.0       # قاطع الخسارة اليومية
    max_open_trades: int = 3
    max_consecutive_losses: int = 3
    cooldown_candles: int = 3             # تبريد بعد صفقة خاسرة
    atr_min_pct: float = 0.10             # ATR% أقل من كده = تذبذب ميت
    atr_max_pct: float = 3.0              # ATR% أعلى من كده = عنيف جداً
    adx_threshold: float = 25.0           # فوقه = اتجاهي
    adx_range_max: float = 20.0           # تحته = عرضي
    max_spread_pct: float = 0.05          # (Ask-Bid)/Bid
    btc_drop_filter_pct: float = 2.0      # هبوط BTC في آخر ساعة يمنع LONG على العملات
    futures_leverage_min: int = 2
    futures_leverage_max: int = 3
    futures_margin_mode: str = "isolated"  # Isolated فقط — لا Cross أبداً
    default_leverage: int = 2


# Per-coin overrides: only the named fields differ, the rest use defaults.
PER_COIN_OVERRIDES = {
    "BTC/USDT": {"atr_max_pct": 2.0, "adx_threshold": 22.0, "cooldown_candles": 2},
    "ETH/USDT": {"atr_max_pct": 3.0, "adx_threshold": 25.0, "cooldown_candles": 3},
    "SOL/USDT": {"atr_max_pct": 5.0, "adx_threshold": 25.0, "cooldown_candles": 4},
    "BNB/USDT": {"atr_max_pct": 2.5, "adx_threshold": 25.0, "cooldown_candles": 3},
    "LINK/USDT": {"atr_max_pct": 5.0, "adx_threshold": 27.0, "cooldown_candles": 4},
}


def get_coin_params(symbol: str) -> RiskParams:
    """Return a RiskParams with per-coin overrides applied (defaults otherwise)."""
    params = RiskParams()
    for key, value in PER_COIN_OVERRIDES.get(symbol, {}).items():
        setattr(params, key, value)
    return params
