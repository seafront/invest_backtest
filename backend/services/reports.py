"""주기별 시장 리포트.

같은 시장도 보는 창의 길이에 따라 정반대로 읽힌다. 실제로 오늘 기준 코스피 200은
하루로는 146종목이 올랐고 한 달 중앙값이 +13%인데, 분기로 넓히면 중앙값 −5.9%에
상승 종목이 71개뿐이다. 고점에서 밀린 뒤 회복 중이라는 뜻인데, 한 창만 보면 시장을
반대로 읽는다. 주기를 나누는 이유가 이것이다.

모든 주기가 같은 항목을 본다 — 다른 것은 창의 길이뿐이다. 그래야 "지난주엔 이랬는데
이번 달로 보면 다르다"를 같은 잣대로 비교할 수 있다.
"""
from datetime import date

import pandas as pd
from sqlalchemy.orm import Session

PERIODS = {
    "daily": {"label": "일간", "days": 1, "note": "직전 거래일 대비"},
    "weekly": {"label": "주간", "days": 5, "note": "최근 5거래일"},
    "monthly": {"label": "월간", "days": 20, "note": "최근 20거래일"},
    "quarterly": {"label": "분기", "days": 60, "note": "최근 60거래일"},
}

LOOKBACK = 400  # 52주 고가·저가와 직전 창 비교에 필요한 여유
TOP_N = 10


def _frames(db: Session, universe: str) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    prices = pd.read_sql(
        """
        select s.ticker, s.date, s.close, s.volume
        from stocks s
        join index_members m on m.ticker = s.ticker and m.universe = :universe
        where s.date >= date((select max(date) from stocks), '-{} day')
        """.format(LOOKBACK),
        db.bind, params={"universe": universe}, parse_dates=["date"],
    )
    flows = pd.read_sql(
        """
        select f.ticker, f.date, f.frgn_ntby_qty, f.orgn_ntby_qty, f.prsn_ntby_qty
        from investor_flows f
        join index_members m on m.ticker = f.ticker and m.universe = :universe
        """,
        db.bind, params={"universe": universe}, parse_dates=["date"],
    )
    meta = pd.read_sql(
        """
        select c.ticker, c.name, c.sector, c.industry_krx, c.industry
        from companies c
        join index_members m on m.ticker = c.ticker and m.universe = :universe
        """,
        db.bind, params={"universe": universe},
    )
    return prices, flows, meta


def _f(value, digits: int = 2) -> float | None:
    """NaN은 JSON으로 나갈 수 없다. 최근 상장 종목은 창 시작 시점 종가가 없어
    수익률이 NaN이 되는데, S&P 500처럼 종목이 많으면 반드시 섞여 든다."""
    if value is None or pd.isna(value):
        return None
    return round(float(value), digits)


def _rows(frame: pd.DataFrame, meta: pd.DataFrame, value_columns: list[str], n: int = TOP_N,
          ascending: bool = False, sort_by: str | None = None) -> list[dict]:
    """상·하위 목록을 회사 이름과 함께 만든다."""
    key = sort_by or value_columns[0]
    picked = frame.sort_values(key, ascending=ascending).head(n)
    joined = picked.merge(meta, on="ticker", how="left")
    out = []
    for _, r in joined.iterrows():
        row = {
            "ticker": r["ticker"],
            "name": r.get("name"),
            "industry": r.get("industry_krx") or r.get("industry") or r.get("sector"),
        }
        for col in value_columns:
            value = r.get(col)
            row[col] = None if pd.isna(value) else round(float(value), 2)
        out.append(row)
    return out


