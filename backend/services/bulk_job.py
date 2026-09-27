"""여러 종목을 한꺼번에 받아오는 백그라운드 작업.

S&P 500을 5년치만 받아도 60만 행이 넘어 2분 이상 걸린다. 동기 요청으로
처리하면 브라우저가 그동안 응답을 기다려야 하므로, 작업을 백그라운드로
돌리고 프론트가 진행률을 폴링한다.

동시에 한 작업만 돈다. 같은 테이블에 두 작업이 쓰면 진행률 집계가 꼬이고
야후 쪽 요청 한도에도 걸리기 쉽다.
"""
import json
import os
import threading
import urllib.request
from datetime import date, datetime
from pathlib import Path

import pandas as pd

from database import SessionLocal
from services.data_fetcher import insert_rows, yf_download
from services import fundamentals, investor_flow, kis_client

# 한 번에 요청할 종목 수. 너무 크면 야후가 일부를 조용히 비워서 돌려준다.
CHUNK = 50

# 이만큼 연달아 실패하면 작업을 멈춘다. 종목 하나의 문제(상장폐지 등)는 흩어져 나오지만,
# 키 만료·시간 제한·소스 폐지처럼 원인이 공통이면 모든 종목이 같은 이유로 실패한다 —
# 수급은 종목당 0.6초 이상 쉬므로 200종목을 끝까지 돌면 실패만 쌓으며 몇 분을 쓴다.
MAX_CONSECUTIVE_FAILURES = 5


class _Abort(RuntimeError):
    """연속 실패로 단계를 멈춘다. 메시지가 그대로 작업 error가 된다."""


class _Streak:
    """연속 실패 수를 센다. 성공 한 번이면 초기화된다."""

    def __init__(self, label: str):
        self.label = label
        self.count = 0

    def ok(self) -> None:
        self.count = 0

    def fail(self, error: Exception | str) -> None:
        self.count += 1
        if self.count >= MAX_CONSECUTIVE_FAILURES:
            raise _Abort(f"{self.label} {self.count}종목 연속 실패로 중단했습니다 — {str(error)[:150]}")

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
    "fund_total": 0,      # 재무도 마찬가지. 종목당 호출 수가 달라 시세와 못 합친다
    "fund_done": 0,
    "fund_added": 0,
    "started_at": None,
    "finished_at": None,
    "error": None,
}


# ── 서버 밖(collect.py)에서 도는 수집 ─────────────────────────────────────────
# 개발 서버는 --reload 로 재시작될 때마다 안에서 돌던 수집을 잃는다. collect.py가 같은 코드를
# 별도 프로세스로 돌리고, 서버는 아래 파일로 그 진행을 읽어 화면에 보여 준다. 두 곳에서 동시에
# 돌면 증권사 호출 한도를 나눠 쓰다 서로 거절당하므로, 한쪽이 돌면 다른 쪽은 시작하지 않는다.
_BACKEND_DIR = Path(__file__).resolve().parent.parent
EXTERNAL_LOCK = _BACKEND_DIR / ".collect.lock"
EXTERNAL_STATUS = _BACKEND_DIR / ".collect_status.json"
SERVER_STATUS_URL = "http://localhost:8000/api/stocks/bulk-fetch/status"


class AlreadyRunning(RuntimeError):
    pass


def _pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def external_pid() -> int | None:
    """collect.py가 돌고 있으면 그 pid. 강제 종료로 남은 잠금 파일은 무시한다."""
    try:
        pid = int(EXTERNAL_LOCK.read_text().strip())
    except (OSError, ValueError):
        return None
    return pid if pid != os.getpid() and _pid_alive(pid) else None


def claim_external() -> None:
    """collect.py 시작 전에 부른다. 다른 수집이 돌고 있으면 AlreadyRunning."""
    other = external_pid()
    if other:
        raise AlreadyRunning(f"다른 collect.py가 이미 돌고 있습니다 (pid {other})")
    # 서버 안에서 도는 작업은 서버 메모리에만 있어 HTTP로 물어본다. 서버가 꺼져 있으면 그냥 진행한다.
    try:
        with urllib.request.urlopen(SERVER_STATUS_URL, timeout=3) as res:
            server = json.load(res)
        if server.get("running") and not server.get("external"):
            raise AlreadyRunning(
                f"서버에서 {server.get('universe')} 수집이 돌고 있습니다 — 끝난 뒤 실행하세요"
            )
    except AlreadyRunning:
        raise
    except Exception:  # noqa: BLE001 - 서버가 없거나 응답이 없으면 확인할 대상이 없다
        pass
    EXTERNAL_LOCK.write_text(str(os.getpid()))


def release_external() -> None:
    try:
        if EXTERNAL_LOCK.read_text().strip() == str(os.getpid()):
            EXTERNAL_LOCK.unlink()
    except OSError:
        pass


