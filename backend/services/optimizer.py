"""투자 목표에 맞는 파라미터 찾기.

같은 5년으로 고르고 같은 5년으로 평가하면 1등은 거의 항상 우연히 맞은 값이다. 그래서
세 가지를 함께 한다.

1. 앞 구간(기본 60%, 5년이면 3년)으로만 고르고 뒤 구간(2년)으로 검증한다. 신호는 과거만
   보므로 한 번 돌린 곡선을 날짜로 잘라도 미래 정보가 섞이지 않는다 — 조합당 실행은 한 번이다.
2. 한 점의 점수가 아니라 주변 조합들의 평균 점수(고원)로 추천값을 고른다. 뾰족한 봉우리는
   파라미터를 조금만 바꿔도 무너진다. 최고점은 따로 보여 준다.
3. 수익이 추세 구간 하나에서만 나왔는지(집중도)를 표시한다.

엔진은 조합당 0.1초쯤 걸린다. 파라미터 2개면 격자 전부(121조합)가 15초, 3개부터는 격자가
1천 개를 넘어 무작위로 뿌린 뒤 상위 근처를 촘촘히 더 본다.
"""
import bisect
import itertools
import math
import random
from datetime import date, timedelta

from services import curves, regimes
from services.backtest_engine import run_backtest, warmup_days
from services.strategies import get_strategy

STEPS = 11  # 파라미터마다 범위를 몇 칸으로 나눌지
BUDGET = 300  # 격자가 이보다 크면 무작위로 뽑는다
REFINE = 100  # 무작위 뒤 상위 근처를 더 볼 횟수
TOP_FOR_REFINE = 10
NEIGHBORS = 8  # 고원 점수에 쓰는 이웃 수
IN_SAMPLE_RATIO = 0.6
RF = 0.02  # Sharpe 무위험 수익률(연) — utils.metrics와 같다
CONCENTRATION_WARN = 0.6  # 수익의 60% 넘게가 한 구간에서 나오면 경고

# 서로 순서가 있어야 하는 파라미터. 범위가 겹쳐 fast ≥ slow 조합이 격자에 생긴다.
ORDERED_PAIRS = [("fast_period", "slow_period")]

GOALS = {
    "consistency": {
        "label": "꾸준히 B&H 이기기",
        "description": "1년씩 잘라 본 구간에서 B&H보다 나았던 비율이 높고, 초과수익 중앙값이 큰 값",
    },
    "risk_adjusted": {
        "label": "위험 대비 수익",
        "description": "Sharpe가 높은 값. 최대 낙폭 한도를 줄 수 있다",
    },
    "defense": {
        "label": "하락 방어",
        "description": "하락 구간에서 B&H 하락을 덜 맞는 값. 상승 구간 포착률 50% 이상 유지",
    },
    "trend": {
        "label": "추세 추종",
        "description": "상승 구간에서 B&H 상승을 많이 가져가는 값. 하락 구간 노출률 80% 이하",
    },
    "return": {
        "label": "수익 극대화",
        "description": "CAGR이 가장 높은 값. 과최적화에 가장 취약하다",
    },
}


# ── 조합 만들기 ────────────────────────────────────────────────────────────

def axis_values(p: dict) -> list[float]:
    lo, hi = p["min"], p["max"]
    if p["type"] == "int":
        step = max(1, round((hi - lo) / (STEPS - 1)))
        vals = list(range(int(lo), int(hi) + 1, step))
        if vals[-1] != hi:
            vals.append(int(hi))
        return vals
    return [round(lo + (hi - lo) * i / (STEPS - 1), 4) for i in range(STEPS)]


def valid(params: dict) -> bool:
    return all(params[a] < params[b] for a, b in ORDERED_PAIRS if a in params and b in params)


def _key(params: dict) -> tuple:
    return tuple(sorted(params.items()))


def _neighbors_on_grid(params: dict, axes: dict[str, list]) -> list[dict]:
    """각 축에서 한 칸씩 움직인 조합들(자기 자신 제외)."""
    idx = {n: axes[n].index(params[n]) for n in axes if params[n] in axes[n]}
    out = []
    for deltas in itertools.product((-1, 0, 1), repeat=len(idx)):
        if not any(deltas):
            continue
        cand = dict(params)
        ok = True
        for (n, i), d in zip(idx.items(), deltas):
            j = i + d
            if not 0 <= j < len(axes[n]):
                ok = False
                break
            cand[n] = axes[n][j]
        if ok and valid(cand):
            out.append(cand)
    return out


# ── 구간 지표 ──────────────────────────────────────────────────────────────

