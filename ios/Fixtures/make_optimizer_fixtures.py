"""iOS 앱의 "최적값 찾기"(Optimizer.swift)가 맞춰야 할 정답을 backend/services/optimizer.py 로 만든다.

최적화는 파라미터 최댓값 조합의 준비 구간까지 시세를 읽으므로(최대 4년 더) Leaderboard 정답과 따로
시세를 싣는다. 경우마다 수백 조합을 돌려 몇십 초씩 걸린다.

    cd backend && source venv/bin/activate
    python ../ios/Fixtures/make_optimizer_fixtures.py            # 전부 (경우마다 프로세스 하나)
    python ../ios/Fixtures/make_optimizer_fixtures.py 0 3        # 몇 번째 경우만
"""
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor
from datetime import date, timedelta
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2] / "backend"
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)

from database import SessionLocal  # noqa: E402
from routers.backtests import _years_before  # noqa: E402
from services import optimizer  # noqa: E402
from services.backtest_engine import warmup_days  # noqa: E402
from services.data_fetcher import get_cached_data  # noqa: E402
from services.strategies import get_strategy  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "BacktestCore/Tests/BacktestCoreTests/Optimizer"
END = date(2026, 9, 28)
# 목표 5가지, 격자·무작위 탐색, 정수·실수 파라미터, 원화, 적립식, 낙폭 한도가 모두 한 번씩은 나오게
CASES = [
    {"ticker": "AAPL", "strategy": "golden_cross", "goal": "consistency"},                 # 격자 12×12
    {"ticker": "TQQQ", "strategy": "macd", "goal": "risk_adjusted", "max_mdd": 60},        # 무작위 3개
    {"ticker": "005930.KS", "strategy": "rsi", "goal": "defense", "mode": "dca"},          # 원화·적립식
    {"ticker": "NVDA", "strategy": "keltner", "goal": "trend"},                            # 실수 파라미터
    {"ticker": "TSLA", "strategy": "bollinger", "goal": "return"},                         # 격자 정수×실수
    {"ticker": "TQQQ", "strategy": "parabolic_sar", "goal": "consistency"},                # 실수만
    {"ticker": "AAPL", "strategy": "dual_ma_rsi", "goal": "consistency", "min_trades": 3},  # 5개, 최소 진입
]
TOP_WITH_METRICS = 20  # 메트릭까지 싣는 상위 줄 수 (크기 때문에)


def run_case(i: int) -> str:
    c = CASES[i]
    ticker, name = c["ticker"], c["strategy"]
    krw = ticker.endswith(".KS")
    mode = c.get("mode", "lump_sum")
    capital = (100_000_000.0 if krw else 100_000.0) if mode == "lump_sum" else 0.0
    monthly = (1_000_000.0 if krw else 1_000.0) if mode == "dca" else 0.0
    start = _years_before(END, 5)
    strategy = get_strategy(name)
    longest = {p["name"]: p["max"] for p in strategy.param_schema}
    db = SessionLocal()
    try:
        df = get_cached_data(db, ticker, start - timedelta(days=warmup_days(name, longest)), END)
    finally:
        db.close()
    res = optimizer.optimize(df, name, start, END, c["goal"], mode, capital, monthly, {},
                             min_trades=c.get("min_trades", 1), max_mdd=c.get("max_mdd"))

    def row(r, with_metrics: bool):
        out = {k: r[k] for k in ("params", "score_in", "score_out", "score_robust", "excluded")}
        if with_metrics:
            out |= {k: r[k] for k in ("in_sample", "out_of_sample", "full")}
        return out

    picks = {optimizer._key(p) for p in (res["recommended"], res["peak"], res["original"]) if p}
    expected = {
        **{k: res[k] for k in ("goal", "mode", "evaluated", "grid_size", "regime_threshold",
                               "recommended", "peak", "original", "benchmark")},
        "start_date": str(res["start_date"]), "split_date": str(res["split_date"]), "end_date": str(res["end_date"]),
        "axes": res["axes"],
        "results": [row(r, j < TOP_WITH_METRICS or optimizer._key(r["params"]) in picks)
                    for j, r in enumerate(res["results"])],
    }
    fx = {
        "case": {**c, "mode": mode, "initial_capital": capital, "monthly_contribution": monthly,
                 "start": str(start), "end": str(END)},
        "prices": [{"date": str(r.date), "open": r.open, "high": r.high, "low": r.low, "close": r.close,
                    "volume": int(r.volume)} for r in df.itertuples()],
        "expected": expected,
    }
    path = OUT / f"{i}-{ticker}-{name}.json"
    path.write_text(json.dumps(fx, separators=(",", ":")))
    return f"{path.name}: {res['mode']} {res['evaluated']} combos, recommended {res['recommended']}"


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    picks = [int(a) for a in sys.argv[1:]] or list(range(len(CASES)))
    with ProcessPoolExecutor(max_workers=len(picks)) as ex:
        for line in ex.map(run_case, picks):
            print(line)
