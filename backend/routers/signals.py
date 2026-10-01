from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import SignalEvent, SignalRun, Watch
from schemas import SignalRunOut, SignalsOverview, WatchCreate, WatchStatus
from services import signal_monitor
from services.strategies import get_strategy

router = APIRouter(prefix="/api/signals", tags=["signals"])

EVENT_LIMIT = 100


@router.get("/", response_model=SignalsOverview)
def overview(db: Session = Depends(get_db)):
    """워치리스트의 지금 상태, 최근 감지한 신호, 마지막 확인. 캐시만 읽는다."""
    watches = db.query(Watch).order_by(Watch.created_at).all()
    names = signal_monitor.names_for(db, [w.ticker for w in watches])
    rows = [signal_monitor.status(db, w, names) for w in watches]

    events = []
    for e in db.query(SignalEvent).order_by(SignalEvent.date.desc(), SignalEvent.id.desc()).limit(EVENT_LIMIT):
        w = e.watch
        events.append({
            "id": e.id, "watch_id": w.id, "ticker": w.ticker, "strategy_name": w.strategy_name,
            "display_name": get_strategy(w.strategy_name).display_name, "params": w.params,
            "date": e.date, "action": e.action, "price": e.price,
            "seen_bar_date": e.seen_bar_date, "detected_at": e.detected_at,
        })
    last_run = db.query(SignalRun).filter(SignalRun.finished_at.isnot(None)) \
        .order_by(SignalRun.finished_at.desc()).first()
    return {"watches": rows, "events": events, "last_run": last_run}


@router.post("/watches", response_model=WatchStatus)
def add_watch(req: WatchCreate, db: Session = Depends(get_db)):
    try:
        watch = signal_monitor.add_watch(db, req.ticker, req.strategy_name, req.params, req.backtest_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return signal_monitor.status(db, watch, signal_monitor.names_for(db, [watch.ticker]))


@router.delete("/watches/{watch_id}")
def delete_watch(watch_id: int, db: Session = Depends(get_db)):
    """감시를 지운다. 그 감시로 감지한 신호 기록도 함께 지워진다."""
    watch = db.query(Watch).filter(Watch.id == watch_id).first()
    if not watch:
        raise HTTPException(status_code=404, detail="감시가 없습니다")
    db.delete(watch)
    db.commit()
    return {"deleted": watch_id}


@router.post("/check", response_model=SignalRunOut)
def check(db: Session = Depends(get_db)):
    """지금 확인: 장이 끝난 마지막 날까지 시세를 받고 새 신호를 기록한다."""
    return signal_monitor.run_check(db, "manual")
