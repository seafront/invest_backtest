"""조건 기반 종목 스크리너.

기존 스크리너(`screener.py`)는 전략을 백테스트해 수익률로 줄을 세운다. 이쪽은 다르다 —
백테스트 없이 오늘의 상태를 조건으로 거른다. questions.md가 요구하는 방식이 이것이다.
"최근 20거래일 외국인과 기관이 동시에 순매수하고, 20일선 위에 있고, 거래대금이 늘어난
종목을 찾아줘"는 수익률 순위가 아니라 교집합을 묻는 질문이다.

조건마다 몇 종목이 남는지 함께 돌려준다. 최종 9종목만 보여주면 어느 조건이 실제로
걸렀는지 알 수 없어 조건을 조절할 근거가 생기지 않는다.
"""
from datetime import date, timedelta

import pandas as pd
from sqlalchemy.orm import Session

LOOKBACK_DAYS = 200   # 60일 평균과 20일 수익률을 내려면 이 정도 여유가 필요하다
MIN_BARS = 60
FLOW_WINDOW = 20      # 수급 조건이 보는 거래일 수


def _metrics(db: Session, universe: str | None) -> pd.DataFrame:
    """종목별 현재 상태를 한 장의 표로 만든다."""
    params: dict = {}
    join = ""
    if universe:
        join = "join index_members m on m.ticker = s.ticker and m.universe = :universe"
        params["universe"] = universe

    px = pd.read_sql(
        f"""
        select s.ticker, s.date, s.close, s.volume,
               c.name, c.sector, c.industry, c.industry_krx
        from stocks s
        {join}
        left join companies c on c.ticker = s.ticker
        where s.date >= date((select max(date) from stocks), '-{LOOKBACK_DAYS} day')
        """,
        db.bind, params=params, parse_dates=["date"],
    )
    if px.empty:
        return pd.DataFrame()

    flows = pd.read_sql(
        "select ticker, date, frgn_ntby_qty, orgn_ntby_qty, prsn_ntby_qty from investor_flows",
        db.bind, parse_dates=["date"],
    )
    # 종목별 최근 20거래일 합계. 수급은 한국 종목에만 있으므로 없는 종목은 NaN으로 남는다.
    flow_sum = (
        flows.sort_values("date").groupby("ticker").tail(FLOW_WINDOW)
        .groupby("ticker")[["frgn_ntby_qty", "orgn_ntby_qty", "prsn_ntby_qty"]].sum()
    )

    rows = []
    for ticker, g in px.groupby("ticker", sort=False):
        g = g.sort_values("date")
        if len(g) < MIN_BARS:
            continue
        close = g["close"]
        turnover = close * g["volume"]      # 근사치. 배율로만 쓴다
        last = float(close.iloc[-1])

        def ma(n: int) -> float | None:
            return float(close.rolling(n).mean().iloc[-1]) if len(close) >= n else None

        def ret(n: int) -> float | None:
            return round((last / close.iloc[-1 - n] - 1) * 100, 2) if len(close) > n else None

        ma20, ma60 = ma(20), ma(60)
        avg5, avg60 = float(turnover.tail(5).mean()), float(turnover.tail(60).mean())
        window52 = g.tail(252)
        high52 = float(window52["close"].max())

        f = flow_sum.loc[ticker] if ticker in flow_sum.index else None
        rows.append({
            "ticker": ticker,
            "name": g["name"].iloc[-1],
            "sector": g["sector"].iloc[-1],
            "industry": g["industry_krx"].iloc[-1] or g["industry"].iloc[-1],
            "close": round(last, 4),
            "date": g["date"].iloc[-1].date(),
            "above_ma20": bool(ma20 and last > ma20),
            "above_ma60": bool(ma60 and last > ma60),
            "disparity_20": round((last / ma20 - 1) * 100, 2) if ma20 else None,
            "turnover_ratio": round(avg5 / avg60, 2) if avg60 else None,
            "turnover_avg5": round(avg5, 2),
            "return_5d": ret(5),
            "return_20d": ret(20),
            "from_high_pct": round((last / high52 - 1) * 100, 2) if high52 else None,
            "frgn_ntby_20d": int(f["frgn_ntby_qty"]) if f is not None else None,
            "orgn_ntby_20d": int(f["orgn_ntby_qty"]) if f is not None else None,
            "prsn_ntby_20d": int(f["prsn_ntby_qty"]) if f is not None else None,
        })
    return pd.DataFrame(rows)


