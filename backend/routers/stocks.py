from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from database import get_db
from schemas import (
    BulkFetchRequest,
    BulkFetchStatus,
    FundamentalSeries,
    InvestorFlowSeries,
    SnapshotCaptureRequest,
    SnapshotSeries,
    InvestorFlowSyncRequest,
    RefreshRequest,
    RefreshResult,
    UniverseInfo,
    StockData,
    StockFetchRequest,
    StockIndicators,
    StockStats,
    TickerInfo,
)
from services.data_fetcher import (
    fetch_and_cache,
    sync_universe,
    get_cached_data,
    list_cached_tickers,
    refresh_all,
)
from services.indicators import DEFAULT_RANGE, RANGES, compute_indicators
from services.market_stats import compute_stats
from services import bulk_job, fundamentals, investor_flow, snapshots
from services.universe import SOURCES, symbols

router = APIRouter(prefix="/api/stocks", tags=["stocks"])


@router.post("/fetch", response_model=list[StockData])
def fetch_stock_data(req: StockFetchRequest, db: Session = Depends(get_db)):
    try:
        df = fetch_and_cache(db, req.ticker, req.start_date, req.end_date)
        data = get_cached_data(db, req.ticker, req.start_date, req.end_date)
        return data.to_dict(orient="records")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/refresh", response_model=list[RefreshResult])
def refresh_cached(req: RefreshRequest, db: Session = Depends(get_db)):
    """캐시된 티커 전체를 같은 구간으로 다시 받아온다.

    /fetch 를 티커 수만큼 부르는 것과 결과는 같지만, 시세 배열 대신
    티커별 요약만 돌려주므로 응답이 수 MB에서 수 KB로 줄어든다.
    """
    return refresh_all(db, req.start_date, req.end_date)


@router.get("/universes", response_model=list[UniverseInfo])
def list_universes():
    """일괄 수집이 가능한 지수 목록. 화면의 버튼이 이 목록을 그대로 그린다."""
    return [{"key": k, "label": v["label"]} for k, v in SOURCES.items()]


@router.post("/universes/sync")
def sync_universes(db: Session = Depends(get_db)):
    """구성종목·회사 이름만 갱신한다. 시세는 받지 않아 몇 초면 끝난다."""
    out = {}
    for key in SOURCES:
        try:
            out[key] = sync_universe(db, key)
        except Exception as e:  # noqa: BLE001 - 지수 하나가 막혀도 나머지는 갱신한다
            out[key] = f"실패: {str(e)[:120]}"
    return out


@router.post("/bulk-fetch", response_model=BulkFetchStatus)
def start_bulk_fetch(req: BulkFetchRequest, background: BackgroundTasks, db: Session = Depends(get_db)):
    """지수 구성종목 전체를 백그라운드로 받아온다.

    S&P 500 5년치가 60만 행이 넘어 2분 이상 걸린다. 동기로 처리하면
    브라우저가 그동안 묶이므로 작업만 걸어 두고 /status 로 진행률을 본다.
    """
    if req.universe not in SOURCES:
        raise HTTPException(
            status_code=400,
            detail=f"알 수 없는 유니버스: {req.universe}. 사용 가능: {', '.join(SOURCES)}",
        )

    # 구성종목을 받기 전에 자리부터 선점한다. 네트워크를 다녀오는 동안 들어온
    # 두 번째 요청이 함께 통과하면 두 작업이 같은 카운터를 쓰게 된다.
    if not bulk_job.reserve(req.universe):
        raise HTTPException(status_code=409, detail="이미 진행 중인 작업이 있습니다")

    try:
        tickers = symbols(req.universe)
        # 시세를 받기 전에 편입 정보와 회사 이름을 먼저 채운다. 표에 이미 있는 값이라
        # 추가 다운로드가 없고, 목록 화면이 곧바로 이름을 보여줄 수 있다.
        sync_universe(db, req.universe)
    except Exception as e:  # noqa: BLE001 - 외부 소스 장애를 그대로 전달한다
        bulk_job.release(f"구성종목을 받지 못했습니다: {str(e)[:150]}")
        raise HTTPException(status_code=502, detail=f"구성종목을 받지 못했습니다: {e}")

    background.add_task(bulk_job.run, req.universe, tickers, req.start_date, req.end_date,
                        req.with_flows, req.flow_months)
    return {**bulk_job.status(), "running": True, "universe": req.universe, "total": len(tickers)}


