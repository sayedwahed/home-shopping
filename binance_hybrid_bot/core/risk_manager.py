"""Risk manager — position sizing + circuit breakers.

- Dynamic size from risk % and stop distance: never risk more than
  max_risk_per_trade_pct of equity on one trade.
- Daily drawdown circuit breaker: stops new entries when the day's
  realised loss hits max_daily_loss_pct.
- Consecutive-loss stop.
"""
from dataclasses import dataclass, field
from datetime import date


@dataclass
class RiskManager:
    params: object
    equity: float = 0.0
    daily_pnl: float = 0.0
    day: object = field(default_factory=date.today)
    consecutive_losses: int = 0
    trades_today: int = 0

    def reset_day_if_needed(self):
        if date.today() != self.day:
            self.day = date.today()
            self.daily_pnl = 0.0
            self.trades_today = 0
            self.consecutive_losses = 0

    def position_size(self, entry_price, stop_price, equity=None):
        """Quantity to buy so that a stop-out loses ~max_risk_per_trade_pct."""
        eq = equity if equity is not None else self.equity
        if not entry_price or not stop_price or entry_price == stop_price or eq <= 0:
            return 0.0
        risk_amount = eq * self.params.max_risk_per_trade_pct / 100.0
        per_unit_risk = abs(entry_price - stop_price)
        qty = risk_amount / per_unit_risk
        return max(qty, 0.0)

    def can_open_new_trade(self, open_trades_count):
        """Circuit breakers. Returns (allowed, reason)."""
        self.reset_day_if_needed()
        if self.params.max_daily_loss_pct and self.daily_pnl <= -self.equity * self.params.max_daily_loss_pct / 100.0:
            return False, f"قاطع الخسارة اليومية: {self.daily_pnl:.2f} (حد {self.params.max_daily_loss_pct}%)"
        if open_trades_count >= self.params.max_open_trades:
            return False, f"وصلنا لأقصى صفقات مفتوحة ({self.params.max_open_trades})"
        if self.consecutive_losses >= self.params.max_consecutive_losses:
            return False, f"إيقاف بعد {self.consecutive_losses} خسائر متتالية"
        return True, ""

    def record_result(self, pnl):
        self.reset_day_if_needed()
        self.daily_pnl += pnl
        self.trades_today += 1
        if pnl < 0:
            self.consecutive_losses += 1
        elif pnl > 0:
            self.consecutive_losses = 0
