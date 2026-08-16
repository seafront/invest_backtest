from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from schemas import (
    MacroCatalogItem,
    MacroFetchRequest,
    MacroSeriesDetail,
    MacroSeriesInfo,
)
from services.macro_fetcher import CATALOG, fetch_and_cache, get_series, list_cached

router = APIRouter(prefix="/api/macro", tags=["macro"])


@router.get("/catalog", response_model=list[MacroCatalogItem])
def get_catalog():
    """받아올 수 있는 지표 목록. 프론트 드롭다운이 이걸 그대로 쓴다."""
    return CATALOG


@router.post("/fetch", response_model=MacroSeriesInfo)
def fetch_macro(req: MacroFetchRequest, db: Session = Depends(get_db)):
    try:
        fetch_and_cache(db, req.series_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    cached = next(
        (c for c in list_cached(db) if c["series_id"] == req.series_id.upper()), None
    )
    if cached is None:
        raise HTTPException(status_code=500, detail="저장 후 조회에 실패했습니다")
    return cached


@router.get("/", response_model=list[MacroSeriesInfo])
def list_macro(db: Session = Depends(get_db)):
    return list_cached(db)


@router.get("/{series_id}", response_model=MacroSeriesDetail)
def get_macro(series_id: str, db: Session = Depends(get_db)):
    try:
        return get_series(db, series_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
