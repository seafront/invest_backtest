from datetime import date

import numpy as np


def total_return(equity_curve: list[float]) -> float:
    """Calculate total return as a percentage."""
    if len(equity_curve) < 2 or equity_curve[0] == 0:
        return 0.0
    return (equity_curve[-1] - equity_curve[0]) / equity_curve[0] * 100


def _daily_returns(equity_curve: list[float], contributions: list[float] | None) -> np.ndarray:
    """일간 수익률. 입금이 있으면 그날 들어온 돈은 수익에서 뺀다 (시간가중수익률).

    적립식은 평가금액에 매달 넣은 돈이 섞인다. 그대로 나누면 입금일마다
    입금액이 "수익"으로 잡혀, 삼성전자 5년 적립식의 입금일 수익률이 평균 +8%
    (첫 입금일 +103%)가 되고 Sharpe가 거치식의 두 배로 부풀었다.
    """
    eq = np.array(equity_curve, dtype=float)
    flows = np.zeros_like(eq) if contributions is None else np.array(contributions, dtype=float)
    mask = eq[:-1] != 0
    if not mask.any():
        return np.array([])
    return ((eq[1:] - flows[1:])[mask] / eq[:-1][mask]) - 1


def sharpe_ratio(equity_curve: list[float], risk_free_rate: float = 0.02,
                 contributions: list[float] | None = None) -> float:
    """Calculate annualized Sharpe ratio from daily equity values.

    contributions[i]는 i일에 평가금액에 더해진 입금액이다 (적립식). 없으면 거치식과 같다.
    """
    if len(equity_curve) < 2:
        return 0.0
    returns = _daily_returns(equity_curve, contributions)
    if len(returns) < 2 or np.std(returns) == 0:
        return 0.0
    daily_rf = risk_free_rate / 252
    excess_returns = returns - daily_rf
    return float(np.mean(excess_returns) / np.std(excess_returns) * np.sqrt(252))


def max_drawdown(equity_curve: list[float], contributions: list[float] | None = None) -> float:
    """Calculate maximum drawdown as a percentage.

    입금이 있으면 입금 효과를 뺀 수익률 지수로 잰다. 하락장에도 새 돈이 평가금액을
    떠받쳐, TQQQ 5년 적립식의 낙폭이 실제 81%에서 56%로 가려졌다.
    """
    if len(equity_curve) < 2:
        return 0.0
    if contributions is not None and any(contributions):
        returns = _daily_returns(equity_curve, contributions)
        equity_curve = list(np.concatenate([[1.0], np.cumprod(1 + returns)]))
    peak = equity_curve[0]
    max_dd = 0.0
    for val in equity_curve:
        if val > peak:
            peak = val
        if peak > 0:
            dd = (peak - val) / peak * 100
            if dd > max_dd:
                max_dd = dd
    return max_dd


def cagr(total_invested: float, final_value: float, days: int) -> float:
    """Calculate Compound Annual Growth Rate (%)."""
    if total_invested <= 0 or final_value <= 0 or days <= 0:
        return 0.0
    years = days / 365.25
    if years < 0.1:
        return 0.0
    return (pow(final_value / total_invested, 1 / years) - 1) * 100


def money_weighted_cagr(flows: list[tuple[date, float]], final_value: float, end: date) -> float:
    """입금 시점을 반영한 연환산 수익률(IRR, %). 적립식용.

    cagr()는 원금 전부가 첫날 들어갔다고 보므로, 나중에 넣어 짧게 굴린 돈까지
    5년을 굴린 것처럼 나눠 수익률을 낮춘다 (삼성전자 적립식 31.5% vs 실제 57.2%).
    NPV가 이율에 대해 단조라 이분법으로 충분하다.
    """
    flows = [(d, a) for d, a in flows if a > 0]
    if not flows or final_value <= 0:
        return 0.0
    if (end - flows[0][0]).days / 365.25 < 0.1:
        return 0.0

    def grown(rate: float) -> float:
        return sum(a * (1 + rate) ** ((end - d).days / 365.25) for d, a in flows)

    lo, hi = -0.9999, 1.0
    while grown(hi) < final_value and hi < 1e6:  # 상한을 넓혀 근을 감싼다
        hi *= 2
    for _ in range(200):
        mid = (lo + hi) / 2
        if grown(mid) < final_value:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2 * 100


def win_rate(trades_pnl: list[float]) -> float:
    """Calculate win rate from list of trade PnLs (sell trades only)."""
    if not trades_pnl:
        return 0.0
    wins = sum(1 for p in trades_pnl if p > 0)
    return wins / len(trades_pnl) * 100
