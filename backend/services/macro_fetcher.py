"""FRED(Federal Reserve Economic Data)에서 거시 지표를 받아 SQLite에 캐싱한다.

fredgraph.csv 엔드포인트는 **API 키가 필요 없다.** 별도 SDK도 쓰지 않고
pandas.read_csv로 직접 읽는다.

data_fetcher.py(주가)와 같은 역할이지만 테이블과 형태가 다르다 — 값이 하나뿐이고
주기가 섞인다. 월간 시계열은 해당 월의 1일로 스탬프되므로, 일별 데이터와 나란히
그릴 때는 프론트에서 계단식으로 이어 붙여야 한다.
"""
from datetime import datetime

import pandas as pd
from sqlalchemy import func
from sqlalchemy.orm import Session

from models import MacroData, MacroSeries

FRED_CSV = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}"

# 받을 수 있는 지표 목록. 프론트의 드롭다운이 이 카탈로그를 그대로 읽는다.
CATALOG: list[dict] = [
    {"series_id": "UNRATE", "name": "실업률", "unit": "%", "frequency": "monthly",
     "description": "16세 이상 실업률. 대표적인 후행 지표로, 주가 저점 이후에 정점을 찍는 경향이 있다."},
    {"series_id": "PAYEMS", "name": "비농업 고용", "unit": "천 명", "frequency": "monthly",
     "description": "농업을 제외한 전체 고용자 수. 고용은 기업 이익이 회복된 뒤에 늘어난다."},
    {"series_id": "ICSA", "name": "신규 실업수당 청구", "unit": "건", "frequency": "weekly",
     "description": "주간 신규 청구 건수. 고용 지표 중 가장 빠르게 반응한다."},
    {"series_id": "FEDFUNDS", "name": "연방기금금리", "unit": "%", "frequency": "monthly",
     "description": "미국 기준금리의 실효 수준."},
    {"series_id": "DGS10", "name": "국채 10년 금리", "unit": "%", "frequency": "daily",
     "description": "10년 만기 미국 국채 수익률."},
    {"series_id": "T10Y2Y", "name": "장단기 금리차 (10Y-2Y)", "unit": "%p", "frequency": "daily",
     "description": "음수면 장단기 금리 역전. 역사적으로 침체에 선행했다."},
    {"series_id": "CPIAUCSL", "name": "소비자물가지수", "unit": "지수", "frequency": "monthly",
     "description": "도시 소비자 기준 CPI. 전년 대비 변화율로 인플레이션을 본다."},
    {"series_id": "GFDEGDQ188S", "name": "정부부채 / GDP", "unit": "%", "frequency": "quarterly",
     "description": "연방정부 부채의 GDP 대비 비율."},
]

CATALOG_BY_ID = {c["series_id"]: c for c in CATALOG}


def fetch_and_cache(db: Session, series_id: str) -> int:
    """FRED에서 시계열 전체를 받아 캐싱한다. 새로 저장한 행 수를 반환."""
    series_id = series_id.upper()
    meta = CATALOG_BY_ID.get(series_id)
    if meta is None:
        raise ValueError(
            f"알 수 없는 지표: {series_id}. 사용 가능: {', '.join(CATALOG_BY_ID)}"
        )

    try:
        df = pd.read_csv(FRED_CSV.format(sid=series_id))
    except Exception as e:  # noqa: BLE001 - 네트워크/포맷 오류를 한데 묶어 전달
        raise ValueError(f"FRED에서 {series_id}를 받지 못했습니다: {e}") from e

    date_col = df.columns[0]
    value_col = next((c for c in df.columns if c != date_col), None)
    if value_col is None or df.empty:
        raise ValueError(f"{series_id}: 응답에 데이터가 없습니다")

    df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
    # FRED는 결측을 "." 으로 표기한다. 숫자로 바꾸고 결측 행은 버린다.
    df[value_col] = pd.to_numeric(df[value_col], errors="coerce")
    df = df.dropna(subset=[date_col, value_col])
    if df.empty:
        raise ValueError(f"{series_id}: 유효한 관측치가 없습니다")

    row = db.query(MacroSeries).filter(MacroSeries.series_id == series_id).first()
    if row is None:
        row = MacroSeries(series_id=series_id)
        db.add(row)
    row.name = meta["name"]
    row.unit = meta["unit"]
    row.frequency = meta["frequency"]
    row.source = "FRED"
    row.updated_at = datetime.utcnow()
    db.flush()

    existing = {
        d for (d,) in db.query(MacroData.date).filter(MacroData.series_id == series_id).all()
    }
    added = 0
    for _, r in df.iterrows():
        d = r[date_col].date()
        if d in existing:
            continue
        db.add(MacroData(series_id=series_id, date=d, value=float(r[value_col])))
        added += 1

    db.commit()
    return added


def list_cached(db: Session) -> list[dict]:
    """캐시된 지표 목록과 각 시계열의 범위."""
    rows = (
        db.query(
            MacroSeries.series_id,
            MacroSeries.name,
            MacroSeries.unit,
            MacroSeries.frequency,
            MacroSeries.source,
            func.min(MacroData.date).label("start_date"),
            func.max(MacroData.date).label("end_date"),
            func.count(MacroData.id).label("count"),
        )
        .join(MacroData, MacroData.series_id == MacroSeries.series_id)
        .group_by(MacroSeries.series_id)
        .all()
    )
    return [
        {
            "series_id": r.series_id,
            "name": r.name,
            "unit": r.unit,
            "frequency": r.frequency,
            "source": r.source,
            "start_date": r.start_date,
            "end_date": r.end_date,
            "count": r.count,
        }
        for r in rows
    ]


def get_series(db: Session, series_id: str) -> dict:
    """지표 하나의 메타데이터와 전체 시계열."""
    series_id = series_id.upper()
    meta = db.query(MacroSeries).filter(MacroSeries.series_id == series_id).first()
    if meta is None:
        raise ValueError(f"{series_id}: 캐시된 데이터가 없습니다. 먼저 받아오세요.")

    points = (
        db.query(MacroData)
        .filter(MacroData.series_id == series_id)
        .order_by(MacroData.date)
        .all()
    )
    if not points:
        raise ValueError(f"{series_id}: 캐시된 데이터가 없습니다. 먼저 받아오세요.")

    values = [p.value for p in points]
    catalog = CATALOG_BY_ID.get(series_id, {})
    return {
        "series_id": series_id,
        "name": meta.name,
        "unit": meta.unit,
        "frequency": meta.frequency,
        "source": meta.source,
        "description": catalog.get("description", ""),
        "start_date": points[0].date,
        "end_date": points[-1].date,
        "count": len(points),
        "latest_value": values[-1],
        "min_value": min(values),
        "max_value": max(values),
        "data": [{"date": p.date, "value": p.value} for p in points],
    }
