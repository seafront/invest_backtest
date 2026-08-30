#!/usr/bin/env python3
"""매일 한 번 스냅샷을 찍는다. launchd가 부른다.

목표주가·시가총액·투자의견은 어느 소스도 과거를 주지 않는다. 오늘 찍지 않으면
오늘의 값은 사라지고, "목표가가 올랐나"는 영영 답할 수 없다. 그래서 서버가 떠
있든 말든 도는 독립 스크립트로 둔다 — API를 거치지 않고 DB에 직접 쓴다.

작업 디렉터리를 backend/ 로 옮기고 시작하는 것이 중요하다. database.py 의 경로가
`sqlite:///./backtest.db` 라 다른 곳에서 실행하면 빈 DB가 새로 만들어진다.
"""
import logging
import os
import sys
from datetime import date, datetime
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
os.chdir(BASE_DIR)
sys.path.insert(0, str(BASE_DIR))

LOG_PATH = BASE_DIR / "logs" / "daily_snapshot.log"
LOG_PATH.parent.mkdir(exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[logging.FileHandler(LOG_PATH), logging.StreamHandler()],
)
log = logging.getLogger("snapshot")


def main() -> int:
    from database import Base, SessionLocal, engine, ensure_columns
    import models  # noqa: F401 - 테이블 등록
    from services import snapshots
    from services.data_fetcher import list_cached_tickers

    Base.metadata.create_all(bind=engine)
    ensure_columns()

    db = SessionLocal()
    try:
        tickers = [r["ticker"] for r in list_cached_tickers(db)]
        if not tickers:
            log.warning("캐시된 종목이 없습니다. 건너뜁니다.")
            return 0

        started = datetime.now()
        log.info("시작 — %d종목", len(tickers))
        result = snapshots.capture_many(db, tickers)
        elapsed = (datetime.now() - started).total_seconds()

        log.info(
            "완료 — 성공 %d · 실패 %d · %.1f분",
            result["done"], result["failed"], elapsed / 60,
        )
        for err in result["errors"][:5]:
            log.warning("  실패: %s", err)

        # 오늘 실제로 몇 종목이 남았는지 확인한다. 성공 수와 다르면 저장이 어긋난 것이다.
        from models import Snapshot
        stored = db.query(Snapshot).filter(Snapshot.date == date.today()).count()
        log.info("오늘 저장된 스냅샷: %d행", stored)

        # 전부 실패했으면 launchd 로그에 남도록 0이 아닌 값을 돌려준다.
        return 1 if result["done"] == 0 else 0
    finally:
        db.close()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:  # noqa: BLE001 - 어떤 실패든 로그에 남기고 끝낸다
        log.exception("스냅샷 작업이 중단되었습니다")
        sys.exit(1)