def write_external_status(snapshot: dict) -> None:
    data = {k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in snapshot.items()}
    tmp = EXTERNAL_STATUS.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False))
    tmp.replace(EXTERNAL_STATUS)  # 서버가 반쯤 쓴 파일을 읽지 않도록 바꿔치기한다


def read_external_status() -> dict | None:
    """collect.py가 남긴 마지막 진행 상황. 프로세스가 죽었으면 running=False로 돌려준다."""
    try:
        data = json.loads(EXTERNAL_STATUS.read_text())
    except (OSError, ValueError):
        return None
    alive = external_pid() is not None
    data["running"] = bool(data.get("running")) and alive
    data["external"] = True
    return data


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
            fund_total=0, fund_done=0, fund_added=0,
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

    streak = _Streak("수급")
    for ticker in korean:
        try:
            result = investor_flow.sync(db, ticker, months)
        except Exception as e:  # noqa: BLE001 - 종목 하나가 막혀도 나머지는 계속한다
            db.rollback()
            with _lock:
                _job["failed"].append(f"{ticker} 수급: {str(e)[:80]}")
                _job["flow_done"] += 1
            streak.fail(e)
        else:
            streak.ok()
            with _lock:
                _job["flow_added"] += result["added"]
                _job["flow_done"] += 1


def _collect_fundamentals(db, tickers: list[str]) -> None:
    """종목별로 가장 깊은 소스에서 재무를 받는다.

    한국 종목은 KIS가 분기 30개·연간 23개를 주는데, 주기마다 손익·재무상태·재무비율
    세 번을 호출하므로 종목당 여섯 번이다. 0.6초 간격을 지키면 200종목에 12분쯤
    걸린다 — 시세(40초)와 같은 진행률에 넣으면 거의 멈춘 것처럼 보인다.
    """
    with _lock:
        _job.update(phase="fundamentals", fund_total=len(tickers))

    streak = _Streak("재무")
    for ticker in tickers:
        try:
            result = fundamentals.sync_best(db, ticker)
        except Exception as e:  # noqa: BLE001 - 한 종목이 막혀도 나머지는 계속한다
            db.rollback()
            with _lock:
                _job["failed"].append(f"{ticker} 재무: {str(e)[:80]}")
                _job["fund_done"] += 1
            streak.fail(e)
        else:
            streak.ok()
            with _lock:
                _job["fund_added"] += result["added"]
                _job["fund_done"] += 1


def run_fundamentals(universe: str, tickers: list[str]) -> None:
    """재무만 받는다. 시세·수급과 달리 따로 부를 일이 많아 진입점을 나눴다."""
    db = SessionLocal()
    try:
        _collect_fundamentals(db, tickers)
    except Exception as e:  # noqa: BLE001 - _Abort 포함, 중단 사유를 상태에 남긴다
        with _lock:
            _job["error"] = str(e)[:200]
    finally:
        db.close()
        _finish()


def run(universe: str, tickers: list[str], start_date: date, end_date: date,
        with_flows: bool = True, flow_months: int = investor_flow.DEFAULT_MONTHS) -> None:
    """작업 본체. BackgroundTasks가 스레드풀에서 호출한다. reserve() 이후에만 부른다."""
    # 선점은 엔드포인트에서 이미 끝났다. 여기서는 총 개수만 채운다.
    with _lock:
        _job["total"] = len(tickers)
    db = SessionLocal()
    streak = _Streak("시세")
    try:
        for i in range(0, len(tickers), CHUNK):
            chunk = tickers[i : i + CHUNK]
            try:
                raw = yf_download(
                    chunk, start=str(start_date), end=str(end_date),
                    progress=False, group_by="ticker", threads=True, auto_adjust=True,
                )
            except Exception as e:  # noqa: BLE001 - 청크 단위로 격리한다
                with _lock:
                    _job["failed"].extend(f"{t}: {str(e)[:80]}" for t in chunk)
                    _job["done"] += len(chunk)
                # 청크 전체가 실패했다면 종목 수만큼 연속 실패다.
                for _ in chunk:
                    streak.fail(e)
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
                        _job["done"] += 1
                    streak.fail(e)
                else:
                    streak.ok()
                    with _lock:
                        _job["added"] += added
                        _job["done"] += 1
        # 시세를 다 받은 뒤에 수급을 받는다. 키가 없으면 조용히 건너뛴다 —
        # 미국 지수를 받는 사람에게 증권사 키를 요구할 이유가 없다.
        if with_flows and kis_client.config()["configured"]:
            _collect_flows(db, tickers, flow_months)
    except Exception as e:  # noqa: BLE001 - _Abort와 예기치 못한 중단 모두 상태에 남긴다
        with _lock:
            _job["error"] = str(e)[:200]
    finally:
        db.close()
        _finish()


def _finish() -> None:
    with _lock:
        _job["running"] = False
        # 중단됐으면 어느 단계에서 멈췄는지 화면이 알 수 있게 단계를 남긴다.
        if not _job["error"]:
            _job["phase"] = ""
        _job["finished_at"] = datetime.utcnow()
