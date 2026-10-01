import threading
import time
import uuid
import logging
from datetime import date as date_type, timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from models import Backtest, Trade
from schemas import (
    AutoBacktestRequest,
    AutoBacktestResponse,
    OptimizeRequest,
    SimulateRequest,
    SimulateResponse,
    BacktestRequest,
    BacktestResult,
    BacktestSummary,
)
from services.data_fetcher import get_cached_data, fetch_and_cache
from services.backtest_engine import run_backtest, warmup_days
from services.strategies import get_strategy, list_strategies
from services import curves, optimizer, regimes as trend

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/backtests", tags=["backtests"])


def _validate_invest(invest_mode: str, initial_capital: float, monthly_contribution: float) -> None:
    if invest_mode not in ("lump_sum", "dca"):
        raise HTTPException(status_code=400, detail="invest_mode must be 'lump_sum' or 'dca'")

    if invest_mode == "lump_sum" and initial_capital <= 0:
        raise HTTPException(status_code=400, detail="initial_capital must be positive")

    if invest_mode == "dca" and monthly_contribution <= 0:
        raise HTTPException(status_code=400, detail="monthly_contribution must be positive for DCA mode")


def _load_prices(db: Session, ticker: str, start: date_type, end: date_type):
    """캐시된 시세를 쓰고, 없거나 요청 시작보다 7일 넘게 늦게 시작하면 yfinance에서 받는다."""
    try:
        df = get_cached_data(db, ticker, start, end)
    except ValueError:
        df = None

    if df is None or df.empty:
        # No cached data at all — fetch from yfinance
        try:
            fetch_and_cache(db, ticker, start, end)
            df = get_cached_data(db, ticker, start, end)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to fetch data for {ticker}: {e}")
    else:
        # If cached data starts more than 7 days after requested start, re-fetch
        if df.iloc[0]["date"] > start + timedelta(days=7):
            try:
                fetch_and_cache(db, ticker, start, end)
                df = get_cached_data(db, ticker, start, end)
            except Exception as e:
                logger.warning(f"Re-fetch failed for {ticker}, using cached data: {e}")

        # 끝쪽도 본다. 캐시가 오래전에 멈춰 있으면 "최근 5년"이 한 달 전에 끝난다.
        # 주말·연휴(추석은 사흘)를 감안해 5일까지는 최신으로 본다.
        cached_end = df.iloc[-1]["date"]
        if cached_end < end - timedelta(days=5):
            try:
                # yfinance의 end는 그날을 포함하지 않는다
                fetch_and_cache(db, ticker, cached_end + timedelta(days=1), end + timedelta(days=1))
                df = get_cached_data(db, ticker, start, end)
            except Exception as e:
                logger.warning(f"Top-up failed for {ticker}, using data through {cached_end}: {e}")
    return df


def _validate_params(strategy, params: dict) -> None:
    for schema in strategy.param_schema:
        name = schema["name"]
        if name in params:
            val = params[name]
            if val < schema["min"] or val > schema["max"]:
                raise HTTPException(
                    status_code=400,
                    detail=f"Parameter '{name}' must be between {schema['min']} and {schema['max']}, got {val}",
                )


def _summarize(strategy, params: dict, r: dict, invest_mode: str,
               initial_capital: float, monthly_contribution: float) -> dict:
    """엔진 결과를 비교표 한 줄로 줄인다. 일별 곡선 대신 주 단위 곡선을 싣는다."""
    return {
        "strategy_name": strategy.name,
        "display_name": strategy.display_name,
        "params": params,
        "total_return": r["total_return"],
        "cagr": r["cagr"],
        "sharpe_ratio": r["sharpe_ratio"],
        "max_drawdown": r["max_drawdown"],
        "win_rate": r["win_rate"],
        "trades_count": sum(1 for t in r["trades"] if t["action"] == "SELL"),
        "curve": curves.weekly_curve(r["equity_curve"], invest_mode, initial_capital, monthly_contribution),
        "first_trade": next((t["date"] for t in r["trades"]), None),
    }


