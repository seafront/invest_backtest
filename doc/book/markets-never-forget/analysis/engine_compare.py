"""검증: "타이밍보다 보유가 낫다" / "DCA vs 일시납"

BacktestLab의 실제 엔진(backend/services/backtest_engine.py)을 그대로 호출한다.
DB를 거치지 않고 CSV를 엔진이 기대하는 형태로 넘긴다.

    python engine_compare.py
"""
import os
import sys

import pandas as pd

from common import load, section

BACKEND = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../backend"))
sys.path.insert(0, BACKEND)

from services.backtest_engine import run_backtest          # noqa: E402
from services.strategies import STRATEGY_REGISTRY          # noqa: E402

# 정수 주식 매매로 인한 반올림 오차를 무시할 수준으로 낮추기 위해 큰 자본을 쓴다.
CAPITAL = 10_000_000
MONTHLY = 10_000

WINDOWS = [
    ("1928-2025 (전체 98년)", "1928-01-01", "2025-12-31"),
    ("1996-2025 (최근 30년)", "1996-01-01", "2025-12-31"),
    ("2000-2025 (닷컴 고점 시작)", "2000-01-01", "2025-12-31"),
]


def engine_df(df: pd.DataFrame, start: str, end: str) -> pd.DataFrame:
    """엔진이 기대하는 형태로 변환 — date는 datetime.date (get_cached_data와 동일)."""
    m = (df["date"] >= start) & (df["date"] <= end)
    out = df.loc[m, ["date", "open", "high", "low", "close", "volume"]].copy()
    out["date"] = out["date"].dt.date
    return out.reset_index(drop=True)


def defaults(name: str) -> dict:
    return {p["name"]: p["default"] for p in STRATEGY_REGISTRY[name].param_schema}


def compare_strategies(df: pd.DataFrame, label: str, start: str, end: str) -> None:
    sub = engine_df(df, start, end)
    section(f"전략 비교 — S&P 500  {label}   (초기자본 ${CAPITAL:,}, 일시납)")
    print(f"거래일 {len(sub):,}일   {sub['date'].iloc[0]} ~ {sub['date'].iloc[-1]}\n")

    rows = []
    for name in STRATEGY_REGISTRY:
        try:
            r = run_backtest(sub, name, defaults(name), CAPITAL, 0.0, "lump_sum")
        except Exception as e:                                   # noqa: BLE001
            print(f"  {name:<16} 실패: {type(e).__name__}: {e}")
            continue
        rows.append({
            "name": name,
            "cagr": r["cagr"],
            "total_return": r["total_return"],
            "mdd": r["max_drawdown"],
            "sharpe": r["sharpe_ratio"],
            "trades": len(r["trades"]),
            "win_rate": r["win_rate"],
        })

    rows.sort(key=lambda x: x["cagr"], reverse=True)
    hdr = f"{'전략':<16}{'CAGR':>8}{'총수익':>13}{'MDD':>8}{'Sharpe':>8}{'거래':>7}{'승률':>7}"
    print(hdr)
    print("-" * len(hdr))
    for r in rows:
        mark = "  ←" if r["name"] == "buy_and_hold" else ""
        print(f"{r['name']:<16}{r['cagr']:>7.2f}%{r['total_return']:>12,.0f}%"
              f"{r['mdd']:>7.1f}%{r['sharpe']:>8.2f}{r['trades']:>7}"
              f"{r['win_rate']:>6.1f}%{mark}")

    bh = next((r for r in rows if r["name"] == "buy_and_hold"), None)
    if bh:
        rank = rows.index(bh) + 1
        beat = [r["name"] for r in rows if r["cagr"] > bh["cagr"]]
        print(f"\nBuy & Hold 순위: {rank}위 / {len(rows)}개 전략")
        print(f"이긴 전략: {', '.join(beat) if beat else '없음'}")


def compare_modes(df: pd.DataFrame, label: str, start: str, end: str) -> None:
    sub = engine_df(df, start, end)
    section(f"일시납 vs 적립식(DCA) — buy_and_hold, {label}")

    lump = run_backtest(sub, "buy_and_hold", {}, CAPITAL, 0.0, "lump_sum")
    dca = run_backtest(sub, "buy_and_hold", {}, 0.0, MONTHLY, "dca")

    hdr = f"{'모드':<10}{'투입원금':>16}{'최종자산':>18}{'총수익':>10}{'CAGR':>8}{'MDD':>8}"
    print(hdr)
    print("-" * len(hdr))
    for name, r in (("일시납", lump), ("적립식", dca)):
        final = r["equity_curve"][-1]["equity"]
        print(f"{name:<10}{'$' + format(r['total_invested'], ',.0f'):>16}"
              f"{'$' + format(final, ',.0f'):>18}{r['total_return']:>9.1f}%"
              f"{r['cagr']:>7.2f}%{r['max_drawdown']:>7.1f}%")

    print("\n주의: 두 모드는 '투입 원금이 시장에 노출된 기간'이 다르다. 일시납은 첫날부터")
    print("전액이, 적립식은 평균적으로 절반 정도가 노출된다. 수익률 직접 비교는 부적절하며")
    print("같은 현금흐름을 가진 투자자의 결과 비교로만 읽어야 한다.")


def main() -> None:
    df = load("^GSPC")
    for label, s, e in WINDOWS:
        compare_strategies(df, label, s, e)
    for label, s, e in WINDOWS[1:]:
        compare_modes(df, label, s, e)


if __name__ == "__main__":
    main()
