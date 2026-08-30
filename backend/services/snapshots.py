"""일별 스냅샷 수집.

시세·재무와 성격이 다르다. 저쪽은 언제든 과거를 다시 받을 수 있지만, 목표주가와
시가총액은 API가 현재 값만 준다. 오늘 찍지 않으면 오늘의 값은 사라진다.

종목당 약 1초(.info 호출)라 720종목이면 12분이다. 그래서 유니버스 단위로 백그라운드에서
돌리는 것을 전제로 만든다. 같은 날 다시 돌려도 덮어쓸 뿐 행이 늘지 않는다.
"""
from datetime import date, datetime

import yfinance as yf
from sqlalchemy import func
from sqlalchemy.orm import Session

from models import Snapshot

FIELDS = {
    "market_cap": ("marketCap",),
    "per": ("trailingPE", "forwardPE"),
    "pbr": ("priceToBook",),
    "target_mean": ("targetMeanPrice",),
    "target_high": ("targetHighPrice",),
    "target_low": ("targetLowPrice",),
    "analyst_count": ("numberOfAnalystOpinions",),
}


def _first(info: dict, keys: tuple[str, ...]) -> float | None:
    for k in keys:
        v = info.get(k)
        if isinstance(v, (int, float)) and v == v:  # NaN 제외
            return float(v)
    return None


def capture(db: Session, ticker: str, on: date | None = None) -> dict:
    """한 종목의 오늘 값을 찍는다. 같은 날 두 번 찍으면 덮어쓴다."""
    ticker = ticker.upper()
    on = on or date.today()
    info = yf.Ticker(ticker).info or {}

    values = {field: _first(info, keys) for field, keys in FIELDS.items()}
    values["close"] = _first(info, ("currentPrice", "regularMarketPrice", "previousClose"))
    values["recommendation"] = info.get("recommendationKey") or None
    if values["analyst_count"] is not None:
        values["analyst_count"] = int(values["analyst_count"])

    row = db.query(Snapshot).filter(Snapshot.ticker == ticker, Snapshot.date == on).first()
    if row is None:
        db.add(Snapshot(ticker=ticker, date=on, **values))
        created = True
    else:
        for k, v in values.items():
            setattr(row, k, v)
        created = False
    db.commit()
    return {"ticker": ticker, "date": on, "created": created, **values}


def coverage(db: Session, ticker: str) -> dict:
    row = db.query(
        func.count(Snapshot.id), func.min(Snapshot.date), func.max(Snapshot.date)
    ).filter(Snapshot.ticker == ticker.upper()).one()
    return {"count": row[0], "start_date": row[1], "end_date": row[2]}


def get(db: Session, ticker: str) -> list[Snapshot]:
    return (
        db.query(Snapshot)
        .filter(Snapshot.ticker == ticker.upper())
        .order_by(Snapshot.date)
        .all()
    )


def capture_many(db: Session, tickers: list[str], progress=None) -> dict:
    """여러 종목을 순서대로 찍는다. 하나가 실패해도 나머지는 계속한다."""
    done = failed = 0
    errors: list[str] = []
    for ticker in tickers:
        try:
            capture(db, ticker)
        except Exception as e:  # noqa: BLE001 - 스냅샷은 부가 정보다. 하나 때문에 멈추지 않는다
            db.rollback()
            failed += 1
            if len(errors) < 20:
                errors.append(f"{ticker}: {str(e)[:60]}")
        else:
            done += 1
        if progress:
            progress(done + failed, len(tickers))
    return {"done": done, "failed": failed, "errors": errors,
            "captured_at": datetime.utcnow().isoformat()}
