"""산업 안의 제품군별 경쟁 구도.

**이 표는 손으로 관리한다.** GICS도 KRX도 `Semiconductors`까지만 알려 주고 그 아래
DRAM·HBM·NAND를 나누지 않는다. 무료로 얻을 수 있는 정형 데이터가 없어 지식으로 채웠고,
그래서 시간이 지나면 낡는다. 분사·인수·신규 상장이 있으면 여기를 고쳐야 한다.

마지막 확인: 2026-08. 알려진 변화가 이미 반영돼 있다 —
웨스턴디지털의 낸드 사업은 SanDisk(SNDK)로 분사됐고, Kioxia(285A.T)는 2024-12 상장이라
그 이전 주가가 없다. 비상장사(CXMT, YMTC)는 주가로 추적할 수 없어 이름만 적어 둔다.

금액은 시장마다 통화가 다르다(원·달러·엔·대만달러). 매출 절대액을 나란히 놓으면
안 되고 증가율과 이익률로만 비교한다. API 응답에도 금액은 담지 않는다.
"""
from datetime import date, timedelta

import pandas as pd
from sqlalchemy.orm import Session

from models import Company, Fundamental, InvestorFlow, Snapshot, Stock

INDUSTRIES: dict[str, dict] = {
    "semiconductor": {
        "label": "반도체",
        "note": "메모리 3사와 제품군별 경쟁사. 제품군 구분은 손으로 관리하는 표다.",
        "groups": [
            {
                "key": "dram",
                "label": "DRAM",
                "note": "삼성전자·SK하이닉스·마이크론 3사 과점. 대만 Nanya가 뒤를 잇고, "
                        "중국 CXMT는 비상장이라 주가로 추적할 수 없다.",
                "members": ["005930.KS", "000660.KS", "MU", "2408.TW"],
                "unlisted": ["CXMT (창신메모리, 비상장)"],
            },
            {
                "key": "hbm",
                "label": "HBM",
                "note": "고대역폭 메모리는 DRAM 3사만 양산한다. 진입 장벽이 높아 "
                        "경쟁자가 가장 적고, 엔비디아 공급 지위가 주가를 좌우해 왔다.",
                "members": ["000660.KS", "005930.KS", "MU"],
                "unlisted": [],
            },
            {
                "key": "nand",
                "label": "NAND",
                "note": "경쟁자가 가장 많은 제품군. SanDisk는 2025년 웨스턴디지털에서 "
                        "분사해 그 이전 이력이 WDC에 남아 있다.",
                "members": ["005930.KS", "000660.KS", "MU", "285A.T", "SNDK", "WDC"],
                "unlisted": ["YMTC (양쯔메모리, 비상장)"],
            },
        ],
    },
}

PRICE_LOOKBACK = 400  # 1년 수익률과 52주 고가를 내려면 이 정도 여유가 필요하다
FLOW_WINDOW = 20


def _price_metrics(db: Session, tickers: list[str]) -> dict[str, dict]:
    frame = pd.read_sql(
        """
        select ticker, date, close
        from stocks
        where ticker in ({}) and date >= date((select max(date) from stocks), '-{} day')
        """.format(",".join(f"'{t}'" for t in tickers), PRICE_LOOKBACK),
        db.bind, parse_dates=["date"],
    )
    out: dict[str, dict] = {}
    for ticker, g in frame.groupby("ticker"):
        g = g.sort_values("date")
        close = g["close"]
        last = float(close.iloc[-1])

        def ret(n: int) -> float | None:
            return round((last / close.iloc[-1 - n] - 1) * 100, 2) if len(close) > n else None

        high52 = float(close.tail(252).max())
        daily = close.pct_change().dropna()
        out[ticker] = {
            "close": round(last, 4),
            "as_of": g["date"].iloc[-1].date(),
            "return_20d": ret(20),
            "return_60d": ret(60),
            "return_252d": ret(252),
            "from_high_pct": round((last / high52 - 1) * 100, 2) if high52 else None,
            "volatility_60d": (
                round(float(daily.tail(60).std() * (252 ** 0.5) * 100), 2)
                if len(daily) >= 60 else None
            ),
        }
    return out


