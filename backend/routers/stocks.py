from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from schemas import StockFetchRequest, StockData, StockStats, TickerInfo
from services.data_fetcher import fetch_and_cache, get_cached_data, list_cached_tickers
from services.market_stats import compute_stats

router = APIRouter(prefix="/api/stocks", tags=["stocks"])


@router.post("/fetch", response_model=list[StockData])
def fetch_stock_data(req: StockFetchRequest, db: Session = Depends(get_db)):
    try:
        df = fetch_and_cache(db, req.ticker, req.start_date, req.end_date)
        data = get_cached_data(db, req.ticker, req.start_date, req.end_date)
        return data.to_dict(orient="records")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{ticker}", response_model=list[StockData])
def get_stock_data(ticker: str, db: Session = Depends(get_db)):
    try:
        df = get_cached_data(db, ticker, None, None)
        return df.to_dict(orient="records")
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/{ticker}/stats", response_model=StockStats)
def get_stock_stats(ticker: str, db: Session = Depends(get_db)):
    """전략과 무관한 시장 통계 — 낙폭 곡선, 연도별 수익률, 약세장 이벤트."""
    try:
        df = get_cached_data(db, ticker, None, None)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    try:
        return compute_stats(df, ticker)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/", response_model=list[TickerInfo])
def list_tickers(db: Session = Depends(get_db)):
    return list_cached_tickers(db)