# 조건 정의. 이름·설명·판정을 한곳에 모아 두면 화면과 결과 설명이 어긋나지 않는다.
# 각 조건은 (표, 기준값) → 불리언 시리즈.
CONDITIONS = {
    "above_ma20": {
        "label": "종가가 20일선 위",
        "test": lambda d, v: d["above_ma20"] if v else None,
    },
    "above_ma60": {
        "label": "종가가 60일선 위",
        "test": lambda d, v: d["above_ma60"] if v else None,
    },
    "turnover_ratio_min": {
        "label": "거래대금 5일÷60일 배율 이상",
        "test": lambda d, v: d["turnover_ratio"].fillna(0) >= v,
    },
    "disparity_max": {
        "label": "20일선 이격도 이하 (과열 제외)",
        "test": lambda d, v: d["disparity_20"].fillna(0) <= v,
    },
    "return_5d_max": {
        "label": "5일 상승률 이하 (급등 제외)",
        "test": lambda d, v: d["return_5d"].fillna(0) <= v,
    },
    "return_20d_min": {
        "label": "20일 수익률 이상",
        "test": lambda d, v: d["return_20d"].fillna(-999) >= v,
    },
    "from_high_min": {
        "label": "52주 고가 대비 이상",
        "test": lambda d, v: d["from_high_pct"].fillna(-999) >= v,
    },
    "frgn_buy": {
        "label": "외국인 20일 순매수",
        "test": lambda d, v: d["frgn_ntby_20d"].fillna(0) > 0 if v else None,
    },
    "orgn_buy": {
        "label": "기관 20일 순매수",
        "test": lambda d, v: d["orgn_ntby_20d"].fillna(0) > 0 if v else None,
    },
    "prsn_not_crowded": {
        "label": "개인 순매수 쏠림 아님",
        "test": lambda d, v: d["prsn_ntby_20d"].fillna(0) <= 0 if v else None,
    },
    "min_turnover": {
        "label": "최소 거래대금 이상",
        "test": lambda d, v: d["turnover_avg5"].fillna(0) >= v,
    },
    "sector": {
        "label": "섹터",
        "test": lambda d, v: d["sector"] == v,
    },
}


def scan(db: Session, universe: str | None, filters: dict, limit: int = 100) -> dict:
    """조건을 걸어 종목을 고른다.

    filters 는 CONDITIONS 의 키와 기준값. 값이 None 이거나 False 면 그 조건은 끈다.
    반환에는 조건별 통과 수(funnel)를 함께 담는다 — 어느 조건이 걸렀는지 보여야
    사용자가 조건을 조절할 수 있다.
    """
    table = _metrics(db, universe)
    if table.empty:
        return {"universe": universe, "total": 0, "matched": 0, "funnel": [], "rows": []}

    mask = pd.Series(True, index=table.index)
    funnel = []
    for key, value in filters.items():
        spec = CONDITIONS.get(key)
        if spec is None or value in (None, "", False):
            continue
        test = spec["test"](table, value)
        if test is None:
            continue
        mask &= test
        funnel.append({
            "key": key,
            "label": spec["label"],
            "value": str(value),
            "passed": int(test.sum()),      # 이 조건 하나만 걸었을 때 남는 수
            "remaining": int(mask.sum()),   # 여기까지 누적으로 걸렀을 때 남는 수
        })

    hit = table[mask].copy()
    # 수급이 있는 종목은 외국인 순매수 순으로, 없으면 거래대금 배율 순으로 줄을 세운다.
    sort_key = "frgn_ntby_20d" if hit["frgn_ntby_20d"].notna().any() else "turnover_ratio"
    hit = hit.sort_values(sort_key, ascending=False, na_position="last")

    return {
        "universe": universe,
        "total": int(len(table)),
        "matched": int(len(hit)),
        "funnel": funnel,
        "rows": hit.head(limit).where(pd.notna(hit.head(limit)), None).to_dict("records"),
    }
