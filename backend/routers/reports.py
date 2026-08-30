"""주기별 시장 리포트."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from fastapi import Query

from schemas import (
    PeriodInfo, RangeInfo, ReportResponse, SectorCurveResponse, SectorTrendResponse,
)
from services import reports

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("/periods", response_model=list[PeriodInfo])
def list_periods():
    return [{"key": k, **v} for k, v in reports.PERIODS.items()]


@router.get("/curve-ranges", response_model=list[RangeInfo])
def list_curve_ranges():
    return reports.CURVE_RANGES


@router.get("/sector-curves", response_model=SectorCurveResponse)
def get_sector_curves(
    universe: str = "kospi200",
    months: int = Query(60, ge=1, le=240),
    db: Session = Depends(get_db),
):
    """업종별 누적수익률 곡선. 가로가 날짜, 세로가 구간 시작 대비 수익률이다."""
    try:
        return reports.sector_curves(db, universe, months)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# /{period} 보다 먼저 선언해야 한다. 뒤에 두면 "sector-trends"가 주기 이름으로 잡힌다.
@router.get("/sector-trends", response_model=SectorTrendResponse)
def get_sector_trends(universe: str = "kospi200", db: Session = Depends(get_db)):
    """업종별 수익률을 1달~5년 여섯 구간으로 나란히 낸다."""
    try:
        return reports.sector_trends(db, universe)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/{period}", response_model=ReportResponse)
def get_report(period: str, universe: str = "kospi200", db: Session = Depends(get_db)):
    try:
        return reports.build(db, period, universe)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
