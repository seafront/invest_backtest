"""평가금액 곡선을 비교용 수익률 곡선으로 바꾼다.

적립식은 평가금액에 매달 넣은 돈이 섞여 있어 그대로 그리거나 나누면 입금이 수익처럼 보인다.
여기서 두 가지 곡선을 만든다.

- ret: 그 시점까지 넣은 원금 대비 누적 수익률(%). 그래프에 그린다.
- idx: 입금 효과를 뺀 수익률 지수(시간가중, 시작 1.0). 두 시점의 비율이 곧 그 구간 수익률이라
  롤링 비교·구간 성과·최적화 검증에 쓴다.

원금 계산은 엔진과 같다 — 첫 달에 한 번, 이후 달이 바뀔 때마다 한 번.
"""
from datetime import date


def daily_curve(equity_curve: list[dict], invest_mode: str,
                initial_capital: float, monthly_contribution: float) -> list[dict]:
    """일별 {date, ret, idx}."""
    out: list[dict] = []
    invested = initial_capital if invest_mode == "lump_sum" else 0.0
    last_month = None
    index, prev_equity = 1.0, None
    for point in equity_curve:
        d = date.fromisoformat(str(point["date"]))
        flow = 0.0
        if invest_mode == "dca" and (d.year, d.month) != last_month:
            invested += monthly_contribution
            flow = monthly_contribution if last_month is not None else 0.0
            last_month = (d.year, d.month)
        equity = point["equity"]
        if prev_equity:
            index *= (equity - flow) / prev_equity
        prev_equity = equity
        ret = (equity - invested) / invested * 100 if invested > 0 else 0.0
        out.append({"date": d, "ret": ret, "idx": index})
    return out


def weekly(points: list[dict]) -> list[dict]:
    """각 주의 마지막 거래일만 남긴다. 5년 일별 × 전략 15개는 1만 9천 점이라 화면에 무겁다."""
    out: list[dict] = []
    last_week = None
    for p in points:
        week = p["date"].isocalendar()[:2]
        if week == last_week:
            out[-1] = p
        else:
            out.append(p)
            last_week = week
    return out


def weekly_curve(equity_curve: list[dict], invest_mode: str,
                 initial_capital: float, monthly_contribution: float) -> list[dict]:
    """API로 내보내는 주 단위 곡선. 값은 반올림한다."""
    return [
        {"date": p["date"], "ret": round(p["ret"], 2), "idx": round(p["idx"], 6)}
        for p in weekly(daily_curve(equity_curve, invest_mode, initial_capital, monthly_contribution))
    ]
