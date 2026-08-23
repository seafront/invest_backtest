from datetime import date, datetime
import yfinance as yf
import pandas as pd
from sqlalchemy.orm import Session
from sqlalchemy import func, insert
from models import Company, IndexMember, Stock


def fetch_and_cache(db: Session, ticker: str, start_date: date, end_date: date) -> pd.DataFrame:
    """Download OHLCV from yfinance and cache in DB. Returns DataFrame."""
    ticker = ticker.upper()
    df = yf.download(ticker, start=str(start_date), end=str(end_date), progress=False)

    if df.empty:
        raise ValueError(f"No data found for {ticker} in the given date range")

    # Flatten multi-level columns if present (yfinance 1.x returns MultiIndex with ticker)
    if isinstance(df.columns, pd.MultiIndex):
        # Extract only this ticker's data
        if ticker in df.columns.get_level_values(1):
            df = df.xs(ticker, level=1, axis=1)
        else:
            df.columns = df.columns.get_level_values(0)

    df = df.reset_index()
    df.columns = [c.lower() for c in df.columns]

    insert_rows(db, ticker, df)
    ensure_company_name(db, ticker)
    return df


def insert_rows(db: Session, ticker: str, df: pd.DataFrame) -> int:
    """OHLCV 프레임을 stocks에 밀어 넣는다. 이미 있는 (ticker, date)는 건너뛴다.

    중복 판정을 행마다 SELECT로 하지 않고 UNIQUE(ticker, date) 제약에 맡긴다.
    3만 행 기준으로 5,100행/초 → 174,000행/초, 34배 차이가 났다. 종목 몇 개일
    때는 티가 안 나지만 수백 종목을 받을 때는 이 차이가 분 단위로 벌어진다.
    """
    payload = []
    for _, row in df.iterrows():
        d = row["date"].date() if hasattr(row["date"], "date") else row["date"]
        vals = (row["open"], row["high"], row["low"], row["close"], row["volume"])
        if any(pd.isna(v) for v in vals):
            continue  # 상장 전이거나 거래정지된 날. 야후는 NaN으로 채워 보낸다.
        payload.append({
            "ticker": ticker,
            "date": d,
            "open": round(float(row["open"]), 4),
            "high": round(float(row["high"]), 4),
            "low": round(float(row["low"]), 4),
            "close": round(float(row["close"]), 4),
            "volume": int(row["volume"]),
        })

    if not payload:
        return 0
    before = db.query(Stock).filter(Stock.ticker == ticker).count()
    db.execute(insert(Stock).prefix_with("OR IGNORE"), payload)
    db.commit()
    after = db.query(Stock).filter(Stock.ticker == ticker).count()
    return after - before


def get_cached_data(db: Session, ticker: str, start_date: date | None = None, end_date: date | None = None) -> pd.DataFrame:
    """Load cached OHLCV data from DB as DataFrame."""
    ticker = ticker.upper()
    query = db.query(Stock).filter(Stock.ticker == ticker)
    if start_date:
        query = query.filter(Stock.date >= start_date)
    if end_date:
        query = query.filter(Stock.date <= end_date)
    rows = query.order_by(Stock.date).all()
    if not rows:
        raise ValueError(f"No cached data for {ticker}. Fetch data first.")

    data = [
        {
            "date": r.date,
            "open": r.open,
            "high": r.high,
            "low": r.low,
            "close": r.close,
            "volume": r.volume,
        }
        for r in rows
    ]
    return pd.DataFrame(data)


def refresh_all(db: Session, start_date: date, end_date: date) -> list[dict]:
    """캐시된 모든 티커를 다시 받아온다. 티커별 결과를 리스트로 돌려준다.

    한 종목이 실패해도 나머지는 계속한다 — 상장폐지되었거나 야후에서
    심볼이 바뀐 종목 하나 때문에 전체가 멈추면 곤란하다.
    응답에는 새로 저장된 행 수만 담는다. 시세 전체를 돌려주면 수 MB가 된다.
    """
    results: list[dict] = []
    for row in list_cached_tickers(db):
        ticker = row["ticker"]
        before = db.query(Stock).filter(Stock.ticker == ticker).count()
        try:
            fetch_and_cache(db, ticker, start_date, end_date)
        except Exception as e:  # noqa: BLE001 - 티커별로 격리해 계속 진행한다
            db.rollback()
            results.append({"ticker": ticker, "added": 0, "count": before, "error": str(e)[:200]})
            continue
        after = db.query(Stock).filter(Stock.ticker == ticker).count()
        results.append({"ticker": ticker, "added": after - before, "count": after, "error": None})
    return results


def ensure_company_name(db: Session, ticker: str) -> str | None:
    """이름이 아직 없는 티커만 yfinance로 한 번 조회해 채운다.

    .info는 종목당 1초쯤 걸리므로 지수 구성종목은 이 경로를 타지 않는다 —
    그쪽은 구성종목 표에서 이름을 이미 받아 왔다. 여기 걸리는 건
    사용자가 직접 넣은 소수 종목(지수 ETF, 해외 종목 등)뿐이다.
    """
    row = db.query(Company).filter(Company.ticker == ticker).first()
    if row:
        return row.name
    try:
        info = yf.Ticker(ticker).info
        name = info.get("longName") or info.get("shortName")
    except Exception:  # noqa: BLE001 - 이름은 부가 정보다. 실패해도 시세 저장을 막지 않는다
        return None
    if not name:
        return None
    db.execute(insert(Company).prefix_with("OR IGNORE"),
               [{"ticker": ticker, "name": name, "updated_at": datetime.utcnow()}])
    db.commit()
    return name


def sync_universe(db: Session, universe: str) -> int:
    """지수 구성종목과 회사 이름을 DB에 반영한다. 시세는 건드리지 않는다.

    편입/편출이 있으므로 해당 지수의 기존 행을 지우고 다시 넣는다.
    이름은 지수에서 빠져도 남겨 둔다 — 시세는 캐시에 그대로 있기 때문이다.
    """
    from services.universe import constituents  # 순환 import 회피

    pairs = constituents(universe, refresh=True)
    now = datetime.utcnow()

    db.query(IndexMember).filter(IndexMember.universe == universe).delete()
    db.execute(
        insert(IndexMember),
        [{"universe": universe, "ticker": sym, "updated_at": now} for sym, _ in pairs],
    )

    known = {c.ticker for c in db.query(Company.ticker).all()}
    fresh = [{"ticker": sym, "name": name, "updated_at": now}
             for sym, name in pairs if name and sym not in known]
    if fresh:
        db.execute(insert(Company).prefix_with("OR IGNORE"), fresh)
    db.commit()
    return len(pairs)


def list_cached_tickers(db: Session) -> list[dict]:
    """List all tickers with their cached date ranges."""
    results = (
        db.query(
            Stock.ticker,
            func.min(Stock.date).label("start_date"),
            func.max(Stock.date).label("end_date"),
            func.count(Stock.id).label("count"),
        )
        .group_by(Stock.ticker)
        .all()
    )
    names = {c.ticker: c.name for c in db.query(Company).all()}
    members: dict[str, list[str]] = {}
    for m in db.query(IndexMember).all():
        members.setdefault(m.ticker, []).append(m.universe)

    return [
        {
            "ticker": r.ticker,
            "start_date": r.start_date,
            "end_date": r.end_date,
            "count": r.count,
            "name": names.get(r.ticker),
            "universes": sorted(members.get(r.ticker, [])),
        }
        for r in results
    ]
