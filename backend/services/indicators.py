"""OHLCV만으로 계산되는 파생 지표.

market_stats.py가 "이 종목이 어떤 성격인가"(장기 낙폭·연도별 수익률)를 본다면,
이쪽은 "지금 어디에 서 있나"를 본다 — 마지막 거래일 기준의 위치와 거래 강도.

새로 받아오는 데이터가 없다. 전부 stocks 테이블의 OHLCV에서 파생된다.

거래대금은 `종가 × 거래량`으로 근사한다. 실제 체결대금은 일중 체결가 가중이라
변동성이 큰 날일수록 오차가 커진다. 그래서 절대 금액이 아니라 **배율로만** 쓴다
(최근 5일 평균 ÷ 60일 평균) — 분자와 분모가 같은 방식으로 틀리므로 오차가 상쇄된다.
"""
import numpy as np
import pandas as pd

MIN_BARS = 20
WEEKS_52 = 252  # 52주 고가·저가 등 "최근 1년" 통계에 쓰는 거래일 수

# 차트로 돌려줄 구간. 52주 통계와는 별개다 — 구간을 바꿔도 타일 값은 그대로여야 한다.
RANGES: dict[str, int | None] = {
    "1m": 21,
    "3m": 63,
    "6m": 126,
    "1y": 252,
    "3y": 756,
    "5y": 1260,
    "all": None,
}
DEFAULT_RANGE = "1y"

# 신호 임계값. 근거를 숨기지 않으려고 상수로 빼 둔다 — 화면에도 같은 숫자가 나간다.
SURGE_RATIO = 1.5      # 거래대금 5일 평균이 60일 평균의 몇 배부터 "급증"인가
DISPARITY_HOT = 15.0   # 20일선 위 이격도 몇 %부터 과열로 볼 것인가
NEAR_HIGH_PCT = 3.0    # 52주 고가에 몇 % 안으로 붙으면 "근접"인가
WICK_RATIO = 0.5       # 위꼬리가 당일 전체 범위의 몇 배 이상이면 "긴 위꼬리"인가
WICK_DAYS = 3          # 최근 20일 중 긴 위꼬리가 몇 번 반복되면 경고인가


def _pct_change(series: pd.Series, days: int) -> float | None:
    """days 거래일 전 대비 변화율(%). 데이터가 모자라면 None."""
    if len(series) <= days:
        return None
    prev = series.iloc[-1 - days]
    if prev == 0:
        return None
    return round((series.iloc[-1] / prev - 1) * 100, 2)


def _streak(flags: pd.Series) -> int:
    """마지막 값부터 거꾸로 세어 연속으로 True인 일수."""
    n = 0
    for v in reversed(flags.tolist()):
        if not bool(v):
            break
        n += 1
    return n


def _ma(close: pd.Series, window: int) -> float | None:
    if len(close) < window:
        return None
    return round(float(close.rolling(window).mean().iloc[-1]), 4)