def _segment_metrics(daily: list[dict], bench_daily: list[dict], trades: list[dict],
                     legs: list[dict], seg_start: date, seg_end: date) -> dict | None:
    """[seg_start, seg_end] 구간의 성과. 곡선은 입금 효과를 뺀 지수로 잰다."""
    pts = [p for p in daily if seg_start <= p["date"] <= seg_end]
    bpts = [p for p in bench_daily if seg_start <= p["date"] <= seg_end]
    if len(pts) < 20 or len(bpts) < 20:
        return None
    idx = [p["idx"] for p in pts]
    ret = idx[-1] / idx[0] - 1
    days = (pts[-1]["date"] - pts[0]["date"]).days
    years = days / 365.25
    cagr = ((idx[-1] / idx[0]) ** (1 / years) - 1) if years > 0.1 and idx[-1] > 0 else 0.0

    rets = [b / a - 1 for a, b in zip(idx, idx[1:]) if a > 0]
    if len(rets) > 1:
        mean = sum(rets) / len(rets)
        sd = math.sqrt(sum((r - mean) ** 2 for r in rets) / (len(rets) - 1))
        sharpe = (mean - RF / 252) / sd * math.sqrt(252) if sd > 0 else 0.0
    else:
        sharpe = 0.0

    peak, mdd = idx[0], 0.0
    for v in idx:
        peak = max(peak, v)
        if peak > 0:
            mdd = max(mdd, (peak - v) / peak)

    in_seg = [t for t in trades if seg_start <= date.fromisoformat(str(t["date"])) <= seg_end]
    sells = sum(1 for t in in_seg if t["action"] == "SELL")
    # 진입 횟수. 느린 추세 전략은 몇 년씩 들고 있어 청산(SELL)이 0회일 수 있지만, 들어갔다면
    # 판단을 한 것이다. 적립식의 월 자동 추가 매수는 진입이 아니므로 첫 BUY만 센다(보유 0 → 매수).
    entries = 0
    holding = False  # 구간 시작 때 보유 중이었는지: 앞선 매매를 순서대로 되짚는다
    for t in trades:
        if date.fromisoformat(str(t["date"])) >= seg_start:
            break
        holding = t["action"] == "BUY" or (holding and t["action"] != "SELL")
    for t in in_seg:
        if t["action"] == "BUY" and not holding:
            entries += 1
            holding = True
        elif t["action"] == "SELL":
            holding = False
    first_trade = next((date.fromisoformat(str(t["date"])) for t in trades), None)

    # 롤링 B&H 승률: 주 단위, 1년 창(구간이 2년 미만이면 반년 창).
    w = curves.weekly(pts)
    bw = {p["date"]: p["idx"] for p in curves.weekly(bpts)}
    pairs = [(p["idx"], bw[p["date"]]) for p in w if p["date"] in bw]
    window = 52 if len(pairs) >= 104 else 26
    excess = [
        ((pairs[i + window][0] / pairs[i][0]) - (pairs[i + window][1] / pairs[i][1])) * 100
        for i in range(len(pairs) - window)
        if pairs[i][0] > 0 and pairs[i][1] > 0
    ]
    win_rate = sum(1 for e in excess if e > 0) / len(excess) * 100 if excess else None
    median_excess = sorted(excess)[len(excess) // 2] if excess else None

    # 추세 구간: 이 구간과 겹치는 부분만, 첫 매매 전 부분은 뺀다(미진입이지 방어가 아니다).
    dates = [p["date"] for p in daily]  # 날짜순
    by_date = {p["date"]: p["idx"] for p in daily}
    bench_by_date = {p["date"]: p["idx"] for p in bench_daily}

    def on_or_before(d: date):
        i = bisect.bisect_right(dates, d) - 1
        return dates[i] if i >= 0 else None

    up_s = up_b = dn_s = dn_b = 0.0
    leg_logs: list[float] = []
    for leg in legs:
        a = max(leg["start"], seg_start, first_trade or seg_end)
        b = min(leg["end"], seg_end)
        if a >= b or leg["kind"] == "flat":
            continue
        da, db = on_or_before(a), on_or_before(b)
        if da is None or db is None or da == db or by_date[da] <= 0 or bench_by_date.get(da, 0) <= 0:
            continue
        s = math.log(by_date[db] / by_date[da])
        bm = math.log(bench_by_date[db] / bench_by_date[da])
        leg_logs.append(s)
        if leg["kind"] == "up":
            up_s, up_b = up_s + s, up_b + bm
        else:
            dn_s, dn_b = dn_s + s, dn_b + bm
    positive = [x for x in leg_logs if x > 0]
    concentration = max(positive) / sum(positive) if positive else None

    return {
        "total_return": round(ret * 100, 2),
        "cagr": round(cagr * 100, 2),
        "sharpe_ratio": round(sharpe, 3),
        "max_drawdown": round(mdd * 100, 2),
        "trades_count": sells,
        "entries": entries,
        "win_rate_vs_bh": None if win_rate is None else round(win_rate, 1),
        "median_excess": None if median_excess is None else round(median_excess, 2),
        "up_capture": round(up_s / up_b * 100, 1) if up_b else None,
        "down_exposure": round(dn_s / dn_b * 100, 1) if dn_b else None,
        "concentration": None if concentration is None else round(concentration * 100, 1),
    }


def score(goal: str, m: dict | None, min_trades: int, max_mdd: float | None) -> tuple[float | None, str | None]:
    """(점수, 제외 사유). 점수가 클수록 좋다. 제약을 어기면 점수는 있어도 추천에서 뺀다."""
    if m is None:
        return None, "데이터 부족"
    if goal == "consistency":
        if m["win_rate_vs_bh"] is None:
            return None, "구간 부족"
        s = m["win_rate_vs_bh"] + 0.1 * (m["median_excess"] or 0)
    elif goal == "risk_adjusted":
        s = m["sharpe_ratio"]
    elif goal == "defense":
        if m["down_exposure"] is None:
            return None, "하락 구간 없음"
        s = -m["down_exposure"]
    elif goal == "trend":
        if m["up_capture"] is None:
            return None, "상승 구간 없음"
        s = m["up_capture"]
    else:
        s = m["cagr"]

    reason = None
    if m["entries"] < min_trades:
        reason = f"진입 {m['entries']}회 (최소 {min_trades})"
    elif goal == "risk_adjusted" and max_mdd is not None and m["max_drawdown"] > max_mdd:
        reason = f"MDD {m['max_drawdown']:.0f}% > {max_mdd:.0f}%"
    elif goal == "defense" and (m["up_capture"] or 0) < 50:
        reason = "상승 포착률 50% 미만"
    elif goal == "trend" and m["down_exposure"] is not None and m["down_exposure"] > 80:
        reason = "하락 노출률 80% 초과"
    return round(s, 3), reason


# ── 탐색 ──────────────────────────────────────────────────────────────────

def optimize(df, strategy_name: str, start: date, end: date, goal: str,
             invest_mode: str, initial_capital: float, monthly_contribution: float,
             original: dict, min_trades: int = 1, max_mdd: float | None = None,
             progress=None, seed: int = 0) -> dict:
    """df는 가장 긴 준비 구간까지 포함한 시세. progress(done, total)로 진행을 알린다."""
    strategy = get_strategy(strategy_name)
    schema = strategy.param_schema
    defaults = {p["name"]: p["default"] for p in schema}
    original = {**defaults, **original}
    # 원래 값을 축에 끼워 넣는다. 격자 간격(예: 20, 28, 36…)이 50을 건너뛰면 원래 값이 격자 밖에
    # 있어 히트맵에 자리가 없고, 이웃이 없어 고원 점수도 다른 점들과 같은 기준으로 잴 수 없다.
    axes = {p["name"]: sorted(set(axis_values(p)) | {original[p["name"]]}) for p in schema}
    span_days = (end - start).days
    split = start + timedelta(days=int(span_days * IN_SAMPLE_RATIO))

    # 조합마다 필요한 만큼만 준비 구간을 잘라 쓴다. 가장 긴 준비 구간으로 다 돌리면
    # 짧은 기간 조합까지 9년치 신호를 계산해 두 배 느려진다.
    def frame_for(params: dict):
        w = warmup_days(strategy_name, params)
        return df[df["date"] >= start - timedelta(days=w)]

    def run(params: dict) -> dict:
        r = run_backtest(frame_for(params), strategy_name, params, initial_capital,
                         monthly_contribution, invest_mode, trade_start=start)
        return {"daily": curves.daily_curve(r["equity_curve"], invest_mode, initial_capital,
                                            monthly_contribution),
                "trades": r["trades"]}

    bench = run_backtest(df[df["date"] >= start - timedelta(days=10)], "buy_and_hold", {},
                         initial_capital, monthly_contribution, invest_mode, trade_start=start)
    bench_daily = curves.daily_curve(bench["equity_curve"], invest_mode, initial_capital,
                                     monthly_contribution)
    legs, threshold = regimes.segment([(p["date"], p["idx"]) for p in curves.weekly(bench_daily)])
    data_end = bench_daily[-1]["date"]

    # 격자가 예산 안이면 전부, 넘으면 무작위로 뽑는다. 원래 값은 항상 넣는다.
    grid_size = math.prod(len(v) for v in axes.values()) if axes else 1
    if grid_size <= BUDGET:
        candidates = [dict(zip(axes, combo)) for combo in itertools.product(*axes.values())]
        mode = "grid"
    else:
        rng = random.Random(seed)
        seen, candidates = set(), []
        tries = 0
        while len(candidates) < BUDGET and tries < BUDGET * 20:
            tries += 1
            c = {n: rng.choice(v) for n, v in axes.items()}
            if valid(c) and _key(c) not in seen:
                seen.add(_key(c))
                candidates.append(c)
        mode = "random"
    candidates = [c for c in candidates if valid(c)]
    if _key(original) not in {_key(c) for c in candidates}:
        candidates.append(original)

    results: dict[tuple, dict] = {}
    total = len(candidates) + (REFINE if mode == "random" else 0)

    def evaluate(params: dict) -> None:
        run_out = run(params)
        ins = _segment_metrics(run_out["daily"], bench_daily, run_out["trades"], legs, start, split)
        oos = _segment_metrics(run_out["daily"], bench_daily, run_out["trades"], legs,
                               split + timedelta(days=1), data_end)
        full = _segment_metrics(run_out["daily"], bench_daily, run_out["trades"], legs, start, data_end)
        s_in, why = score(goal, ins, min_trades, max_mdd)
        s_out, _ = score(goal, oos, 0, None)  # 검증 구간은 짧아 매매 수 제약을 걸지 않는다
        results[_key(params)] = {
            "params": params, "in_sample": ins, "out_of_sample": oos, "full": full,
            "score_in": s_in, "score_out": s_out, "excluded": why,
        }
        if progress:
            progress(len(results), total)

    for c in candidates:
        evaluate(c)

    # 무작위 탐색 뒤: 앞 구간 상위 근처를 한 칸씩 더 본다.
    if mode == "random":
        ranked = sorted((r for r in results.values() if r["score_in"] is not None and not r["excluded"]),
                        key=lambda r: r["score_in"], reverse=True)[:TOP_FOR_REFINE]
        extra = 0
        for r in ranked:
            for n in _neighbors_on_grid(r["params"], axes):
                if extra >= REFINE:
                    break
                if _key(n) not in results:
                    evaluate(n)
                    extra += 1
        total = len(results)
        if progress:
            progress(total, total)

    # 고원 점수: 정규화한 파라미터 공간에서 가까운 조합들과 평균낸 앞 구간 점수.
    rows = list(results.values())
    names = list(axes)

    def norm(params: dict) -> list[float]:
        return [(params[n] - axes[n][0]) / ((axes[n][-1] - axes[n][0]) or 1) for n in names]

    scored = [r for r in rows if r["score_in"] is not None]
    coords = {_key(r["params"]): norm(r["params"]) for r in scored}
    for r in scored:
        me = coords[_key(r["params"])]
        dists = sorted(
            (max(abs(a - b) for a, b in zip(me, coords[_key(o["params"])])) if names else 0, o["score_in"])
            for o in scored if o is not r
        )
        near = [s for _, s in dists[:NEIGHBORS]]
        r["score_robust"] = round((r["score_in"] + sum(near)) / (1 + len(near)), 3)
    for r in rows:
        r.setdefault("score_robust", None)

    eligible = [r for r in scored if not r["excluded"]]
    # 고원 꼭대기는 평평해 고원 점수가 같은 조합이 여럿 나온다. 그때는 선택 구간 점수로 가른다.
    # 검증 구간 점수로 가르면 검증에 쓸 기간을 고르는 데 써 버리게 되므로 쓰지 않는다.
    recommended = max(eligible, key=lambda r: (round(r["score_robust"], 1), r["score_in"]), default=None)
    peak = max(eligible, key=lambda r: r["score_in"], default=None)

    def pick(r):
        return None if r is None else r["params"]

    return {
        "goal": goal,
        "goal_label": GOALS[goal]["label"],
        "mode": mode,
        "evaluated": len(rows),
        "grid_size": grid_size,
        "split_date": split,
        "start_date": start,
        "end_date": data_end,
        "regime_threshold": round(threshold * 100, 1),
        "axes": [{"name": n, "values": axes[n]} for n in names],
        "benchmark": {
            "in_sample": _segment_metrics(bench_daily, bench_daily, bench["trades"], legs, start, split),
            "out_of_sample": _segment_metrics(bench_daily, bench_daily, bench["trades"], legs,
                                              split + timedelta(days=1), data_end),
        },
        "results": sorted(rows, key=lambda r: (r["score_robust"] is None, -(r["score_robust"] or 0))),
        "recommended": pick(recommended),
        "peak": pick(peak),
        "original": original,
        "concentration_warn": CONCENTRATION_WARN * 100,
    }