def build(db: Session, period: str, universe: str = "kospi200") -> dict:
    spec = PERIODS.get(period)
    if spec is None:
        raise ValueError(f"알 수 없는 주기: {period}. 사용 가능: {', '.join(PERIODS)}")

    prices, flows, meta = _frames(db, universe)
    if prices.empty:
        raise ValueError(f"{universe}: 시세가 없습니다. 먼저 수집하세요.")

    n = spec["days"]
    wide = prices.pivot(index="date", columns="ticker", values="close").sort_index()
    volume = prices.pivot(index="date", columns="ticker", values="volume").sort_index()

    # 대부분의 종목이 거래하지 않은 날짜는 이 시장의 거래일이 아니다. 실제로 S&P 500에서
    # HUBB 한 종목만 하루치가 더 있었고, 그 행이 마지막이 되면서 나머지 502종목의
    # 수익률이 전부 NaN이 됐다. 절반도 안 채운 날짜는 달력에서 뺀다.
    covered = wide.notna().sum(axis=1) >= max(1, wide.shape[1] * 0.5)
    wide = wide[covered]
    volume = volume.reindex(wide.index)
    turnover = wide * volume
    if len(wide) <= n:
        raise ValueError(f"{period}: 거래일이 부족합니다 ({len(wide)}일)")

    last = wide.index[-1].date()
    base_idx = -1 - n
    ret = (wide.iloc[-1] / wide.iloc[base_idx] - 1) * 100
    prev_ret = (
        (wide.iloc[base_idx] / wide.iloc[base_idx - n] - 1) * 100
        if len(wide) > 2 * n + 1 else None
    )

    ma20 = wide.rolling(20).mean().iloc[-1]
    high52 = wide.tail(252).max()
    low52 = wide.tail(252).min()
    latest = wide.iloc[-1]

    breadth = {
        "advancing": int((ret > 0).sum()),
        "declining": int((ret < 0).sum()),
        "unchanged": int((ret == 0).sum()),
        "total": int(ret.notna().sum()),
        "median_return": _f(ret.median()),
        "above_ma20": int((latest > ma20).sum()),
        "above_ma20_pct": round(float((latest > ma20).mean() * 100), 1),
        "new_high_52w": int((latest >= high52).sum()),
        "new_low_52w": int((latest <= low52).sum()),
    }

    # 거래대금은 종가×거래량 근사치라 배율로만 쓴다. 창 평균을 20일 평균과 견준다.
    surge = pd.DataFrame({
        "turnover_ratio": turnover.tail(n).mean() / turnover.tail(20).mean(),
        "return_pct": ret,
    }).replace([float("inf")], None).dropna(subset=["turnover_ratio"])

    movers = pd.DataFrame({"return_pct": ret}).dropna()

    # --- 수급: 창 길이만큼의 누적 ---
    flow_section: dict = {"available": False}
    if not flows.empty:
        recent = flows.sort_values("date").groupby("ticker").tail(n)
        agg = recent.groupby("ticker")[["frgn_ntby_qty", "orgn_ntby_qty", "prsn_ntby_qty"]].sum()
        agg = agg.join(pd.DataFrame({"return_pct": ret}), how="left")
        both = agg[(agg.frgn_ntby_qty > 0) & (agg.orgn_ntby_qty > 0)]
        cols = ["frgn_ntby_qty", "orgn_ntby_qty", "prsn_ntby_qty", "return_pct"]
        flow_section = {
            "available": True,
            "days": int(recent.groupby("ticker").size().max()),
            "both_buy_count": int(len(both)),
            "top_foreign": _rows(agg.reset_index(), meta, cols, sort_by="frgn_ntby_qty"),
            "bottom_foreign": _rows(agg.reset_index(), meta, cols, sort_by="frgn_ntby_qty", ascending=True),
            "both_buy": _rows(both.reset_index(), meta, cols, sort_by="frgn_ntby_qty"),
        }

    # --- 업종: 이번 창과 직전 창을 나란히 둬 자금 이동을 본다 ---
    sector_rows: list[dict] = []
    # 시장에 따라 묶는 층이 다르다. 미국은 GICS 섹터(11종)로 묶는다 — 하위산업은
    # 163종이라 종목 한둘짜리 그룹만 쏟아져 업종 흐름이 보이지 않는다. 한국은
    # 섹터가 비어 있고 KRX 업종이 그 자리를 대신한다.
    indexed = meta.set_index("ticker")
    industry = indexed["sector"].fillna(indexed["industry_krx"]).fillna(indexed["industry"])
    # 수익률이 없는 종목(최근 상장 등)은 업종 집계에서 뺀다. 남겨 두면 중앙값이 NaN이 된다.
    table = pd.DataFrame({"ret": ret, "industry": industry}).dropna(subset=["industry", "ret"])
    if prev_ret is not None:
        table["prev"] = prev_ret
    if not flows.empty:
        table = table.join(
            flows.sort_values("date").groupby("ticker").tail(n)
            .groupby("ticker")["frgn_ntby_qty"].sum().rename("frgn")
        )
    grouped = table.groupby("industry")
    for name, g in grouped:
        if len(g) < 2:      # 한 종목뿐인 업종은 업종 흐름이라 부르기 어렵다
            continue
        sector_rows.append({
            "industry": name,
            "count": int(len(g)),
            "median_return": _f(g["ret"].median()),
            "prev_median_return": _f(g["prev"].median()) if "prev" in g else None,
            "advancing": int((g["ret"] > 0).sum()),
            "frgn_ntby": int(g["frgn"].sum()) if "frgn" in g and g["frgn"].notna().any() else None,
        })
    sector_rows.sort(key=lambda r: r["median_return"] or -999, reverse=True)

    # --- 낙폭: 고점에서 얼마나 내려와 있나 ---
    drawdown = ((latest / high52 - 1) * 100).dropna()

    return {
        "period": period,
        "label": spec["label"],
        "note": spec["note"],
        "universe": universe,
        "as_of": last,
        "base_date": wide.index[base_idx].date(),
        "trading_days": n,
        "breadth": breadth,
        "movers": {
            "top": _rows(movers.reset_index(), meta, ["return_pct"]),
            "bottom": _rows(movers.reset_index(), meta, ["return_pct"], ascending=True),
        },
        "turnover_surge": _rows(
            surge.reset_index(), meta, ["turnover_ratio", "return_pct"], sort_by="turnover_ratio"
        ),
        "flows": flow_section,
        "sectors": sector_rows,
        "drawdown": {
            "median": _f(drawdown.median()),
            "within_5pct": int((drawdown >= -5).sum()),
            "below_20pct": int((drawdown <= -20).sum()),
        },
    }
