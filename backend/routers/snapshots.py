"""스냅샷 수집 엔드포인트.

조회는 stocks 라우터에 있고, 여기는 찍는 쪽이다. 720종목에 12분이 걸려
백그라운드로 돌리고 진행률을 폴링한다 — 일괄 수집과 같은 구조다.
"""
import threading
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from database import SessionLocal, get_db
from schemas import SnapshotCaptureRequest
from services import snapshots
from services.data_fetcher import list_cached_tickers
from services.universe import SOURCES, symbols

router = APIRouter(prefix="/api/snapshots", tags=["snapshots"])

_lock = threading.Lock()
_job = {"running": False, "total": 0, "done": 0, "failed": 0,
        "errors": [], "started_at": None, "finished_at": None}


def _status() -> dict:
    with _lock:
        return dict(_job, errors=list(_job["errors"]))


def _run(tickers: list[str]) -> None:
    db = SessionLocal()
    try:
        def progress(done: int, total: int) -> None:
            with _lock:
                _job["done"] = done

        result = snapshots.capture_many(db, tickers, progress)
        with _lock:
            _job.update(failed=result["failed"], errors=result["errors"])
    finally:
        db.close()
        with _lock:
            _job.update(running=False, finished_at=datetime.utcnow())


@router.post("/capture")
def capture(req: SnapshotCaptureRequest, background: BackgroundTasks, db: Session = Depends(get_db)):
    """오늘 값을 찍는다. 같은 날 다시 돌리면 덮어쓸 뿐 행이 늘지 않는다."""
    if req.tickers:
        tickers = [t.upper() for t in req.tickers]
    elif req.universe:
        if req.universe not in SOURCES:
            raise HTTPException(status_code=400, detail=f"알 수 없는 유니버스: {req.universe}")
        tickers = symbols(req.universe)
    else:
        tickers = [r["ticker"] for r in list_cached_tickers(db)]

    with _lock:
        if _job["running"]:
            raise HTTPException(status_code=409, detail="이미 진행 중인 스냅샷 작업이 있습니다")
        _job.update(running=True, total=len(tickers), done=0, failed=0,
                    errors=[], started_at=datetime.utcnow(), finished_at=None)

    background.add_task(_run, tickers)
    return _status()


@router.get("/status")
def status():
    return _status()
