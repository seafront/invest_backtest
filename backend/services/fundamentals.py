"""yfinance 재무 수집.

yfinance의 분기 재무제표 세 장(손익·재무상태·현금흐름)을 한 행으로 합친다.
호출 세 번에 약 2초라 종목당 비용이 작지 않다 — 720종목을 한 번에 받으면 30분쯤
걸리므로, 화면에서 필요할 때 종목 단위로 받는 것을 기본으로 한다.

행 이름은 yfinance가 회사·시장에 따라 조금씩 다르게 준다. 그래서 후보를 나열해 두고
먼저 잡히는 것을 쓴다. 없으면 None으로 남긴다 — 빈 값이 0으로 둔갑하면 마진 계산이
조용히 틀어진다.
"""
from datetime import datetime

import pandas as pd
import yfinance as yf
from sqlalchemy import func, insert
from sqlalchemy.orm import Session

from models import Fundamental

# 컬럼 → yfinance 행 이름 후보. 앞에서부터 찾는다.
INCOME = {
    "revenue": ["Total Revenue", "Operating Revenue"],
    "gross_profit": ["Gross Profit"],
    "operating_income": ["Operating Income", "Total Operating Income As Reported"],
    "net_income": ["Net Income", "Net Income Common Stockholders"],
}
BALANCE = {
    "inventory": ["Inventory"],
    "receivables": ["Accounts Receivable", "Receivables"],
    "total_assets": ["Total Assets"],
    "total_debt": ["Total Debt"],
    "equity": ["Stockholders Equity", "Total Equity Gross Minority Interest"],
}
CASHFLOW = {
    "operating_cashflow": ["Operating Cash Flow", "Cash Flow From Continuing Operating Activities"],
    "free_cashflow": ["Free Cash Flow"],
}


def _pick(frame: pd.DataFrame, names: list[str], column) -> float | None:
    for name in names:
        if name in frame.index:
            value = frame.loc[name, column]
            if pd.notna(value):
                return float(value)
    return None


# 주기별로 yfinance가 노출하는 속성 이름이 다르다.
STATEMENTS = {
    "quarterly": ("quarterly_income_stmt", "quarterly_balance_sheet", "quarterly_cashflow"),
    "annual": ("income_stmt", "balance_sheet", "cashflow"),
}


def sync(db: Session, ticker: str, period_type: str = "quarterly") -> dict:
    """최근 기간들을 받아 저장한다. 이미 있는 기간은 값이 바뀌었을 수 있어 갱신한다."""
    if period_type not in STATEMENTS:
        raise ValueError(f"알 수 없는 주기: {period_type}")
    ticker = ticker.upper()
    t = yf.Ticker(ticker)
    income_attr, balance_attr, cash_attr = STATEMENTS[period_type]
    income = getattr(t, income_attr)
    if income is None or income.empty:
        raise ValueError(f"{ticker}: {period_type} 재무를 받지 못했습니다")
    balance = getattr(t, balance_attr)
    cash = getattr(t, cash_attr)

    existing = {f.period_end: f for f in db.query(Fundamental).filter(
        Fundamental.ticker == ticker, Fundamental.period_type == period_type).all()}
    added = updated = 0

    for column in income.columns:
        period_end = pd.Timestamp(column).date()
        row = {"ticker": ticker, "period_end": period_end, "period_type": period_type,
               "source": "yfinance", "unit_scale": 1.0, "updated_at": datetime.utcnow()}
        for field, names in INCOME.items():
            row[field] = _pick(income, names, column)
        for frame, spec in ((balance, BALANCE), (cash, CASHFLOW)):
            for field, names in spec.items():
                # 재무상태표·현금흐름표는 손익과 열이 다를 수 있다. 같은 분기가 없으면 비운다.
                row[field] = (
                    _pick(frame, names, column)
                    if frame is not None and not frame.empty and column in frame.columns
                    else None
                )

        current = existing.get(period_end)
        if current is None:
            db.add(Fundamental(**row))
            added += 1
        else:
            # 잠정치가 확정치로 바뀌는 일이 있어 덮어쓴다.
            for key, value in row.items():
                if key not in ("ticker", "period_end", "period_type"):
                    setattr(current, key, value)
            updated += 1

    db.commit()
    return {"ticker": ticker, "added": added, "updated": updated,
            **coverage(db, ticker, period_type)}


