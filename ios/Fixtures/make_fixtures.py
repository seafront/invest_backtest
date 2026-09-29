"""iOS 앱(BacktestCore)이 맞춰야 할 정답을 백엔드 코드로 만든다.

/backtests/auto 와 같은 계산을 서버 캐시의 시세로 돌려, 입력 시세와 결과를 함께 JSON으로 쓴다.
Swift 테스트는 같은 시세를 넣어 결과가 같은지 본다 — 시세 차이를 빼고 계산만 비교하려는 것이다.
끝 날짜를 고정해야 매번 같은 정답이 나오므로 오늘이 아니라 --end 를 쓴다.

    cd backend && source venv/bin/activate
    python ../ios/Fixtures/make_fixtures.py                     # 저장소에 넣는 기본 종목
    python ../ios/Fixtures/make_fixtures.py --universe --out /tmp/ndx   # 나스닥 100 전부

롤링 비교(B&H 승률·초과 중앙값)는 이어서 rolling_expected.mjs 가 웹의 rolling.ts 로 채운다.
"""
import argparse
import json
import os
import sys
from datetime import date, timedelta
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2] / "backend"
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)  # database.py 가 ./backtest.db 를 연다

from database import SessionLocal  # noqa: E402
from models import IndexMember  # noqa: E402
from routers.backtests import _summarize, _trading_span, _years_before  # noqa: E402
from schemas import AutoBacktestResponse  # noqa: E402
from services.backtest_engine import run_backtest, warmup_days  # noqa: E402
from services.data_fetcher import get_cached_data  # noqa: E402
from services.strategies import list_strategies  # noqa: E402

# AAPL 배당, NVDA 2024 분할, TSLA 큰 변동, ALAB 5년보다 짧은 상장, HONA 대부분 전략이 준비 구간도 못 채움,
# FER 상장 전 구간을 같은 가격으로 채운 시세(이동 표준편차가 정확히 0이어야 한다)
DEFAULT_TICKERS = ["AAPL", "NVDA", "TSLA", "ALAB", "HONA", "FER"]
YEARS = 5
# 웹 Auto 화면의 달러 기본값. 적립식이면 초기 자본을 0으로 보낸다(AutoBacktest.tsx).
CASES = [
    {"invest_mode": "lump_sum", "initial_capital": 100_000.0, "monthly_contribution": 0.0},
    {"invest_mode": "dca", "initial_capital": 0.0, "monthly_contribution": 1_000.0},
]


def auto(ticker: str, end: date, case: dict, df) -> dict:
    """routers/backtests.py auto_backtest() 의 본문. 시세만 미리 읽은 것을 쓴다."""
    start = _years_before(end, YEARS)
    data_start, data_end = _trading_span(df, start)
    results, failed = [], []
    total_invested = 0.0
    for strategy in list_strategies():
        params = {p["name"]: p["default"] for p in strategy.param_schema}
        try:
            frame = df[df["date"] >= start - timedelta(days=warmup_days(strategy.name, params))]
            r = run_backtest(frame, strategy.name, params, case["initial_capital"],
                             case["monthly_contribution"], case["invest_mode"], trade_start=start)
        except Exception as e:  # noqa: BLE001
            failed.append({"strategy_name": strategy.name, "display_name": strategy.display_name,
                           "error": str(e)[:200]})
            continue
        total_invested = r["total_invested"]
        results.append(_summarize(strategy, params, r, case["invest_mode"],
                                  case["initial_capital"], case["monthly_contribution"]))
    results.sort(key=lambda x: x["total_return"], reverse=True)
    res = AutoBacktestResponse(
        ticker=ticker, start_date=start, end_date=end, data_start=data_start, data_end=data_end,
        invest_mode=case["invest_mode"], total_invested=total_invested, results=results, failed=failed,
    )
    return res.model_dump(mode="json")


def fixture(db, ticker: str, end: date) -> dict:
    start = _years_before(end, YEARS)
    warm = max(warmup_days(s.name, {p["name"]: p["default"] for p in s.param_schema})
               for s in list_strategies())
    df = get_cached_data(db, ticker, start - timedelta(days=warm), end)
    if len(df[df["date"] >= start]) < 2:
        raise ValueError(f"{ticker} 시세가 부족합니다")
    prices = [
        {"date": str(r.date), "open": r.open, "high": r.high, "low": r.low,
         "close": r.close, "volume": int(r.volume)}
        for r in df.itertuples()
    ]
    return {
        "ticker": ticker,
        "end_date": str(end),
        "years": YEARS,
        "prices": prices,
        "cases": [{**case, "expected": auto(ticker, end, case, df)} for case in CASES],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--end", default="2026-09-28", help="고정 끝 날짜 (기본: 정답을 처음 만든 날의 마지막 거래일)")
    ap.add_argument("--universe", action="store_true", help="나스닥 100 전 종목")
    ap.add_argument("--out", default=str(Path(__file__).resolve().parents[1]
                                         / "BacktestCore/Tests/BacktestCoreTests/Fixtures"))
    ap.add_argument("tickers", nargs="*")
    args = ap.parse_args()

    end = date.fromisoformat(args.end)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    db = SessionLocal()
    try:
        if args.universe:
            tickers = sorted(t for (t,) in db.query(IndexMember.ticker)
                             .filter(IndexMember.universe == "nasdaq100"))
        else:
            tickers = args.tickers or DEFAULT_TICKERS
        for t in tickers:
            try:
                fx = fixture(db, t, end)
            except ValueError as e:
                print(f"skip {t}: {e}")
                continue
            (out / f"{t}.json").write_text(json.dumps(fx, separators=(",", ":")))
            fails = sum(len(c["expected"]["failed"]) for c in fx["cases"])
            print(f"{t}: {len(fx['prices'])} bars, failed={fails}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