def compute_indicators(df: pd.DataFrame, ticker: str, series_range: str = DEFAULT_RANGE) -> dict:
    """마지막 거래일 기준 파생 지표. df는 date 오름차순 OHLCV.

    series_range는 차트용 시계열의 길이만 결정한다 (RANGES 참고).
    타일에 쓰이는 값들은 구간과 무관하게 항상 마지막 거래일 기준이다.
    """
    if series_range not in RANGES:
        raise ValueError(f"알 수 없는 구간: {series_range}. 사용 가능: {', '.join(RANGES)}")
    if len(df) < MIN_BARS:
        raise ValueError(f"파생 지표에는 최소 {MIN_BARS}거래일이 필요합니다 (현재 {len(df)}일)")

    df = df.reset_index(drop=True)
    close, high, low, open_ = df["close"], df["high"], df["low"], df["open"]
    turnover = close * df["volume"]

    ma_series = {w: close.rolling(w).mean() for w in (5, 20, 60)}
    ma20_series = ma_series[20]
    ma20 = _ma(close, 20)
    last_close = float(close.iloc[-1])

    def disparity(window: int) -> float | None:
        """종가가 해당 이동평균에서 몇 % 떨어져 있는가. 양수면 평균보다 비싸다."""
        m = _ma(close, window)
        return round((last_close / m - 1) * 100, 2) if m else None

    disparity_5 = disparity(5)
    disparity_20 = disparity(20)
    disparity_60 = disparity(60)
    above_ma20_days = _streak((close > ma20_series).fillna(False)) if ma20 else 0

    avg5 = float(turnover.tail(5).mean())
    avg20 = float(turnover.tail(20).mean())
    avg60 = float(turnover.tail(60).mean()) if len(turnover) >= 60 else None
    ratio_5_60 = round(avg5 / avg60, 2) if avg60 else None

    window = df.tail(WEEKS_52)
    high_52w = float(window["high"].max())
    low_52w = float(window["low"].min())
    from_high = round((last_close / high_52w - 1) * 100, 2) if high_52w else None
    from_low = round((last_close / low_52w - 1) * 100, 2) if low_52w else None

    daily = close.pct_change().dropna()
    vol20 = (
        round(float(daily.tail(20).std() * np.sqrt(252) * 100), 2)
        if len(daily) >= 20 else None
    )

    # 긴 위꼬리 — 장중에 올랐다가 종가에 되밀린 날. 고점 매물 출회의 흔적으로 본다.
    rng = (high - low).replace(0, np.nan)
    wick = (high - pd.concat([open_, close], axis=1).max(axis=1)) / rng
    wick_days = int((wick.tail(20) >= WICK_RATIO).sum())

    bullish_days = int((close.tail(15) > open_.tail(15)).sum())

    # 저점 상승 — 최근 20일 저가가 그 직전 20일 저가보다 높은가
    low_rising = None
    if len(low) >= 40:
        low_rising = bool(low.tail(20).min() > low.iloc[-40:-20].min())

    signals = _build_signals(
        above_ma20=bool(ma20 and last_close > ma20),
        disparity_20=disparity_20,
        ratio_5_60=ratio_5_60,
        from_high=from_high,
        wick_days=wick_days,
    )

    bars = RANGES[series_range]
    n = len(df) if bars is None else min(bars, len(df))
    tail = df.tail(n)
    turnover_tail = turnover.tail(n)
    turnover_ma20 = turnover.rolling(20).mean().tail(n)
    disp_tail = {w: ((close / m - 1) * 100).tail(n) for w, m in ma_series.items()}

    def cell(v) -> float | None:
        return None if pd.isna(v) else round(float(v), 2)

    series = [
        {
            "date": d,
            "close": round(float(c), 4),
            "disparity_5": cell(d5),
            "disparity_20": cell(d20),
            "disparity_60": cell(d60),
            "turnover_ratio": None if (pd.isna(tm) or tm == 0) else round(float(tv / tm), 2),
        }
        for d, c, d5, d20, d60, tv, tm in zip(
            tail["date"], tail["close"],
            disp_tail[5], disp_tail[20], disp_tail[60],
            turnover_tail, turnover_ma20,
        )
    ]

    return {
        "ticker": ticker.upper(),
        "as_of": df["date"].iloc[-1],
        "close": round(last_close, 4),
        "ma5": _ma(close, 5),
        "ma20": ma20,
        "ma60": _ma(close, 60),
        "above_ma20_days": above_ma20_days,
        "disparity_5": disparity_5,
        "disparity_20": disparity_20,
        "disparity_60": disparity_60,
        "return_5d": _pct_change(close, 5),
        "return_20d": _pct_change(close, 20),
        "return_60d": _pct_change(close, 60),
        "turnover_avg5": round(avg5, 2),
        "turnover_avg20": round(avg20, 2),
        "turnover_avg60": round(avg60, 2) if avg60 else None,
        "turnover_ratio_5_60": ratio_5_60,
        "high_52w": round(high_52w, 4),
        "low_52w": round(low_52w, 4),
        "from_high_pct": from_high,
        "from_low_pct": from_low,
        "is_52w_high": bool(float(high.iloc[-1]) >= high_52w),
        "volatility_20d": vol20,
        "upper_wick_days_20": wick_days,
        "bullish_days_15": bullish_days,
        "low_rising": low_rising,
        "signals": signals,
        "series_range": series_range,
        "series": series,
    }


def _build_signals(
    *,
    above_ma20: bool,
    disparity_20: float | None,
    ratio_5_60: float | None,
    from_high: float | None,
    wick_days: int,
) -> list[dict]:
    """판정이 아니라 관찰 결과다. level은 색으로만 쓰이고 매매 신호가 아니다.

    ok = 조건 충족, watch = 눈여겨볼 상태, alert = 과열 쪽으로 치우침
    """
    out: list[dict] = []

    out.append({
        "key": "ma20",
        "label": "20일선",
        "detail": "종가가 20일선 위" if above_ma20 else "종가가 20일선 아래",
        "level": "ok" if above_ma20 else "watch",
    })

    if ratio_5_60 is not None:
        surged = ratio_5_60 >= SURGE_RATIO
        out.append({
            "key": "turnover",
            "label": "거래대금",
            "detail": f"5일 평균이 60일 평균의 {ratio_5_60}배"
                      + (f" (기준 {SURGE_RATIO}배)" if surged else ""),
            "level": "alert" if surged else "ok",
        })

    if disparity_20 is not None:
        hot = disparity_20 >= DISPARITY_HOT
        cold = disparity_20 <= -DISPARITY_HOT
        out.append({
            "key": "disparity",
            "label": "이격도",
            "detail": f"20일선 대비 {disparity_20:+.2f}%"
                      + (f" (과열 기준 {DISPARITY_HOT}%)" if hot else "")
                      + (" (과매도 구간)" if cold else ""),
            "level": "alert" if hot else ("watch" if cold else "ok"),
        })

    if from_high is not None:
        near = from_high >= -NEAR_HIGH_PCT
        out.append({
            "key": "near_high",
            "label": "52주 고가",
            "detail": f"고가 대비 {from_high:+.2f}%"
                      + (f" (근접 기준 {NEAR_HIGH_PCT}% 이내)" if near else ""),
            "level": "watch" if near else "ok",
        })

    repeated = wick_days >= WICK_DAYS
    out.append({
        "key": "wick",
        "label": "위꼬리",
        "detail": f"최근 20일 중 {wick_days}일"
                  + (f" (반복 기준 {WICK_DAYS}일)" if repeated else ""),
        "level": "alert" if repeated else "ok",
    })

    return out