@router.get("/bulk-fetch/status", response_model=BulkFetchStatus)
def bulk_fetch_status():
    return bulk_job.status()


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


@router.get("/{ticker}/indicators", response_model=StockIndicators)
def get_stock_indicators(
    ticker: str,
    series_range: str = Query(DEFAULT_RANGE, alias="range", description=f"차트 구간: {', '.join(RANGES)}"),
    db: Session = Depends(get_db),
):
    """OHLCV 파생 지표 — 이동평균·이격도·거래대금 배율·위꼬리.

    저장하지 않고 요청 시 계산한다. 캐시된 OHLCV가 곧 원본이므로
    따로 적재해 두면 원본과 어긋날 여지만 생긴다.
    """
    try:
        df = get_cached_data(db, ticker, None, None)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    try:
        return compute_indicators(df, ticker, series_range)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{ticker}/investor-flow", response_model=InvestorFlowSeries)
def get_investor_flow(ticker: str, db: Session = Depends(get_db)):
    """투자자 매매동향(외국인·기관·개인). 한국 종목에만 있다.

    없으면 빈 배열을 돌려준다 — 미국 종목이거나 아직 수집하지 않은 경우다.
    화면은 그걸 보고 패널을 접는다.
    """
    ticker = ticker.upper()
    rows = investor_flow.get(db, ticker)
    return {"ticker": ticker, "data": rows, **investor_flow.coverage(db, ticker)}


@router.post("/{ticker}/investor-flow/sync", response_model=InvestorFlowSeries)
def sync_investor_flow(ticker: str, req: InvestorFlowSyncRequest, db: Session = Depends(get_db)):
    """KIS API로 지정 개월 수만큼 채운다. 한 번에 30거래일씩 거슬러 올라간다."""
    ticker = ticker.upper()
    try:
        investor_flow.sync(db, ticker, req.months)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:  # noqa: BLE001 - 증권사 API 오류를 그대로 전달한다
        raise HTTPException(status_code=502, detail=str(e)[:300])
    rows = investor_flow.get(db, ticker)
    return {"ticker": ticker, "data": rows, **investor_flow.coverage(db, ticker)}


def _fundamental_response(db: Session, ticker: str, period_type: str) -> dict:
    rows = fundamentals.get(db, ticker, period_type)
    return {
        "ticker": ticker,
        "period_type": period_type,
        "currency": fundamentals.currency_of(ticker),
        "source": rows[-1].source if rows else "yfinance",
        "data": fundamentals.serialize(rows),
        **fundamentals.coverage(db, ticker, period_type),
    }


@router.get("/{ticker}/fundamentals", response_model=FundamentalSeries)
def get_fundamentals(
    ticker: str,
    period_type: str = Query("quarterly", pattern="^(quarterly|annual)$"),
    db: Session = Depends(get_db),
):
    """재무. 없으면 빈 배열 — 화면이 그걸 보고 수집 버튼을 띄운다."""
    return _fundamental_response(db, ticker.upper(), period_type)


@router.post("/{ticker}/fundamentals/sync", response_model=FundamentalSeries)
def sync_fundamentals(
    ticker: str,
    period_type: str = Query("quarterly", pattern="^(quarterly|annual)$"),
    db: Session = Depends(get_db),
):
    """가장 깊은 소스에서 받아 저장한다.

    한국 종목은 KIS(분기 30개·연간 23개), 그 외는 yfinance(분기 5개)다.
    소스 선택은 서버가 한다 — 화면이 고르게 하면 종목마다 결과가 달라 보인다.
    """
    ticker = ticker.upper()
    try:
        fundamentals.sync_best(db, ticker)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(e)[:300])
    return _fundamental_response(db, ticker, period_type)


@router.get("/{ticker}/snapshots", response_model=SnapshotSeries)
def get_snapshots(ticker: str, db: Session = Depends(get_db)):
    """찍어 둔 일별 스냅샷. 쌓기 시작한 날부터만 존재한다."""
    ticker = ticker.upper()
    return {"ticker": ticker, "data": snapshots.get(db, ticker), **snapshots.coverage(db, ticker)}


@router.get("/", response_model=list[TickerInfo])
def list_tickers(db: Session = Depends(get_db)):
    return list_cached_tickers(db)
