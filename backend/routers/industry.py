"""산업별 현황.

종목 하나가 아니라 제품군 안의 경쟁 구도를 본다. 제품군 구분은 데이터가 아니라
손으로 관리하는 표라 services/industry_groups.py 에 근거를 적어 두었다.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from schemas import IndustryInfo, IndustryOverview
from services import industry_groups

router = APIRouter(prefix="/api/industry", tags=["industry"])


@router.get("/", response_model=list[IndustryInfo])
def list_industries():
    return [
        {"key": k, "label": v["label"], "note": v["note"]}
        for k, v in industry_groups.INDUSTRIES.items()
    ]


@router.get("/{industry}", response_model=IndustryOverview)
def get_industry(industry: str, db: Session = Depends(get_db)):
    try:
        return industry_groups.overview(db, industry)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
