from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from schemas import StockFetchRequest, StockData, TickerInfo
from services.data_fetcher import fetch_and_cache, get_cached_data, list_cached_tickers

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


@router.get("/", response_model=list[TickerInfo])
def list_tickers(db: Session = Depends(get_db)):
    return list_cached_tickers(db)
