"""지수 일괄 수집을 서버 밖에서 돌린다.

개발 서버는 `uvicorn --reload`로 떠 있어서 파이썬 파일을 저장할 때마다 재시작되고, 그 순간
서버 안에서 돌던 수집 작업이 죽는다. 수급 5년치를 처음 채우는 데 2시간이 넘게 걸리므로
개발 중에는 거의 끝까지 가지 못한다. 이 스크립트는 같은 수집 코드(services/bulk_job)를
별도 프로세스로 돌려, 코드를 고쳐도 수집이 계속되게 한다.

진행 상황은 상태 파일에 적어 두고, 서버의 /api/stocks/bulk-fetch/status 가 그것을 읽어
Data Manager의 진행 막대에 그대로 나온다.

    cd backend && source venv/bin/activate
    python collect.py kospi200                    # 시세 5년 + 수급 5년
    python collect.py sp500 --no-flows            # 미국 지수는 수급이 없다
    python collect.py kospi200 --fundamentals     # 재무만
    python collect.py kospi200 --tickers 023530.KS,024110.KS   # 몇 종목만 다시

이미 받은 날짜는 건너뛰므로 중간에 끊겨도 다시 실행하면 이어서 받는다.
"""
import argparse
import os
import subprocess
import sys
import threading
import time
from datetime import date, timedelta
from pathlib import Path

# DB 경로가 "./backtest.db"(상대 경로)라 어디서 실행하든 backend/ 기준으로 맞춘다.
# 다른 곳에서 돌리면 빈 DB가 새로 만들어져 거기에 받게 된다.
os.chdir(Path(__file__).resolve().parent)

from services import bulk_job, investor_flow, kis_client  # noqa: E402
from services.universe import SOURCES, symbols  # noqa: E402

POLL_SECONDS = 5


def _years_before(d: date, years: int) -> date:
    try:
        return d.replace(year=d.year - years)
    except ValueError:  # 2월 29일
        return d.replace(year=d.year - years, day=28)


def _keep_awake() -> subprocess.Popen | None:
    """macOS에서 수집하는 동안 유휴 절전을 막는다.

    배터리로 덮개를 닫으면(clamshell) 이것으로도 막을 수 없다 — 그때는 전원을 연결하거나
    덮개를 열어 두어야 한다. 2026-09 수급 수집이 덮개를 닫은 4시간 동안 멈춰 있었다.
    """
    if sys.platform != "darwin":
        return None
    try:
        return subprocess.Popen(["caffeinate", "-i", "-w", str(os.getpid())])
    except OSError:
        return None


def _progress_line(s: dict) -> str:
    phase = s.get("phase") or "-"
    if phase == "flows":
        return f"수급 {s['flow_done']}/{s['flow_total']} · 신규 {s['flow_added']:,}일 · 실패 {len(s['failed'])}"
    if phase == "fundamentals":
        return f"재무 {s['fund_done']}/{s['fund_total']} · 신규 {s['fund_added']:,}기간 · 실패 {len(s['failed'])}"
    return f"시세 {s['done']}/{s['total']} · 신규 {s['added']:,}행 · 실패 {len(s['failed'])}"


def main() -> int:
    parser = argparse.ArgumentParser(description="지수 구성종목의 시세·수급·재무를 서버 밖에서 수집한다.")
    parser.add_argument("universe", choices=sorted(SOURCES), help="지수")
    parser.add_argument("--years", type=int, default=5, help="시세 기간(년). 기본 5")
    parser.add_argument("--no-flows", action="store_true", help="투자자 수급을 받지 않는다")
    parser.add_argument("--flow-months", type=int, default=investor_flow.DEFAULT_MONTHS,
                        help=f"수급 기간(개월). 기본 {investor_flow.DEFAULT_MONTHS}")
    parser.add_argument("--fundamentals", action="store_true", help="시세·수급 대신 재무만 받는다")
    parser.add_argument("--tickers", help="쉼표로 구분한 종목만 받는다 (예: 023530.KS,024110.KS)")
    parser.add_argument("--no-caffeinate", action="store_true", help="macOS 유휴 절전 방지를 끈다")
    args = parser.parse_args()

    try:
        bulk_job.claim_external()
    except bulk_job.AlreadyRunning as e:
        print(f"시작하지 않았습니다: {e}", file=sys.stderr)
        return 1

    awake = None if args.no_caffeinate else _keep_awake()
    try:
        if args.tickers:
            tickers = [t.strip().upper() for t in args.tickers.split(",") if t.strip()]
        else:
            print(f"{SOURCES[args.universe]['label']} 구성종목을 받는 중…", flush=True)
            tickers = symbols(args.universe)
            # 서버 엔드포인트와 같이 편입 정보·회사 이름부터 갱신한다.
            from database import SessionLocal
            from services.data_fetcher import sync_universe
            db = SessionLocal()
            try:
                sync_universe(db, args.universe)
            finally:
                db.close()

        end = date.today()
        start = _years_before(end, args.years)
        if not bulk_job.reserve(args.universe):
            print("이 프로세스 안에서 이미 작업이 돌고 있습니다", file=sys.stderr)
            return 1

        if args.fundamentals:
            target, targs = bulk_job.run_fundamentals, (args.universe, tickers)
            print(f"{len(tickers)}종목 재무 수집을 시작합니다", flush=True)
        else:
            with_flows = not args.no_flows
            target = bulk_job.run
            targs = (args.universe, tickers, start, end, with_flows, args.flow_months)
            flows_note = ""
            if with_flows and not kis_client.config()["configured"]:
                flows_note = " (증권사 키가 없어 수급은 건너뜁니다)"
            print(f"{len(tickers)}종목 · 시세 {start} ~ {end}{flows_note}", flush=True)

        worker = threading.Thread(target=target, args=targs, daemon=True)
        worker.start()
        began = time.time()
        last = ""
        while worker.is_alive():
            worker.join(POLL_SECONDS)
            status = bulk_job.status()
            bulk_job.write_external_status(status)
            line = _progress_line(status)
            if line != last:
                print(f"[{time.strftime('%H:%M:%S')}] {line}", flush=True)
                last = line

        status = bulk_job.status()
        bulk_job.write_external_status(status)
        took = timedelta(seconds=int(time.time() - began))
        # 끝나면 단계가 비워져 한 줄로는 마지막 단계를 알 수 없다. 돌았던 단계를 모두 적는다.
        print(f"\n끝났습니다 ({took})")
        for phase, ran in (("", status["total"]), ("flows", status["flow_total"]), ("fundamentals", status["fund_total"])):
            if ran:
                print(f"  {_progress_line({**status, 'phase': phase})}")
        if status["failed"]:
            print("실패한 종목:")
            for f in status["failed"]:
                print(f"  {f}")
            codes = sorted({f.split()[0].rstrip(":") for f in status["failed"]})
            print(f"\n다시 받으려면: python collect.py {args.universe} --tickers {','.join(codes)}")
        if status["error"]:
            print(f"중단 사유: {status['error']}", file=sys.stderr)
            return 2
        return 0
    except KeyboardInterrupt:
        print("\n중단했습니다. 다시 실행하면 받은 곳부터 이어서 받습니다.", file=sys.stderr)
        return 130
    finally:
        bulk_job.release_external()
        if awake is not None:
            awake.terminate()


if __name__ == "__main__":
    sys.exit(main())
