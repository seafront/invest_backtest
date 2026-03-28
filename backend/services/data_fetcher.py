from datetime import date
import yfinance as yf
import pandas as pd
from sqlalchemy.orm import Session
from sqlalchemy import func
from models import Stock


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

    for _, row in df.iterrows():
        row_date = row["date"].date() if hasattr(row["date"], "date") else row["date"]
        existing = db.query(Stock).filter(
            Stock.ticker == ticker, Stock.date == row_date
        ).first()
        if existing:
            continue
        stock = Stock(
            ticker=ticker,
            date=row_date,
            open=round(float(row["open"]), 4),
            high=round(float(row["high"]), 4),
            low=round(float(row["low"]), 4),
            close=round(float(row["close"]), 4),
            volume=int(row["volume"]),
        )
        db.add(stock)

    db.commit()
    return df


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
    return [
        {
            "ticker": r.ticker,
            "start_date": r.start_date,
            "end_date": r.end_date,
            "count": r.count,
        }
        for r in results
    ]
