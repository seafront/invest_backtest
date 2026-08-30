"""분기 재무 수집.

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


def sync(db: Session, ticker: str) -> dict:
    """최근 분기들을 받아 저장한다. 이미 있는 분기는 값이 바뀌었을 수 있어 갱신한다."""
    ticker = ticker.upper()
    t = yf.Ticker(ticker)
    income = t.quarterly_income_stmt
    if income is None or income.empty:
        raise ValueError(f"{ticker}: 분기 재무를 받지 못했습니다")
    balance = t.quarterly_balance_sheet
    cash = t.quarterly_cashflow

    existing = {f.period_end: f for f in db.query(Fundamental).filter(Fundamental.ticker == ticker).all()}
    added = updated = 0

    for column in income.columns:
        period_end = pd.Timestamp(column).date()
        row = {"ticker": ticker, "period_end": period_end, "updated_at": datetime.utcnow()}
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
                if key not in ("ticker", "period_end"):
                    setattr(current, key, value)
            updated += 1

    db.commit()
    return {"ticker": ticker, "added": added, "updated": updated, **coverage(db, ticker)}


def coverage(db: Session, ticker: str) -> dict:
    row = db.query(
        func.count(Fundamental.id), func.min(Fundamental.period_end), func.max(Fundamental.period_end)
    ).filter(Fundamental.ticker == ticker.upper()).one()
    return {"count": row[0], "first_period": row[1], "last_period": row[2]}


def get(db: Session, ticker: str) -> list[Fundamental]:
    return (
        db.query(Fundamental)
        .filter(Fundamental.ticker == ticker.upper())
        .order_by(Fundamental.period_end)
        .all()
    )
