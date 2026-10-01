#!/usr/bin/env python3
"""워치리스트의 신호를 확인하고 보유 종목(KIS 잔고)을 동기화한다. launchd 가 장 마감 뒤에 부른다.

서버가 떠 있든 말든 돌도록 API 를 거치지 않고 DB 에 직접 쓴다. Signals 페이지의 "지금 확인"과
같은 함수(services/signal_monitor.run_check)를 부른다.

시장마다 장이 끝난 날까지만 시세를 받으므로, 한국장 마감 뒤(16:40)와 미국장 마감 뒤(07:10)
두 번 돌리면 각각 그날 봉으로 판정한다. 아직 끝나지 않은 시장의 종목은 받을 것이 없어 지나간다.
"""
import logging
import os
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
os.chdir(BASE_DIR)  # database.py 가 상대 경로라 다른 곳에서 돌리면 빈 DB 를 새로 만든다
sys.path.insert(0, str(BASE_DIR))

LOG_PATH = BASE_DIR / "logs" / "signal_monitor.log"
LOG_PATH.parent.mkdir(exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[logging.FileHandler(LOG_PATH), logging.StreamHandler()],
)
log = logging.getLogger("signals")


def main() -> int:
    from database import Base, SessionLocal, engine, ensure_columns
    import models  # noqa: F401 - 테이블 등록
    from models import SignalEvent
    from services import signal_monitor

    Base.metadata.create_all(bind=engine)
    ensure_columns()

    db = SessionLocal()
    try:
        run = signal_monitor.run_check(db, "schedule")
        log.info("완료 — %d종목 · 새 신호 %d · 실패 %d", run.tickers, run.new_events, len(run.failed))
        for f in run.failed:
            log.warning("  실패: %s %s", f["ticker"], f["error"])
        if run.new_events:
            for e in db.query(SignalEvent).filter(SignalEvent.detected_at >= run.started_at).all():
                log.info("  신호: %s %s %s %s @ %s", e.date, e.watch.ticker, e.watch.strategy_name, e.action, e.price)
        # 보유 종목: KIS 잔고·체결을 읽고(조회만) 계좌 스냅샷을 남긴다. 키가 없으면 시세만 받는다.
        from services import kis_client, portfolio
        if kis_client.config()["configured"] and kis_client.account_hint():
            try:
                r = portfolio.sync_kis(db)
                log.info("KIS 동기화 — 국내 %d · 해외 %d · 체결 %d", r["domestic"], r["overseas"], r["executions"])
                for err in r["errors"]:
                    log.warning("  %s", err)
            except Exception:  # noqa: BLE001 - 신호 확인 결과는 이미 저장됐다
                db.rollback()
                log.exception("KIS 동기화 실패")
        else:
            for err in portfolio.refresh_prices(db):
                log.warning("  %s", err)
        return 1 if run.tickers and len(run.failed) >= run.tickers else 0
    finally:
        db.close()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:  # noqa: BLE001 - 어떤 실패든 로그에 남기고 끝낸다
        log.exception("신호 확인이 중단되었습니다")
        sys.exit(1)