def _fundamental_metrics(db: Session, tickers: list[str]) -> dict[str, dict]:
    """비율만 낸다. 통화가 달라 금액은 비교 대상이 아니다."""
    rows = (
        db.query(Fundamental)
        .filter(Fundamental.ticker.in_(tickers))
        .order_by(Fundamental.ticker, Fundamental.period_end)
        .all()
    )
    grouped: dict[str, list[Fundamental]] = {}
    for r in rows:
        grouped.setdefault(r.ticker, []).append(r)

    def ratio(num, den):
        return round(num / den * 100, 2) if num is not None and den else None

    out: dict[str, dict] = {}
    for ticker, items in grouped.items():
        latest = items[-1]
        prev = items[-2] if len(items) > 1 else None
        year_ago = items[-5] if len(items) >= 5 else None

        op_margin = ratio(latest.operating_income, latest.revenue)
        prev_margin = ratio(prev.operating_income, prev.revenue) if prev else None
        out[ticker] = {
            "period_end": latest.period_end,
            "quarters": len(items),
            "operating_margin": op_margin,
            "operating_margin_delta": (
                round(op_margin - prev_margin, 2)
                if op_margin is not None and prev_margin is not None else None
            ),
            "gross_margin": ratio(latest.gross_profit, latest.revenue),
            "revenue_qoq": (
                ratio(latest.revenue - prev.revenue, prev.revenue)
                if prev and prev.revenue and latest.revenue else None
            ),
            "revenue_yoy": (
                ratio(latest.revenue - year_ago.revenue, year_ago.revenue)
                if year_ago and year_ago.revenue and latest.revenue else None
            ),
            # 재고가 매출보다 빨리 늘면 다음 분기 마진에 부담이 된다.
            "inventory_to_revenue": ratio(latest.inventory, latest.revenue),
            "ocf_to_revenue": ratio(latest.operating_cashflow, latest.revenue),
            "debt_to_equity": ratio(latest.total_debt, latest.equity),
        }
    return out


def _flow_metrics(db: Session, tickers: list[str]) -> dict[str, dict]:
    """수급은 한국 종목에만 있다. 없는 종목은 키 자체가 빠진다."""
    since = date.today() - timedelta(days=60)
    rows = (
        db.query(InvestorFlow)
        .filter(InvestorFlow.ticker.in_(tickers), InvestorFlow.date >= since)
        .order_by(InvestorFlow.ticker, InvestorFlow.date)
        .all()
    )
    grouped: dict[str, list[InvestorFlow]] = {}
    for r in rows:
        grouped.setdefault(r.ticker, []).append(r)

    out: dict[str, dict] = {}
    for ticker, items in grouped.items():
        recent = items[-FLOW_WINDOW:]
        out[ticker] = {
            "frgn_ntby_20d": sum(r.frgn_ntby_qty or 0 for r in recent),
            "orgn_ntby_20d": sum(r.orgn_ntby_qty or 0 for r in recent),
            "prsn_ntby_20d": sum(r.prsn_ntby_qty or 0 for r in recent),
        }
    return out


