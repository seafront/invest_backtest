"""전략과 무관한 시장 데이터 분석.

백테스트가 "전략을 넣으면 수익률이 나온다"면, 이쪽은 "종목만 넣으면 성격이 나온다".
낙폭 곡선, 연도별 수익률 분포, 약세장 이벤트를 계산한다.

NOTE: doc/book/markets-never-forget/analysis/common.py 에 유사한 약세장 탐지 로직이 있으나
      의도적으로 분리해 둔다. 그쪽은 statistics.md 수치를 재현하기 위한 고정된 기록이므로,
      이 모듈이 바뀌어도 문서의 재현성이 깨지지 않아야 한다.
"""
import pandas as pd

from utils.metrics import cagr, max_drawdown, sharpe_ratio, total_return

BEAR_THRESHOLD = 0.20


def _forward_return(df: pd.DataFrame, i: int, months: int) -> float | None:
    """i행으로부터 months개월 뒤까지의 수익률(%). 데이터가 부족하면 None."""
    target = pd.Timestamp(df["date"].iloc[i]) + pd.DateOffset(months=months)
    idx = int(pd.to_datetime(df["date"]).searchsorted(target))
    if idx >= len(df):
        return None
    return round((df["close"].iloc[idx] / df["close"].iloc[i] - 1) * 100, 2)


def find_bear_markets(df: pd.DataFrame, threshold: float = BEAR_THRESHOLD) -> list[dict]:
    """고점 대비 threshold 이상 하락한 구간을 모두 추출.

    peak     하락이 시작된 직전 최고 종가
    trough   고점을 회복하기 전까지의 최저 종가
    recovery 종가가 peak 수준을 되찾은 첫 날 (없으면 None = 미회복)
    """
    close = df["close"].values
    dates = df["date"].values
    n = len(close)
    bears: list[dict] = []

    peak_i, i = 0, 1
    while i < n:
        if close[i] >= close[peak_i]:
            peak_i, i = i, i + 1
            continue
        if close[i] > close[peak_i] * (1 - threshold):
            i += 1
            continue

        trough_i, j = i, i
        while j < n and close[j] < close[peak_i]:
            if close[j] < close[trough_i]:
                trough_i = j
            j += 1
        recovery_i = j if j < n else None

        peak_d = pd.Timestamp(dates[peak_i])
        trough_d = pd.Timestamp(dates[trough_i])
        bears.append({
            "peak_date": dates[peak_i],
            "trough_date": dates[trough_i],
            "recovery_date": dates[recovery_i] if recovery_i is not None else None,
            "peak_close": round(float(close[peak_i]), 2),
            "trough_close": round(float(close[trough_i]), 2),
            "decline_pct": round(float(close[trough_i] / close[peak_i] - 1) * 100, 2),
            "decline_days": int((trough_d - peak_d).days),
            "recovery_days": int((pd.Timestamp(dates[recovery_i]) - trough_d).days)
                             if recovery_i is not None else None,
            "return_3m": _forward_return(df, trough_i, 3),
            "return_6m": _forward_return(df, trough_i, 6),
            "return_12m": _forward_return(df, trough_i, 12),
        })

        if recovery_i is None:
            break
        peak_i, i = recovery_i, recovery_i + 1

    return bears


def _yearly_returns(df: pd.DataFrame) -> list[dict]:
    """연말 종가 기준 연간 수익률. 12월까지 없는 마지막 해는 partial=True로 표시."""
    s = df.set_index(pd.to_datetime(df["date"]))["close"]
    year_end = s.resample("YE").last().dropna()
    if len(year_end) < 2:
        return []
    pct = year_end.pct_change().dropna() * 100
    last_year, last_month = s.index.max().year, s.index.max().month
    return [
        {
            "year": int(idx.year),
            "return_pct": round(float(v), 2),
            "partial": bool(idx.year == last_year and last_month < 12),
        }
        for idx, v in pct.items()
    ]


def _drawdown_curve(df: pd.DataFrame) -> list[dict]:
    close = df["close"]
    peak = close.cummax()
    dd = (close / peak - 1) * 100
    return [
        {"date": d, "drawdown": round(float(v), 2)}
        for d, v in zip(df["date"], dd)
    ]


def compute_stats(df: pd.DataFrame, ticker: str) -> dict:
    """OHLCV DataFrame(get_cached_data 형식)에서 시장 통계 일체를 계산."""
    if len(df) < 2:
        raise ValueError(f"{ticker}: 통계를 내려면 최소 2개 행이 필요합니다 (현재 {len(df)}행)")

    closes = df["close"].astype(float).tolist()
    first_d = pd.Timestamp(df["date"].iloc[0])
    last_d = pd.Timestamp(df["date"].iloc[-1])
    days = int((last_d - first_d).days)

    daily = df["close"].pct_change().dropna()
    best_i = int(daily.idxmax())
    worst_i = int(daily.idxmin())

    return {
        "ticker": ticker.upper(),
        "start_date": df["date"].iloc[0],
        "end_date": df["date"].iloc[-1],
        "trading_days": len(df),
        "years": round(days / 365.25, 2),
        "first_close": round(closes[0], 2),
        "last_close": round(closes[-1], 2),
        "total_return": round(total_return(closes), 2),
        "cagr": round(cagr(closes[0], closes[-1], days), 2),
        "annual_volatility": round(float(daily.std()) * (252 ** 0.5) * 100, 2),
        "max_drawdown": round(max_drawdown(closes), 2),
        "sharpe_ratio": round(sharpe_ratio(closes), 4),
        "best_day": {"date": df["date"].iloc[best_i], "change": round(float(daily[best_i]) * 100, 2)},
        "worst_day": {"date": df["date"].iloc[worst_i], "change": round(float(daily[worst_i]) * 100, 2)},
        "positive_day_pct": round(float((daily > 0).mean()) * 100, 2),
        "drawdown_curve": _drawdown_curve(df),
        "yearly_returns": _yearly_returns(df),
        "bear_markets": find_bear_markets(df),
    }
