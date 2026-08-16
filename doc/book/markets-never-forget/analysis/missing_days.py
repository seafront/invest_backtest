"""검증: "안전해질 때까지 기다리면 회복의 대부분을 놓친다"

책의 주장: 바닥은 알 수 없지만, 회복 초기 구간을 비워두면 장기 성과가 무너진다.

두 가지 방식으로 확인한다.
  A. 강세장마다 N개월 늦게 진입했을 때의 수익 차이
  B. 전체 기간에서 상승률 상위 K일을 놓쳤을 때의 최종 자산

    python missing_days.py
"""
import numpy as np
import pandas as pd

from common import load, find_bear_markets, section, fmt

LATE_MONTHS = [1, 3, 6, 12]
MISS_DAYS = [0, 5, 10, 20, 30, 50, 100]


def bull_markets(df: pd.DataFrame) -> list[tuple[int, int]]:
    """(시작 인덱스=약세장 저점, 종료 인덱스=다음 약세장 고점) 목록."""
    bears = find_bear_markets(df, threshold=0.20)
    out = []
    for k, b in enumerate(bears):
        end_i = bears[k + 1]["peak_i"] if k + 1 < len(bears) else len(df) - 1
        if end_i > b["trough_i"]:
            out.append((b["trough_i"], end_i))
    return out


def part_a(df: pd.DataFrame) -> None:
    section("A. 강세장에 N개월 늦게 진입했다면 — 저점 매수 대비 수익 차이")
    print("'안전해 보일 때까지' 기다린 대가를 강세장별로 계산한다.\n")

    hdr = f"{'강세장 시작':<12}{'종료':<12}{'저점 매수':>10}" + "".join(f"{f'+{m}M 지연':>11}" for m in LATE_MONTHS)
    print(hdr)
    print("-" * len(hdr))

    losses = {m: [] for m in LATE_MONTHS}
    for start_i, end_i in bull_markets(df):
        end_px = df["close"].iloc[end_i]
        base = (end_px / df["close"].iloc[start_i] - 1) * 100
        cells = []
        for m in LATE_MONTHS:
            t = df["date"].iloc[start_i] + pd.DateOffset(months=m)
            i = int(df["date"].searchsorted(t))
            if i >= end_i:
                cells.append("—")
                continue
            r = (end_px / df["close"].iloc[i] - 1) * 100
            losses[m].append(base - r)
            cells.append(f"{r:.1f}%")
        print(f"{str(df['date'].iloc[start_i].date()):<12}"
              f"{str(df['date'].iloc[end_i].date()):<12}{base:>9.1f}%"
              + "".join(f"{c:>11}" for c in cells))

    print("\n지연 진입으로 인한 수익 손실 (%p, 강세장 전체 수익 기준)")
    print("1932년 구간(전체수익 1028%)이 극단적 이상치라 평균을 왜곡한다. 중앙값을 함께 본다.")
    for m in LATE_MONTHS:
        v = sorted(losses[m])
        if not v:
            continue
        med = v[len(v) // 2] if len(v) % 2 else (v[len(v)//2 - 1] + v[len(v)//2]) / 2
        ex32 = [x for x in losses[m][1:]]  # 첫 항목이 1932년 강세장
        print(f"  {m:>2}개월 지연  →  평균 {sum(v)/len(v):>7.1f}%p   "
              f"중앙값 {med:>6.1f}%p   1932년 제외 평균 {sum(ex32)/len(ex32):>6.1f}%p   (n={len(v)})")


def part_b(df: pd.DataFrame) -> None:
    section("B. 전체 기간에서 상승률 상위 K일을 놓쳤다면 — 최종 자산")
    yrs = (df["date"].iloc[-1] - df["date"].iloc[0]).days / 365.25
    print(f"기간 {df['date'].iloc[0].date()} ~ {df['date'].iloc[-1].date()} "
          f"({yrs:.1f}년, 거래일 {len(df):,}일), 초기 투자 $10,000\n")

    daily = df["close"].pct_change().dropna().values
    order = np.argsort(daily)[::-1]  # 수익률 내림차순

    hdr = f"{'제외 일수':>10}{'최종 자산':>16}{'연평균':>9}{'전체 보유 대비':>14}"
    print(hdr)
    print("-" * len(hdr))
    base_final = None
    for k in MISS_DAYS:
        d = daily.copy()
        if k:
            d[order[:k]] = 0.0
        final = 10000 * float(np.prod(1 + d))
        ann = (final / 10000) ** (1 / yrs) - 1
        if base_final is None:
            base_final = final
        print(f"{k:>10}{'$' + format(final, ',.0f'):>16}{ann*100:>8.2f}%"
              f"{final/base_final*100:>13.1f}%")

    print(f"\n상위 {MISS_DAYS[-1]}일은 전체 거래일의 {MISS_DAYS[-1]/len(df)*100:.2f}%에 불과하다.")

    # 최고 상승일이 언제 몰려 있는가 — 약세장 부근인지 확인
    top = df.iloc[1:].iloc[order[:50]]
    bears = find_bear_markets(df, threshold=0.20)
    in_bear = 0
    for d in top["date"]:
        for b in bears:
            end = b["recovery_date"] if b["recovery_date"] is not None else df["date"].iloc[-1]
            if b["peak_date"] <= d <= end:
                in_bear += 1
                break
    print(f"상승률 상위 50일 중 {in_bear}일({in_bear/50*100:.0f}%)이 "
          f"약세장~회복 구간 안에 있었다. 즉 가장 무서울 때 몰려 있다.")


def main() -> None:
    df = load("^GSPC")
    part_a(df)
    part_b(df)


if __name__ == "__main__":
    main()
