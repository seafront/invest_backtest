"""공용 유틸 — 데이터 로드 및 약세장/강세장 구간 탐지.

모든 분석 스크립트가 이 모듈의 정의를 공유한다.
"""
import os
import pandas as pd

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")


def csv_path(ticker: str) -> str:
    return os.path.join(DATA_DIR, f"{ticker.replace('^', '')}.csv")


def load(ticker: str = "^GSPC") -> pd.DataFrame:
    """CSV에서 OHLCV 로드. fetch_data.py를 먼저 실행해야 한다."""
    path = csv_path(ticker)
    if not os.path.exists(path):
        raise SystemExit(f"데이터 없음: {path}\n먼저 실행하세요:  python fetch_data.py")
    df = pd.read_csv(path, parse_dates=["date"])
    return df.sort_values("date").reset_index(drop=True)


def find_bear_markets(df: pd.DataFrame, threshold: float = 0.20) -> list[dict]:
    """고점 대비 threshold 이상 하락한 구간을 모두 추출.

    정의:
      - peak   : 하락이 시작된 직전 최고 종가
      - trough : 고점을 회복하기 전까지의 최저 종가
      - recovery: 종가가 peak 수준을 되찾은 첫 날 (없으면 None = 미회복)

    반환 항목의 인덱스는 df의 행 번호다.
    """
    close = df["close"].values
    n = len(close)
    bears: list[dict] = []

    peak_i = 0
    i = 1
    while i < n:
        if close[i] >= close[peak_i]:
            peak_i = i
            i += 1
            continue

        if close[i] > close[peak_i] * (1 - threshold):
            i += 1
            continue

        # threshold 돌파 — 약세장 확정. 고점 회복 시점까지 훑어 저점을 찾는다.
        trough_i = i
        j = i
        while j < n and close[j] < close[peak_i]:
            if close[j] < close[trough_i]:
                trough_i = j
            j += 1

        recovery_i = j if j < n else None
        bears.append({
            "peak_i": peak_i,
            "trough_i": trough_i,
            "recovery_i": recovery_i,
            "peak_date": df["date"].iloc[peak_i],
            "trough_date": df["date"].iloc[trough_i],
            "recovery_date": df["date"].iloc[recovery_i] if recovery_i else None,
            "peak_close": close[peak_i],
            "trough_close": close[trough_i],
            "decline_pct": (close[trough_i] / close[peak_i] - 1) * 100,
            "decline_days": (df["date"].iloc[trough_i] - df["date"].iloc[peak_i]).days,
            "recovery_days": (df["date"].iloc[recovery_i] - df["date"].iloc[trough_i]).days
                             if recovery_i else None,
        })

        if recovery_i is None:
            break
        peak_i = recovery_i
        i = recovery_i + 1

    return bears


def forward_return(df: pd.DataFrame, i: int, months: int) -> float | None:
    """i번째 행으로부터 months개월 뒤까지의 수익률(%). 데이터가 부족하면 None."""
    target = df["date"].iloc[i] + pd.DateOffset(months=months)
    idx = int(df["date"].searchsorted(target))
    if idx >= len(df):
        return None
    return (df["close"].iloc[idx] / df["close"].iloc[i] - 1) * 100


def fmt(v, nd: int = 1, suffix: str = "") -> str:
    return "—" if v is None else f"{v:,.{nd}f}{suffix}"


def section(title: str) -> None:
    print()
    print("=" * 78)
    print(title)
    print("=" * 78)
