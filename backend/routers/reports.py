"""주기별 시장 리포트."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from schemas import PeriodInfo, ReportResponse, SectorTrendResponse
from services import reports

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("/periods", response_model=list[PeriodInfo])
def list_periods():
    return [{"key": k, **v} for k, v in reports.PERIODS.items()]


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
