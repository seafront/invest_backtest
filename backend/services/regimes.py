"""추세 구간 나누기.

전략 비교가 "5년 합계"만 보면 어떤 국면에서 벌고 잃었는지가 묻힌다. 같은 Golden Cross라도
파라미터를 바꾸면 하락장 방어는 좋아지고 상승장 추종은 늦어지는 식으로 국면마다 득실이
갈리는데, 그 차이가 변형 비교의 핵심이다.

국면은 Buy & Hold 경로에서 고점·저점을 이어 나눈다(지그재그). 직전 극점에서 임계값 이상
되돌리면 그 극점을 전환점으로 확정한다. 임계값은 종목 변동성에 비례한다 — 고정 20%로
자르면 3배 레버리지 ETF는 몇 주마다 국면이 바뀌고, 유틸리티주는 5년 내내 한 국면이 된다.

전환점은 되돌림이 임계값을 넘은 뒤에야 확정되므로 사후 구분이다. 과거를 설명하는
용도이지 매매 신호가 아니다.
"""
import math
from datetime import date

# 임계값 = 연 변동성 × 이 배수. 변동성 20%인 종목이면 10% 되돌림을 추세 전환으로 본다.
VOL_MULTIPLE = 0.5
MIN_THRESHOLD = 0.10
MAX_THRESHOLD = 0.40
# 마지막 미완성 구간이 임계값의 이만큼도 움직이지 않았으면 방향을 말하기 어렵다.
FLAT_RATIO = 0.5


def swing_threshold(values: list[float]) -> float:
    """주 단위 지수의 변동성으로 정한 되돌림 임계값(비율)."""
    rets = [math.log(b / a) for a, b in zip(values, values[1:]) if a > 0 and b > 0]
    if len(rets) < 2:
        return MIN_THRESHOLD
    mean = sum(rets) / len(rets)
    var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
    annual_vol = math.sqrt(var) * math.sqrt(52)
    return min(MAX_THRESHOLD, max(MIN_THRESHOLD, annual_vol * VOL_MULTIPLE))


def segment(points: list[tuple[date, float]]) -> tuple[list[dict], float]:
    """(날짜, 지수) 주 단위 점을 상승/하락/횡보 구간으로 나눈다.

    반환: ([{start, end, kind, start_index, end_index, benchmark_return}], 임계값)
    kind는 "up" / "down" / "flat". flat은 끝의 미완성 구간에만 나온다.
    """
    if len(points) < 3:
        return [], MIN_THRESHOLD
    values = [v for _, v in points]
    thr = swing_threshold(values)

    pivots = [0]
    trend = None  # 첫 추세가 정해지기 전에는 고점과 저점을 모두 따라간다
    hi = lo = 0
    for i in range(1, len(values)):
        v = values[i]
        if trend is None:
            if v > values[hi]:
                hi = i
            if v < values[lo]:
                lo = i
            if values[hi] >= values[0] * (1 + thr) and v <= values[hi] * (1 - thr):
                pivots.append(hi)  # 올랐다가 꺾였다 — 시작~고점이 상승 구간
                trend, lo = "down", i
            elif values[lo] <= values[0] * (1 - thr) and v >= values[lo] * (1 + thr):
                pivots.append(lo)
                trend, hi = "up", i
            elif v >= values[0] * (1 + thr) and lo == 0:
                trend = "up"
            elif v <= values[0] * (1 - thr) and hi == 0:
                trend = "down"
        elif trend == "up":
            if v > values[hi]:
                hi = i
            elif v <= values[hi] * (1 - thr):
                pivots.append(hi)
                trend, lo = "down", i
        else:
            if v < values[lo]:
                lo = i
            elif v >= values[lo] * (1 + thr):
                pivots.append(lo)
                trend, hi = "up", i

    if pivots[-1] != len(values) - 1:
        pivots.append(len(values) - 1)

    out = []
    for a, b in zip(pivots, pivots[1:]):
        if b <= a:
            continue
        ret = values[b] / values[a] - 1
        last = b == len(values) - 1
        if last and abs(ret) < thr * FLAT_RATIO:
            kind = "flat"
        else:
            kind = "up" if ret > 0 else "down"
        out.append({
            "start": points[a][0],
            "end": points[b][0],
            "start_index": a,
            "end_index": b,
            "kind": kind,
            "benchmark_return": round(ret * 100, 2),
        })
    # 같은 방향 구간이 이어지면 합친다 (첫 추세가 정해지는 과정에서 생길 수 있다).
    merged: list[dict] = []
    for s in out:
        if merged and merged[-1]["kind"] == s["kind"]:
            m = merged[-1]
            m["end"], m["end_index"] = s["end"], s["end_index"]
            m["benchmark_return"] = round((values[m["end_index"]] / values[m["start_index"]] - 1) * 100, 2)
        else:
            merged.append(s)
    return merged, thr


def returns_in(curve_values: list[float], segments: list[dict]) -> list[float | None]:
    """각 구간에서 이 곡선(지수)의 수익률(%). 곡선은 구간을 만든 점과 같은 날짜여야 한다."""
    out: list[float | None] = []
    for s in segments:
        a, b = s["start_index"], s["end_index"]
        if b >= len(curve_values) or curve_values[a] <= 0:
            out.append(None)
        else:
            out.append(round((curve_values[b] / curve_values[a] - 1) * 100, 2))
    return out
