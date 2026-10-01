"""iOS 앱(BacktestCore)이 맞춰야 할 정답을 백엔드 코드로 만든다.

/backtests/auto 와 같은 계산을 서버 캐시의 시세로 돌려, 입력 시세와 결과를 함께 JSON으로 쓴다.
Swift 테스트는 같은 시세를 넣어 결과가 같은지 본다 — 시세 차이를 빼고 계산만 비교하려는 것이다.
끝 날짜를 고정해야 매번 같은 정답이 나오므로 오늘이 아니라 --end 를 쓴다.

Leaderboard 표에 더해 Tear Sheet 가 쓰는 값(매매 기록, 추세 구간, 차트 지표)도 싣는다.

    cd backend && source venv/bin/activate
    python ../ios/Fixtures/make_fixtures.py                               # 저장소에 넣는 기본 종목
    python ../ios/Fixtures/make_fixtures.py --universe sp500 --out DIR    # 한 지수 전부

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
import routers.backtests as bt  # noqa: E402
from routers.backtests import _summarize, _trading_span, _years_before  # noqa: E402
from schemas import AutoBacktestResponse, SimulateRequest  # noqa: E402
from services import optimizer, regimes  # noqa: E402
from services.backtest_engine import run_backtest, warmup_days  # noqa: E402
from services.data_fetcher import get_cached_data  # noqa: E402
from services.strategies import list_strategies  # noqa: E402

# AAPL 배당, NVDA 2024 분할, TSLA 큰 변동, ALAB 5년보다 짧은 상장, HONA 대부분 전략이 준비 구간도 못 채움,
# FER 상장 전 구간을 같은 가격으로 채운 시세(이동 표준편차가 정확히 0이어야 한다),
# BRK-B 티커에 하이픈, 005930.KS 원화(주가가 커서 정수 주 계산이 달러와 다르다),
# 007310.KS %K 와 %D 가 수학적으로 같은 날 — pandas 이동평균의 끝자리 오차가 교차 판정을 가른다,
# TQQQ 3배 레버리지 ETF (웹 Leaderboard 의 기본 종목, 앱 ETF 탭)
DEFAULT_TICKERS = ["AAPL", "NVDA", "TSLA", "ALAB", "HONA", "FER", "BRK-B", "005930.KS", "007310.KS", "TQQQ"]
YEARS = 5
# 웹 Auto 화면의 통화별 기본값. 적립식이면 초기 자본을 0으로 보낸다(AutoBacktest.tsx).
AMOUNTS = {"USD": (100_000.0, 1_000.0), "KRW": (100_000_000.0, 1_000_000.0)}
# 차트 지표는 길어서 이 간격마다 한 점(과 마지막 점)만 싣는다
INDICATOR_STEP = 20


def months_before(d: date, n: int) -> date:
    """웹 utils/date.ts monthsBefore 와 같다 — 없는 날짜는 넘어간다(8/31 의 6개월 전은 3/3)."""
    y, m = divmod(d.year * 12 + d.month - 1 - n, 12)
    return date(y, m + 1, 1) + timedelta(days=d.day - 1)


def variant_params(strategy) -> list[dict]:
    """파라미터를 기본값에서 바꾼 조합 둘. 최적화 격자(axis_values)의 앞쪽·뒤쪽 칸을 쓴다."""
    schema = strategy.param_schema
    out = []
    for k in (2, 8):
        params = {p["name"]: optimizer.axis_values(p)[min(k, len(optimizer.axis_values(p)) - 1)] for p in schema}
        if not optimizer.valid(params):  # fast < slow 를 지키도록
            params["fast_period"] = optimizer.axis_values(next(p for p in schema if p["name"] == "fast_period"))[1]
        out.append(params)
    return out


def comparisons(db, ticker: str, end: date, df) -> list[dict]:
    """파라미터 비교 (POST /backtests/simulate). 원래 값 + 변형 둘, 거치식만 (크기 때문에).

    simulate() 를 그대로 부르되 시세는 캐시에서만 읽는다 — 상장이 늦은 종목은 원래 yfinance 로
    다시 받으려 해 DB 를 건드린다.
    """
    capital = cases(ticker)[0]["initial_capital"]
    start = _years_before(end, YEARS)
    out = []
    orig = bt._load_prices
    bt._load_prices = lambda _db, _t, s, e: df[(df["date"] >= s) & (df["date"] <= e)].reset_index(drop=True)
    try:
        for strategy in list_strategies():
            if not strategy.param_schema:
                continue
            defaults = {p["name"]: p["default"] for p in strategy.param_schema}
            req = SimulateRequest(ticker=ticker, strategy_name=strategy.name, start_date=start, end_date=end,
                                  invest_mode="lump_sum", initial_capital=capital,
                                  param_sets=[defaults, *variant_params(strategy)])
            res = bt.simulate(req, db)

            def row(r):
                return {k: r[k] for k in ("params", "total_return", "cagr", "sharpe_ratio", "max_drawdown",
                                          "win_rate", "trades_count", "regime_returns")} | {
                    "first_trade": None if r["first_trade"] is None else str(r["first_trade"]),
                    "curve": [[str(p["date"]), p["ret"], p["idx"]] for i, p in enumerate(r["curve"]) if i % 10 == 0],
                }
            out.append({
                "strategy_name": strategy.name,
                "benchmark": row(res["benchmark"]),
                "results": [row(r) for r in res["results"]],
                "regimes": [{**g, "start": str(g["start"]), "end": str(g["end"])} for g in res["regimes"]],
                "regime_threshold": res["regime_threshold"],
            })
    finally:
        bt._load_prices = orig
    return out


def period_cases(end: date, case: dict, df) -> list[dict]:
    """Tear Sheet 의 계산 구간 (routers/backtests.py _backtest_over_period).

    최근 1년 빠른 선택과, 가운데를 잘라 낸 임의 구간 하나. 구간 앞 시세로 지표를 준비한다.
    """
    start5 = _years_before(end, YEARS)
    periods = [(months_before(end, 12), end), (start5 + timedelta(days=500), start5 + timedelta(days=1100))]
    out = []
    for p_start, p_end in periods:
        rows = {}
        for strategy in list_strategies():
            params = {p["name"]: p["default"] for p in strategy.param_schema}
            frame = df[(df["date"] >= p_start - timedelta(days=warmup_days(strategy.name, params)))
                       & (df["date"] <= p_end)]
            if len(frame[frame["date"] >= p_start]) < 2:
                continue
            r = run_backtest(frame, strategy.name, params, case["initial_capital"],
                             case["monthly_contribution"], case["invest_mode"], trade_start=p_start)
            rows[strategy.name] = {k: r[k] for k in ("total_return", "cagr", "sharpe_ratio", "max_drawdown",
                                                     "win_rate", "total_invested")}
            rows[strategy.name]["final_value"] = r["equity_curve"][-1]["equity"]
            rows[strategy.name]["trades"] = r["trades"]
        out.append({"start": str(p_start), "end": str(p_end), "strategies": rows})
    return out


def cases(ticker: str) -> list[dict]:
    capital, monthly = AMOUNTS["KRW" if ticker.endswith((".KS", ".KQ")) else "USD"]
    return [
        {"invest_mode": "lump_sum", "initial_capital": capital, "monthly_contribution": 0.0},
        {"invest_mode": "dca", "initial_capital": 0.0, "monthly_contribution": monthly},
    ]


def run_case(ticker: str, end: date, case: dict, df) -> tuple[dict, dict]:
    """routers/backtests.py auto_backtest() 의 본문 + Tear Sheet 에 쓰는 값."""
    start = _years_before(end, YEARS)
    data_start, data_end = _trading_span(df, start)
    results, failed, raw = [], [], {}
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
        raw[strategy.name] = r
        results.append(_summarize(strategy, params, r, case["invest_mode"],
                                  case["initial_capital"], case["monthly_contribution"]))
    results.sort(key=lambda x: x["total_return"], reverse=True)
    res = AutoBacktestResponse(
        ticker=ticker, start_date=start, end_date=end, data_start=data_start, data_end=data_end,
        invest_mode=case["invest_mode"], total_invested=total_invested, results=results, failed=failed,
    ).model_dump(mode="json")

    # 추세 구간은 /simulate 처럼 B&H 주 단위 곡선으로 나누고, 모든 곡선을 같은 점에서 잰다
    curves = {r["strategy_name"]: r["curve"] for r in res["results"]}
    bench = curves["buy_and_hold"]
    segments, threshold = regimes.segment([(date.fromisoformat(p["date"]), p["idx"]) for p in bench])
    detail = {
        "regime_threshold": threshold,
        "regimes": [{**s, "start": str(s["start"]), "end": str(s["end"])} for s in segments],
        "strategies": {
            name: {
                "final_value": r["equity_curve"][-1]["equity"],
                "trades": r["trades"],
                "regime_returns": regimes.returns_in([p["idx"] for p in curves[name]], segments),
            }
            for name, r in raw.items()
        },
    }
    indicators = {
        name: {
            series: [[str(p["date"]), p["value"]] for i, p in enumerate(points)
                     if i % INDICATOR_STEP == 0 or i == len(points) - 1]
            for series, points in (r["indicators"] or {}).items()
        }
        for name, r in raw.items()
    }
    return {**case, "expected": res, "detail": detail, "periods": period_cases(end, case, df)}, indicators


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
    out_cases, indicators = [], None
    for case in cases(ticker):
        c, ind = run_case(ticker, end, case, df)
        out_cases.append(c)
        indicators = indicators or ind  # 지표는 투자 방식과 무관하다
    return {"ticker": ticker, "end_date": str(end), "years": YEARS, "prices": prices,
            "cases": out_cases, "indicators": indicators, "comparisons": comparisons(db, ticker, end, df),
            # 파라미터 화면이 쓰는 전략 정의(설명·기본값·범위)도 백엔드와 같아야 한다
            "strategies": [{"name": s.name, "display_name": s.display_name, "description": s.description,
                            "params": s.param_schema} for s in list_strategies()]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--end", default="2026-09-28", help="고정 끝 날짜 (기본: 정답을 처음 만든 날의 마지막 거래일)")
    ap.add_argument("--universe", choices=["nasdaq100", "sp500", "kospi200"], help="지수 전 종목")
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
                             .filter(IndexMember.universe == args.universe))
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