# 저장값에 곱해야 실제 금액이 되는 항목. 비율(roe)과 주당 금액(eps·bps)은
# 소스와 무관하게 이미 최종 단위라 건드리지 않는다.
SCALED_FIELDS = (
    "revenue", "gross_profit", "operating_income", "net_income",
    "inventory", "receivables", "total_assets", "total_debt", "equity",
    "operating_cashflow", "free_cashflow",
)

# 통화는 상장 시장에서 정해진다. 금액 자체로는 원인지 달러인지 알 수 없고,
# 접미사 없는 티커는 미국 상장이다.
CURRENCY_BY_SUFFIX = {"KS": "KRW", "KQ": "KRW", "T": "JPY", "TW": "TWD", "HK": "HKD"}


def currency_of(ticker: str) -> str:
    suffix = ticker.upper().rsplit(".", 1)
    return CURRENCY_BY_SUFFIX.get(suffix[1], "USD") if len(suffix) == 2 else "USD"


def serialize(rows: list[Fundamental]) -> list[dict]:
    """저장 행을 응답 형태로 편다.

    테이블은 항상 기준 단위(원·달러)로 담기므로 unit_scale은 1.0이다. 곱셈을 남겨
    두는 것은 다른 단위로 저장하는 소스가 생겼을 때 여기 한 곳만 고치면 되게 하기
    위해서다 — 읽는 쪽마다 곱하게 하면 반드시 한 곳을 빠뜨린다.
    """
    out = []
    for row in rows:
        scale = row.unit_scale or 1.0
        item = {
            "period_end": row.period_end,
            "period_type": row.period_type or "quarterly",
            "source": row.source or "yfinance",
            "roe": row.roe, "eps": row.eps, "bps": row.bps,
        }
        for field in SCALED_FIELDS:
            value = getattr(row, field, None)
            item[field] = None if value is None else value * scale
        out.append(item)
    return out


def sync_best(db: Session, ticker: str) -> dict:
    """그 종목에 가장 깊은 소스를 골라 받는다.

    한국 종목은 KIS가 분기 30개·연간 23개를 주고, yfinance는 5개에서 멈춘다.
    미국 종목은 KIS가 다루지 않으므로 yfinance뿐이다. 화면이 소스를 고르게 하면
    "왜 종목마다 다르지"라는 질문이 생기므로 여기서 정한다.
    """
    from services import kis_client, kis_fundamentals

    ticker = ticker.upper()
    if ticker.endswith((".KS", ".KQ")) and kis_client.config()["configured"]:
        quarterly = kis_fundamentals.sync(db, ticker, "quarterly")
        annual = kis_fundamentals.sync(db, ticker, "annual")
        return {
            "ticker": ticker,
            "source": "kis",
            "added": quarterly["added"] + annual["added"],
            "updated": quarterly["updated"] + annual["updated"],
            **coverage(db, ticker),
        }
    quarterly = sync(db, ticker, "quarterly")
    added, updated = quarterly["added"], quarterly["updated"]
    try:
        annual = sync(db, ticker, "annual")
        added, updated = added + annual["added"], updated + annual["updated"]
    except Exception:  # noqa: BLE001
        # 연간이 없는 종목도 있다. 분기를 받았으면 그것만으로 화면은 채워진다.
        pass
    return {"ticker": ticker, "source": "yfinance", "added": added, "updated": updated,
            **coverage(db, ticker)}


def coverage(db: Session, ticker: str, period_type: str = "quarterly") -> dict:
    row = db.query(
        func.count(Fundamental.id), func.min(Fundamental.period_end), func.max(Fundamental.period_end)
    ).filter(Fundamental.ticker == ticker.upper(), Fundamental.period_type == period_type).one()
    return {"count": row[0], "first_period": row[1], "last_period": row[2]}


def get(db: Session, ticker: str, period_type: str = "quarterly") -> list[Fundamental]:
    return (
        db.query(Fundamental)
        .filter(Fundamental.ticker == ticker.upper(), Fundamental.period_type == period_type)
        .order_by(Fundamental.period_end)
        .all()
    )
