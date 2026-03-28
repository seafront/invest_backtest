import numpy as np


def total_return(equity_curve: list[float]) -> float:
    """Calculate total return as a percentage."""
    if len(equity_curve) < 2:
        return 0.0
    return (equity_curve[-1] - equity_curve[0]) / equity_curve[0] * 100


def sharpe_ratio(equity_curve: list[float], risk_free_rate: float = 0.02) -> float:
    """Calculate annualized Sharpe ratio from daily equity values."""
    if len(equity_curve) < 2:
        return 0.0
    returns = np.diff(equity_curve) / equity_curve[:-1]
    if np.std(returns) == 0:
        return 0.0
    daily_rf = risk_free_rate / 252
    excess_returns = returns - daily_rf
    return float(np.mean(excess_returns) / np.std(excess_returns) * np.sqrt(252))


def max_drawdown(equity_curve: list[float]) -> float:
    """Calculate maximum drawdown as a percentage."""
    if len(equity_curve) < 2:
        return 0.0
    peak = equity_curve[0]
    max_dd = 0.0
    for val in equity_curve:
        if val > peak:
            peak = val
        dd = (peak - val) / peak * 100
        if dd > max_dd:
            max_dd = dd
    return max_dd


def win_rate(trades_pnl: list[float]) -> float:
    """Calculate win rate from list of trade PnLs (sell trades only)."""
    if not trades_pnl:
        return 0.0
    wins = sum(1 for p in trades_pnl if p > 0)
    return wins / len(trades_pnl) * 100