def _snapshot_metrics(db: Session, tickers: list[str]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for ticker in tickers:
        row = (
            db.query(Snapshot)
            .filter(Snapshot.ticker == ticker)
            .order_by(Snapshot.date.desc())
            .first()
        )
        if row:
            upside = (
                round((row.target_mean / row.close - 1) * 100, 2)
                if row.target_mean and row.close else None
            )
            out[ticker] = {
                "market_cap": row.market_cap,
                "per": row.per,
                "pbr": row.pbr,
                "target_upside": upside,
                "analyst_count": row.analyst_count,
                "recommendation": row.recommendation,
            }
    return out


def _rebased_series(db: Session, tickers: list[str], days: int = 252) -> list[dict]:
    """시작을 100으로 맞춘 주가 추이.

    통화가 달라 종가를 그대로 겹칠 수는 없지만, 같은 날을 100으로 두면 이후 흐름은
    비교할 수 있다. 표의 수익률 세 칸이 세 시점만 보여주는 데 비해, 선은 어느 시점에
    갈라졌는지를 드러낸다.

    거래일이 시장마다 다르다(한국·미국·일본·대만의 휴일이 제각각). 날짜를 합집합으로
    두고 빈 칸은 직전 값으로 채운다 — 남의 시장이 쉬는 날 그 종목의 값은 마지막 종가다.
    """
    if not tickers:
        return []
    frame = pd.read_sql(
        """
        select ticker, date, close from stocks
        where ticker in ({}) and date >= date((select max(date) from stocks), '-{} day')
        """.format(",".join(f"'{t}'" for t in tickers), int(days * 1.5)),
        db.bind, parse_dates=["date"],
    )
    if frame.empty:
        return []

    wide = frame.pivot(index="date", columns="ticker", values="close").sort_index()
    wide = wide.tail(days).ffill()
    # 구간 시작에 값이 없는 종목(상장이 늦은 경우)은 자기 첫 값을 기준으로 삼는다.
    base = wide.apply(lambda col: col.dropna().iloc[0] if col.notna().any() else None)
    rebased = wide.divide(base) * 100

    out = []
    for idx, row in rebased.iterrows():
        point = {"date": idx.date().isoformat()}
        for ticker in wide.columns:
            value = row[ticker]
            point[ticker] = None if pd.isna(value) else round(float(value), 2)
        out.append(point)
    return out


# 재무 추이로 그릴 지표들. 전부 비율이거나 정규화된 값이다 —
# 통화가 섞여 있어 금액을 그대로 그리면 큰 회사의 선만 보인다.
FINANCIAL_METRICS = {
    "operating_margin": {
        "label": "영업이익률",
        "unit": "%",
        "baseline": 0,
        "note": "매출에서 남는 몫. 메모리는 사이클 산업이라 네 회사가 함께 움직이는지가 관건이다.",
    },
    "revenue_rebased": {
        "label": "매출 (첫 분기=100)",
        "unit": "",
        "baseline": 100,
        "note": "통화가 달라 금액은 겹칠 수 없다. 첫 분기를 100으로 두면 성장 속도는 비교된다.",
    },
    "inventory_to_revenue": {
        "label": "재고 / 매출",
        "unit": "%",
        "baseline": None,
        "note": "재고가 매출보다 빨리 쌓이면 다음 분기 마진에 부담이 된다.",
    },
    "ocf_to_revenue": {
        "label": "영업현금 / 매출",
        "unit": "%",
        "baseline": 0,
        "note": "이익이 실제 현금으로 들어오는지 본다. 이익만 늘고 이 값이 안 따라오면 의심할 대목이다.",
    },
}


def _financial_series(db: Session, tickers: list[str]) -> dict[str, list[dict]]:
    """지표별 분기 시계열. 회사마다 결산월이 달라 각자의 기준일에 점을 찍는다."""
    rows = (
        db.query(Fundamental)
        .filter(Fundamental.ticker.in_(tickers))
        .order_by(Fundamental.ticker, Fundamental.period_end)
        .all()
    )
    grouped: dict[str, list[Fundamental]] = {}
    for r in rows:
        grouped.setdefault(r.ticker, []).append(r)

    def ratio(num, den):
        return round(num / den * 100, 2) if num is not None and den else None

    values: dict[str, dict[str, dict[str, float | None]]] = {k: {} for k in FINANCIAL_METRICS}
    for ticker, items in grouped.items():
        # 매출 정규화의 기준은 그 회사의 첫 분기다. 상장·분사로 시작점이 달라도
        # 각자의 출발선에서 얼마나 늘었는지는 비교할 수 있다.
        base = next((i.revenue for i in items if i.revenue), None)
        for item in items:
            key = item.period_end.isoformat()
            values["operating_margin"].setdefault(key, {})[ticker] = ratio(item.operating_income, item.revenue)
            values["revenue_rebased"].setdefault(key, {})[ticker] = (
                round(item.revenue / base * 100, 2) if base and item.revenue else None
            )
            values["inventory_to_revenue"].setdefault(key, {})[ticker] = ratio(item.inventory, item.revenue)
            values["ocf_to_revenue"].setdefault(key, {})[ticker] = ratio(item.operating_cashflow, item.revenue)

    return {
        metric: [{"date": d, **by_ticker} for d, by_ticker in sorted(rows_by_date.items())]
        for metric, rows_by_date in values.items()
    }


def overview(db: Session, industry: str) -> dict:
    spec = INDUSTRIES.get(industry)
    if spec is None:
        raise ValueError(f"알 수 없는 산업: {industry}. 사용 가능: {', '.join(INDUSTRIES)}")

    tickers = sorted({t for g in spec["groups"] for t in g["members"]})
    names = {c.ticker: c.name for c in db.query(Company).filter(Company.ticker.in_(tickers)).all()}
    cached = {
        t for (t,) in db.query(Stock.ticker).filter(Stock.ticker.in_(tickers)).distinct().all()
    }

    prices = _price_metrics(db, sorted(cached)) if cached else {}
    funds = _fundamental_metrics(db, tickers)
    flows = _flow_metrics(db, tickers)
    snaps = _snapshot_metrics(db, tickers)

    groups = []
    for g in spec["groups"]:
        members = []
        for ticker in g["members"]:
            members.append({
                "ticker": ticker,
                "name": names.get(ticker),
                "cached": ticker in cached,
                "price": prices.get(ticker),
                "fundamental": funds.get(ticker),
                "flow": flows.get(ticker),
                "snapshot": snaps.get(ticker),
            })
        listed = [t for t in g["members"] if t in cached]
        groups.append({
            **{k: g[k] for k in ("key", "label", "note", "unlisted")},
            "members": members,
            "price_series": _rebased_series(db, listed),
            "financial_series": _financial_series(db, g["members"]),
        })

    return {
        "industry": industry,
        "label": spec["label"],
        "note": spec["note"],
        "metrics": [{"key": k, **v} for k, v in FINANCIAL_METRICS.items()],
        "groups": groups,
    }