def _load_with_warmup(db: Session, ticker: str, start: date_type, end: date_type, warm_days: int):
    """지표 준비 구간까지 붙여 읽는다. 매매 구간(start 이후)이 2일도 안 되면 400.

    돌려주는 df는 준비 구간을 포함한다. run_backtest(trade_start=start)가 그 앞을 잘라 쓴다.
    """
    df = _load_prices(db, ticker, start - timedelta(days=warm_days), end)
    if df is None or len(df[df["date"] >= start]) < 2:
        raise HTTPException(status_code=400, detail=f"{ticker} 시세가 부족합니다")
    return df


def _trading_span(df, start: date_type) -> tuple[date_type, date_type]:
    """준비 구간을 뺀 실제 매매 구간의 첫날·마지막 날."""
    trading = df[df["date"] >= start]
    return trading.iloc[0]["date"], trading.iloc[-1]["date"]


def _years_before(d: date_type, years: int) -> date_type:
    try:
        return d.replace(year=d.year - years)
    except ValueError:  # 2월 29일
        return d.replace(year=d.year - years, day=28)


@router.post("/run", response_model=BacktestResult)
def run_backtest_endpoint(req: BacktestRequest, db: Session = Depends(get_db)):
    # Validate strategy and parameters
    try:
        strategy = get_strategy(req.strategy_name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    _validate_params(strategy, req.params)

    if req.start_date >= req.end_date:
        raise HTTPException(status_code=400, detail="start_date must be before end_date")

    _validate_invest(req.invest_mode, req.initial_capital, req.monthly_contribution)
    df = _load_with_warmup(db, req.ticker, req.start_date, req.end_date,
                           warmup_days(req.strategy_name, req.params))

    try:
        result = run_backtest(df, req.strategy_name, req.params, req.initial_capital,
                              req.monthly_contribution, req.invest_mode, trade_start=req.start_date)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Persist to DB
    backtest = Backtest(
        ticker=req.ticker.upper(),
        strategy_name=req.strategy_name,
        params=req.params,
        start_date=req.start_date,
        end_date=req.end_date,
        invest_mode=req.invest_mode,
        initial_capital=req.initial_capital,
        monthly_contribution=req.monthly_contribution,
        total_invested=result["total_invested"],
        total_return=result["total_return"],
        cagr=result["cagr"],
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
        "invest_mode": backtest.invest_mode,
        "initial_capital": backtest.initial_capital,
        "monthly_contribution": backtest.monthly_contribution,
        "total_invested": result["total_invested"],
        "total_return": result["total_return"],
        "cagr": result["cagr"],
        "sharpe_ratio": result["sharpe_ratio"],
        "max_drawdown": result["max_drawdown"],
        "win_rate": result["win_rate"],
        "equity_curve": result["equity_curve"],
        "trades": result["trades"],
        "indicators": result["indicators"],
        "created_at": backtest.created_at,
    }


@router.post("/auto", response_model=AutoBacktestResponse)
def auto_backtest(req: AutoBacktestRequest, db: Session = Depends(get_db)):
    """한 종목에 등록된 전략 전부를 기본 파라미터로 돌려 비교한다.

    결과는 저장하지 않는다. 전략이 15개라 매번 저장하면 대시보드가 비교용
    기록으로 가득 차고, 자세히 볼 전략은 /run 으로 다시 돌리면 된다.
    """
    _validate_invest(req.invest_mode, req.initial_capital, req.monthly_contribution)
    ticker = req.ticker.strip().upper()
    end = date_type.today()
    start = _years_before(end, req.years)
    # 전략마다 필요한 준비 기간이 달라 가장 긴 것에 맞춰 한 번만 읽는다.
    warm = max(warmup_days(s.name, {p["name"]: p["default"] for p in s.param_schema})
               for s in list_strategies())
    df = _load_with_warmup(db, ticker, start, end, warm)
    data_start, data_end = _trading_span(df, start)

    results, failed = [], []
    total_invested = 0.0
    for strategy in list_strategies():
        params = {p["name"]: p["default"] for p in strategy.param_schema}
        try:
            # 전략마다 자기 준비 구간만큼만 잘라 쓴다. 가장 긴 구간(Golden Cross)으로 다 돌리면
            # SAR·EMA처럼 첫 봉부터 재귀로 쌓는 지표는 /run 과 다른 신호를 내, Auto 표와
            # 상세 보기 결과가 어긋났다.
            frame = df[df["date"] >= start - timedelta(days=warmup_days(strategy.name, params))]
            r = run_backtest(frame, strategy.name, params, req.initial_capital,
                             req.monthly_contribution, req.invest_mode, trade_start=start)
        except Exception as e:  # noqa: BLE001 - 전략 하나가 실패해도 나머지는 비교한다
            logger.warning(f"Auto backtest failed for {ticker}/{strategy.name}: {e}")
            failed.append({"strategy_name": strategy.name, "display_name": strategy.display_name,
                           "error": str(e)[:200]})
            continue
        total_invested = r["total_invested"]
        results.append(_summarize(strategy, params, r, req.invest_mode,
                                  req.initial_capital, req.monthly_contribution))

    results.sort(key=lambda x: x["total_return"], reverse=True)
    return {
        "ticker": ticker,
        "start_date": start,
        "end_date": end,
        "data_start": data_start,
        "data_end": data_end,
        "invest_mode": req.invest_mode,
        "total_invested": total_invested,
        "results": results,
        "failed": failed,
    }


@router.post("/simulate", response_model=SimulateResponse)
def simulate(req: SimulateRequest, db: Session = Depends(get_db)):
    """한 전략을 파라미터 조합 여러 개로 돌린다. 저장하지 않는다.

    결과 화면에서 "값을 바꾸면 어떻게 되나"를 보는 용도다. 시세는 한 번만 읽고
    같은 구간의 Buy & Hold를 기준으로 함께 돌려, 롤링 비교를 화면에서 할 수 있게 한다.
    """
    try:
        strategy = get_strategy(req.strategy_name)
        benchmark_strategy = get_strategy("buy_and_hold")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    for params in req.param_sets:
        _validate_params(strategy, params)
    if req.start_date >= req.end_date:
        raise HTTPException(status_code=400, detail="start_date must be before end_date")
    _validate_invest(req.invest_mode, req.initial_capital, req.monthly_contribution)

    ticker = req.ticker.strip().upper()
    defaults = {p["name"]: p["default"] for p in strategy.param_schema}
    warm = max(warmup_days(strategy.name, {**defaults, **params}) for params in req.param_sets)
    df = _load_with_warmup(db, ticker, req.start_date, req.end_date, warm)
    data_start, data_end = _trading_span(df, req.start_date)

    def run(strat, params: dict) -> tuple[dict, float]:
        # 조합마다 자기 준비 구간만큼만 잘라 쓴다 (/auto 와 같다). 가장 긴 준비 구간으로 다 돌리면
        # EMA·SAR처럼 첫 봉부터 재귀로 쌓는 지표가, 준비 구간이 더 긴 변형을 추가할 때마다 "원래" 줄의
        # 신호를 바꿔 결과 화면의 지표와 어긋났다.
        frame = df[df["date"] >= req.start_date - timedelta(days=warmup_days(strat.name, params))]
        try:
            r = run_backtest(frame, strat.name, params, req.initial_capital,
                             req.monthly_contribution, req.invest_mode, trade_start=req.start_date)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        return _summarize(strat, params, r, req.invest_mode,
                          req.initial_capital, req.monthly_contribution), r["total_invested"]

    benchmark, total_invested = run(benchmark_strategy, {})
    # 빠진 파라미터는 기본값으로 채워 돌려준다. 화면이 "무엇으로 돌렸는지"를 그대로 보여 줄 수 있다.
    results = [run(strategy, {**defaults, **params})[0] for params in req.param_sets]

    # 추세 구간은 B&H 경로로 나누고, 모든 곡선을 같은 주 단위 점에서 잰다(같은 시세라 날짜가 같다).
    segments, threshold = trend.segment([(p["date"], p["idx"]) for p in benchmark["curve"]])
    for row in [benchmark, *results]:
        row["regime_returns"] = trend.returns_in([p["idx"] for p in row["curve"]], segments)
    return {
        "ticker": ticker,
        "data_start": data_start,
        "data_end": data_end,
        "invest_mode": req.invest_mode,
        "total_invested": total_invested,
        "benchmark": benchmark,
        "results": results,
        "regimes": [
            {"start": s["start"], "end": s["end"], "kind": s["kind"],
             "weeks": s["end_index"] - s["start_index"], "benchmark_return": s["benchmark_return"]}
            for s in segments
        ],
        "regime_threshold": round(threshold * 100, 1),
    }


# ── 파라미터 최적화 (백그라운드) ──────────────────────────────────────────────
# 조합당 0.15초쯤이라 121~400조합이면 20초~1분이 걸린다. 요청을 붙잡지 않고 작업 번호를
# 돌려준 뒤 화면이 진행률을 폴링한다. 서버 메모리에만 두므로 재시작하면 사라진다.
_opt_jobs: dict[str, dict] = {}
_opt_lock = threading.Lock()
MAX_OPT_JOBS = 20


@router.get("/optimize/goals")
def optimize_goals():
    return [{"key": k, **v} for k, v in optimizer.GOALS.items()]


@router.post("/optimize")
def start_optimize(req: OptimizeRequest, db: Session = Depends(get_db)):
    if req.goal not in optimizer.GOALS:
        raise HTTPException(status_code=400, detail=f"알 수 없는 목표: {req.goal}")
    try:
        strategy = get_strategy(req.strategy_name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not strategy.param_schema:
        raise HTTPException(status_code=400, detail="파라미터가 없는 전략입니다")
    if (req.end_date - req.start_date).days < 365:
        raise HTTPException(status_code=400, detail="검증 구간을 나누려면 1년 이상이어야 합니다")
    _validate_params(strategy, req.original_params)
    _validate_invest(req.invest_mode, req.initial_capital, req.monthly_contribution)

    ticker = req.ticker.strip().upper()
    # 가장 긴 조합의 준비 구간까지 한 번에 읽는다. 조합마다 필요한 만큼만 잘라 쓴다.
    longest = {p["name"]: p["max"] for p in strategy.param_schema}
    df = _load_with_warmup(db, ticker, req.start_date, req.end_date,
                           warmup_days(strategy.name, longest))

    job_id = uuid.uuid4().hex[:12]
    job = {"id": job_id, "status": "running", "done": 0, "total": 0, "result": None, "error": None,
           "created": time.time()}
    with _opt_lock:
        if len(_opt_jobs) >= MAX_OPT_JOBS:  # 오래된 것부터 버린다
            for old in sorted(_opt_jobs.values(), key=lambda j: j["created"])[: len(_opt_jobs) - MAX_OPT_JOBS + 1]:
                _opt_jobs.pop(old["id"], None)
        _opt_jobs[job_id] = job

    def progress(done: int, total: int) -> None:
        job["done"], job["total"] = done, total

    def work() -> None:
        try:
            job["result"] = optimizer.optimize(
                df, strategy.name, req.start_date, req.end_date, req.goal, req.invest_mode,
                req.initial_capital, req.monthly_contribution, req.original_params,
                min_trades=req.min_trades, max_mdd=req.max_mdd, progress=progress,
            )
            job["status"] = "done"
        except Exception as e:  # noqa: BLE001 - 실패 사유를 화면에 그대로 보여 준다
            logger.exception("optimize failed")
            job["status"], job["error"] = "error", str(e)[:300]

    threading.Thread(target=work, daemon=True).start()
    return {"id": job_id, "status": "running"}


@router.get("/optimize/{job_id}")
def optimize_status(job_id: str):
    job = _opt_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="작업이 없습니다 (서버가 재시작됐을 수 있습니다)")
    return {k: v for k, v in job.items() if k != "created"}


@router.get("/", response_model=list[BacktestSummary])
def list_backtests(db: Session = Depends(get_db)):
    backtests = db.query(Backtest).order_by(Backtest.created_at.desc()).limit(50).all()
    return backtests


@router.get("/{backtest_id}", response_model=BacktestResult)
def get_backtest(backtest_id: int, start: date_type | None = None, end: date_type | None = None,
                 db: Session = Depends(get_db)):
    """저장된 결과. start/end 를 주면 저장된 구간 안의 그 구간으로 다시 돌려 보여 준다(저장하지 않음).

    전체 기간에 맞춘 파라미터가 최근 시세에도 통하는지 Tear Sheet 에서 좁혀 보려는 용도다.
    지표는 구간 앞 시세로 준비해 두므로, 그때 이미 매수 상태면 첫날 산다.
    """
    backtest = db.query(Backtest).filter(Backtest.id == backtest_id).first()
    if not backtest:
        raise HTTPException(status_code=404, detail="Backtest not found")

    start = start or backtest.start_date
    end = end or backtest.end_date
    if (start, end) != (backtest.start_date, backtest.end_date):
        return _backtest_over_period(db, backtest, start, end)

    trades = [
        {"date": t.date, "action": t.action, "price": t.price, "shares": t.shares, "pnl": t.pnl}
        for t in backtest.trades
    ]

    # Recompute indicators from cached data
    indicators = None
    try:
        # 실행 때와 같이 준비 구간을 붙여 계산하고 매매 구간만 보여 준다. 시작일부터 계산하면
        # 200일 이동평균 선이 차트 앞 40주 동안 비어 있다.
        warm = warmup_days(backtest.strategy_name, backtest.params)
        df = get_cached_data(db, backtest.ticker, backtest.start_date - timedelta(days=warm), backtest.end_date)
        strategy = get_strategy(backtest.strategy_name)
        start_str = str(backtest.start_date)
        indicators = {
            name: [p for p in series if str(p.get("date", "")) >= start_str]
            for name, series in strategy.compute_indicators(df, backtest.params).items()
        }
    except (ValueError, KeyError) as e:
        logger.warning(f"Could not compute indicators for backtest {backtest_id}: {e}")

    return {
        "id": backtest.id,
        "ticker": backtest.ticker,
        "strategy_name": backtest.strategy_name,
        "params": backtest.params,
        "start_date": backtest.start_date,
        "end_date": backtest.end_date,
        "invest_mode": backtest.invest_mode or "lump_sum",
        "initial_capital": backtest.initial_capital,
        "monthly_contribution": backtest.monthly_contribution or 0.0,
        "total_invested": backtest.total_invested or backtest.initial_capital,
        "total_return": backtest.total_return,
        "cagr": backtest.cagr or 0.0,
        "sharpe_ratio": backtest.sharpe_ratio,
        "max_drawdown": backtest.max_drawdown,
        "win_rate": backtest.win_rate,
        "equity_curve": backtest.equity_curve or [],
        "trades": trades,
        "indicators": indicators,
        "created_at": backtest.created_at,
    }


def _backtest_over_period(db: Session, backtest: Backtest, start: date_type, end: date_type) -> dict:
    if start < backtest.start_date or end > backtest.end_date:
        raise HTTPException(status_code=400,
                            detail=f"{backtest.start_date} ~ {backtest.end_date} 안에서 고르세요")
    if start >= end:
        raise HTTPException(status_code=400, detail="시작일이 종료일보다 앞이어야 합니다")
    invest_mode = backtest.invest_mode or "lump_sum"
    monthly = backtest.monthly_contribution or 0.0
    df = _load_with_warmup(db, backtest.ticker, start, end,
                           warmup_days(backtest.strategy_name, backtest.params))
    try:
        result = run_backtest(df, backtest.strategy_name, backtest.params, backtest.initial_capital,
                              monthly, invest_mode, trade_start=start)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {
        "id": backtest.id,
        "ticker": backtest.ticker,
        "strategy_name": backtest.strategy_name,
        "params": backtest.params,
        "start_date": start,
        "end_date": end,
        "invest_mode": invest_mode,
        "initial_capital": backtest.initial_capital,
        "monthly_contribution": monthly,
        "total_invested": result["total_invested"],
        "total_return": result["total_return"],
        "cagr": result["cagr"],
        "sharpe_ratio": result["sharpe_ratio"],
        "max_drawdown": result["max_drawdown"],
        "win_rate": result["win_rate"],
        "equity_curve": result["equity_curve"],
        "trades": result["trades"],
        "indicators": result["indicators"],
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
