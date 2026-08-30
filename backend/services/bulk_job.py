"""여러 종목을 한꺼번에 받아오는 백그라운드 작업.

S&P 500을 5년치만 받아도 60만 행이 넘어 2분 이상 걸린다. 동기 요청으로
처리하면 브라우저가 그동안 응답을 기다려야 하므로, 작업을 백그라운드로
돌리고 프론트가 진행률을 폴링한다.

동시에 한 작업만 돈다. 같은 테이블에 두 작업이 쓰면 진행률 집계가 꼬이고
야후 쪽 요청 한도에도 걸리기 쉽다.
"""
import threading
from datetime import date, datetime

import pandas as pd
import yfinance as yf

from database import SessionLocal
from services.data_fetcher import insert_rows
from services import investor_flow, kis_client

# 한 번에 요청할 종목 수. 너무 크면 야후가 일부를 조용히 비워서 돌려준다.
CHUNK = 50

_lock = threading.Lock()
_job: dict = {
    "running": False,
    "universe": "",
    "phase": "",          # prices / flows
    "total": 0,
    "done": 0,
    "added": 0,
    "failed": [],
    "flow_total": 0,      # 수급 수집은 시세와 진행률을 따로 센다
    "flow_done": 0,
    "flow_added": 0,
    "started_at": None,
    "finished_at": None,
    "error": None,
}


def status() -> dict:
    with _lock:
        return dict(_job, failed=list(_job["failed"]))


def reserve(universe: str) -> bool:
    """자리를 선점한다. 이미 도는 작업이 있으면 False.

    확인과 설정을 한 락 안에서 함께 해야 한다. "is_running()으로 보고 나서
    작업을 걸어 둔다"는 순서로는 막히지 않는다 — running=True가 되는 시점이
    백그라운드 작업이 실제로 시작된 뒤라서, 그 틈에 들어온 두 번째 요청도
    검사를 통과한다. 실제로 두 작업이 같은 카운터를 쓰면서 진행률이
    702/199처럼 망가진 적이 있다.
    """
    with _lock:
        if _job["running"]:
            return False
        _job.update(
            running=True, universe=universe, phase="prices", total=0, done=0, added=0,
            failed=[], flow_total=0, flow_done=0, flow_added=0,
            started_at=datetime.utcnow(), finished_at=None, error=None,
        )
        return True


def release(error: str | None = None) -> None:
    """선점만 하고 시작하지 못했을 때 되돌린다."""
    with _lock:
        _job.update(running=False, finished_at=datetime.utcnow(), error=error)


def is_running() -> bool:
    with _lock:
        return _job["running"]


def _frame_for(raw: pd.DataFrame, ticker: str) -> pd.DataFrame | None:
    """배치 응답에서 한 종목의 프레임을 꺼내 data_fetcher가 쓰는 형태로 맞춘다."""
    if isinstance(raw.columns, pd.MultiIndex):
        if ticker not in raw.columns.get_level_values(0):
            return None
        df = raw[ticker].copy()
    else:
        df = raw.copy()
    df = df.reset_index()
    df.columns = [str(c).lower() for c in df.columns]
    if "date" not in df.columns or df.empty:
        return None
    return df


def _collect_flows(db, tickers: list[str], months: int) -> None:
    """한국 종목의 투자자 매매동향을 이어서 받는다.

    시세와 분리된 단계다. 증권사 API는 유량 제한이 빡빡해 종목당 0.6초씩 쉬어야 하고,
    처음 받을 때는 30거래일씩 세 번 거슬러 올라간다. 시세(40초)보다 훨씬 오래 걸리므로
    진행률을 따로 센다. 이미 채워 둔 종목은 호출 한 번으로 끝난다.
    """
    korean = [t for t in tickers if investor_flow.is_korean(t)]
    with _lock:
        _job.update(phase="flows", flow_total=len(korean))
    if not korean:
        return

    for ticker in korean:
        try:
            result = investor_flow.sync(db, ticker, months)
        except Exception as e:  # noqa: BLE001 - 종목 하나가 막혀도 나머지는 계속한다
            db.rollback()
            with _lock:
                _job["failed"].append(f"{ticker} 수급: {str(e)[:80]}")
        else:
            with _lock:
                _job["flow_added"] += result["added"]
        finally:
            with _lock:
                _job["flow_done"] += 1


def run(universe: str, tickers: list[str], start_date: date, end_date: date,
        with_flows: bool = True, flow_months: int = investor_flow.DEFAULT_MONTHS) -> None:
    """작업 본체. BackgroundTasks가 스레드풀에서 호출한다. reserve() 이후에만 부른다."""
    # 선점은 엔드포인트에서 이미 끝났다. 여기서는 총 개수만 채운다.
    with _lock:
        _job["total"] = len(tickers)
    db = SessionLocal()
    try:
        for i in range(0, len(tickers), CHUNK):
            chunk = tickers[i : i + CHUNK]
            try:
                raw = yf.download(
                    chunk, start=str(start_date), end=str(end_date),
                    progress=False, group_by="ticker", threads=True, auto_adjust=True,
                )
            except Exception as e:  # noqa: BLE001 - 청크 단위로 격리한다
                with _lock:
                    _job["failed"].extend(f"{t}: {str(e)[:80]}" for t in chunk)
                    _job["done"] += len(chunk)
                continue

            for ticker in chunk:
                try:
                    df = _frame_for(raw, ticker)
                    added = 0 if df is None else insert_rows(db, ticker, df)
                    if df is None:
                        raise ValueError("응답에 데이터 없음")
                except Exception as e:  # noqa: BLE001 - 종목 하나 때문에 멈추지 않는다
                    db.rollback()
                    with _lock:
                        _job["failed"].append(f"{ticker}: {str(e)[:80]}")
                else:
                    with _lock:
                        _job["added"] += added
                finally:
                    with _lock:
                        _job["done"] += 1
        # 시세를 다 받은 뒤에 수급을 받는다. 키가 없으면 조용히 건너뛴다 —
        # 미국 지수를 받는 사람에게 증권사 키를 요구할 이유가 없다.
        if with_flows and kis_client.config()["configured"]:
            _collect_flows(db, tickers, flow_months)
    except Exception as e:  # noqa: BLE001 - 예기치 못한 중단도 상태에 남긴다
        with _lock:
            _job["error"] = str(e)[:200]
    finally:
        db.close()
        with _lock:
            _job["running"] = False
            _job["phase"] = ""
            _job["finished_at"] = datetime.utcnow()
