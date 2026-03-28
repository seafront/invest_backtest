from datetime import date as date_type
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from models import Backtest, Trade
from schemas import BacktestRequest, BacktestResult, BacktestSummary
from services.data_fetcher import get_cached_data, fetch_and_cache
from services.backtest_engine import run_backtest

router = APIRouter(prefix="/api/backtests", tags=["backtests"])


@router.post("/run", response_model=BacktestResult)
def run_backtest_endpoint(req: BacktestRequest, db: Session = Depends(get_db)):
    # Try cached data first, auto-fetch if missing or incomplete
    try:
        df = get_cached_data(db, req.ticker, req.start_date, req.end_date)
    except ValueError:
        df = None

    if df is None or df.empty:
        # No cached data at all — fetch from yfinance
        try:
            fetch_and_cache(db, req.ticker, req.start_date, req.end_date)
            df = get_cached_data(db, req.ticker, req.start_date, req.end_date)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to fetch data for {req.ticker}: {e}")
    else:
        # Check if cached data covers the requested range
        from datetime import timedelta
        data_start = df.iloc[0]["date"]
        req_start = req.start_date
        # If cached data starts more than 7 days after requested start, re-fetch
        if data_start > req_start + timedelta(days=7):
            try:
                fetch_and_cache(db, req.ticker, req.start_date, req.end_date)
                df = get_cached_data(db, req.ticker, req.start_date, req.end_date)
            except Exception:
                pass  # Use whatever we have

    try:
        result = run_backtest(df, req.strategy_name, req.params, req.initial_capital)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Persist to DB
    backtest = Backtest(
        ticker=req.ticker.upper(),
        strategy_name=req.strategy_name,
        params=req.params,
        start_date=req.start_date,
        end_date=req.end_date,
        initial_capital=req.initial_capital,
        total_return=result["total_return"],
        sharpe_ratio=result["sharpe_ratio"],
        max_drawdown=result["max_drawdown"],
        win_rate=result["win_rate"],
        equity_curve=result["equity_curve"],
    )
    db.add(backtest)
    db.flush()

    for t in result["trades"]:
        trade = Trade(
            backtest_id=backtest.id,
            date=date_type.fromisoformat(str(t["date"])),
            action=t["action"],
            price=t["price"],
            shares=t["shares"],
            pnl=t["pnl"],
        )
        db.add(trade)

    db.commit()
    db.refresh(backtest)

    return {
        "id": backtest.id,
        "ticker": backtest.ticker,
        "strategy_name": backtest.strategy_name,
        "params": backtest.params,
        "start_date": backtest.start_date,
        "end_date": backtest.end_date,
        "initial_capital": backtest.initial_capital,
        "total_return": result["total_return"],
        "sharpe_ratio": result["sharpe_ratio"],
        "max_drawdown": result["max_drawdown"],
        "win_rate": result["win_rate"],
        "equity_curve": result["equity_curve"],
        "trades": result["trades"],
        "indicators": result["indicators"],
        "created_at": backtest.created_at,
    }


@router.get("/", response_model=list[BacktestSummary])
def list_backtests(db: Session = Depends(get_db)):
    backtests = db.query(Backtest).order_by(Backtest.created_at.desc()).limit(50).all()
    return backtests


@router.get("/{backtest_id}", response_model=BacktestResult)
def get_backtest(backtest_id: int, db: Session = Depends(get_db)):
    backtest = db.query(Backtest).filter(Backtest.id == backtest_id).first()
    if not backtest:
        raise HTTPException(status_code=404, detail="Backtest not found")

    trades = [
        {"date": t.date, "action": t.action, "price": t.price, "shares": t.shares, "pnl": t.pnl}
        for t in backtest.trades
    ]

    return {
        "id": backtest.id,
        "ticker": backtest.ticker,
        "strategy_name": backtest.strategy_name,
        "params": backtest.params,
        "start_date": backtest.start_date,
        "end_date": backtest.end_date,
        "initial_capital": backtest.initial_capital,
        "total_return": backtest.total_return,
        "sharpe_ratio": backtest.sharpe_ratio,
        "max_drawdown": backtest.max_drawdown,
        "win_rate": backtest.win_rate,
        "equity_curve": backtest.equity_curve or [],
        "trades": trades,
        "indicators": None,
        "created_at": backtest.created_at,
    }


@router.delete("/{backtest_id}")
def delete_backtest(backtest_id: int, db: Session = Depends(get_db)):
    backtest = db.query(Backtest).filter(Backtest.id == backtest_id).first()
    if not backtest:
        raise HTTPException(status_code=404, detail="Backtest not found")
    db.delete(backtest)
    db.commit()
    return {"message": "Deleted"}
