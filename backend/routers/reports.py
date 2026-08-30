"""주기별 시장 리포트."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from schemas import PeriodInfo, ReportResponse
from services import reports

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("/periods", response_model=list[PeriodInfo])
def list_periods():
    return [{"key": k, **v} for k, v in reports.PERIODS.items()]


@router.get("/{period}", response_model=ReportResponse)
def get_report(period: str, universe: str = "kospi200", db: Session = Depends(get_db)):
    try:
        return reports.build(db, period, universe)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
