from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from database import get_db
from schemas import ScanRequest, ScanResponse
from services import screener_scan
from services.screener import screen_by_market_cap, screen_by_strategy, DEFAULT_POOL

router = APIRouter(prefix="/api/screening", tags=["screening"])


class MarketCapRequest(BaseModel):
    pool: list[str] | None = None
    top_n: int = 5


class MarketCapResult(BaseModel):
    ticker: str
    market_cap: float
    market_cap_str: str


class FullScreenRequest(BaseModel):
    pool: list[str] | None = None
    market_cap_top: int = 5
    strategy_top: int = 2
    start_date: date = date(2022, 1, 1)
    end_date: date = date(2024, 12, 31)
    initial_capital: float = 100000.0


class StrategyResult(BaseModel):
    ticker: str
    strategy_name: str
    strategy_display: str
    total_return: float
    sharpe_ratio: float
    max_drawdown: float
    win_rate: float
    trades_count: int


class FullScreenResponse(BaseModel):
    market_cap_top: list[MarketCapResult]
    all_results: list[StrategyResult]
    top_picks: list[StrategyResult]


@router.get("/pool")
def get_default_pool():
    """Return the default stock pool."""
    return {"pool": DEFAULT_POOL, "count": len(DEFAULT_POOL)}


@router.post("/market-cap", response_model=list[MarketCapResult])
def screen_market_cap(req: MarketCapRequest):
    """Step 1: Screen by market cap, return top N."""
    try:
        results = screen_by_market_cap(req.pool, req.top_n)
        if not results:
            raise HTTPException(status_code=400, detail="Could not fetch market cap data")
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/full", response_model=FullScreenResponse)
def full_screening(req: FullScreenRequest, db: Session = Depends(get_db)):
    """
    Full 2-step screening:
    1. Market cap top N
    2. Run all strategies on those tickers, pick top M by return
    """
    # Step 1: Market cap filtering
    market_cap_results = screen_by_market_cap(req.pool, req.market_cap_top)
    if not market_cap_results:
        raise HTTPException(status_code=400, detail="Could not fetch market cap data")

    tickers = [r["ticker"] for r in market_cap_results]

    # Step 2: Strategy screening
    strategy_results = screen_by_strategy(
        db=db,
        tickers=tickers,
        start_date=req.start_date,
        end_date=req.end_date,
        initial_capital=req.initial_capital,
        top_n=req.strategy_top,
    )

    return {
        "market_cap_top": market_cap_results,
        "all_results": strategy_results["all_results"],
        "top_picks": strategy_results["top_picks"],
    }


@router.post("/scan", response_model=ScanResponse)
def scan_stocks(req: ScanRequest, db: Session = Depends(get_db)):
    """조건으로 종목을 거른다. 백테스트 없이 오늘의 상태만 본다.

    /full 과 목적이 다르다. 그쪽은 전략을 돌려 수익률로 줄을 세우고,
    이쪽은 questions.md 방식대로 조건의 교집합을 찾는다.
    """
    filters = req.model_dump(exclude={"universe", "limit"})
    return screener_scan.scan(db, req.universe, filters, req.limit)
