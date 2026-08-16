"""검증: "큰 하락 뒤에는 큰 반등이 온다 (V자 회복)"

책의 주장:
  1. 깊은 약세장일수록 반등의 초기 기울기도 가파르다
  2. 강세장 수익의 상당 부분이 첫 12개월에 몰린다

    python v_recovery.py
"""
import pandas as pd

from common import load, find_bear_markets, forward_return, section, fmt


def main() -> None:
    df = load("^GSPC")
    bears = find_bear_markets(df, threshold=0.20)

    section(f"약세장(고점 대비 -20% 이상) 전수 조사 — S&P 500 가격지수  "
            f"{df['date'].iloc[0].date()} ~ {df['date'].iloc[-1].date()}")
    print(f"총 {len(bears)}회 발생\n")

    hdr = (f"{'고점':<12}{'저점':<12}{'하락률':>8}{'하락기간':>8}"
           f"{'+3M':>9}{'+6M':>9}{'+12M':>9}{'회복소요':>9}")
    print(hdr)
    print("-" * len(hdr))

    rows = []
    for b in bears:
        f3 = forward_return(df, b["trough_i"], 3)
        f6 = forward_return(df, b["trough_i"], 6)
        f12 = forward_return(df, b["trough_i"], 12)
        rows.append({**b, "f3": f3, "f6": f6, "f12": f12})
        rec = f"{b['recovery_days']/365.25:.1f}년" if b["recovery_days"] is not None else "미회복"
        print(f"{str(b['peak_date'].date()):<12}{str(b['trough_date'].date()):<12}"
              f"{b['decline_pct']:>7.1f}%{b['decline_days']/365.25:>7.1f}년"
              f"{fmt(f3,1,'%'):>9}{fmt(f6,1,'%'):>9}{fmt(f12,1,'%'):>9}{rec:>9}")

    section("저점 이후 반등 — 요약 통계")
    for label, key in (("3개월", "f3"), ("6개월", "f6"), ("12개월", "f12")):
        vals = [r[key] for r in rows if r[key] is not None]
        pos = sum(1 for v in vals if v > 0)
        print(f"저점 후 {label:<5} 평균 {fmt(sum(vals)/len(vals),1):>6}%   "
              f"중앙값 {fmt(sorted(vals)[len(vals)//2],1):>6}%   "
              f"최소 {fmt(min(vals),1):>6}%   최대 {fmt(max(vals),1):>6}%   "
              f"플러스 {pos}/{len(vals)}")

    section("주장 1 검증 — 깊은 하락일수록 반등도 큰가")
    deep = [r for r in rows if r["decline_pct"] <= -35 and r["f12"] is not None]
    mild = [r for r in rows if r["decline_pct"] > -35 and r["f12"] is not None]
    for label, grp in (("-35% 이상 하락 (깊은 약세장)", deep), ("-20~-35% 하락 (얕은 약세장)", mild)):
        if not grp:
            continue
        print(f"{label:<28} {len(grp):>2}회   "
              f"평균 하락 {sum(r['decline_pct'] for r in grp)/len(grp):>6.1f}%   "
              f"→ 저점 후 12개월 평균 {sum(r['f12'] for r in grp)/len(grp):>6.1f}%")

    xs = [r["decline_pct"] for r in rows if r["f12"] is not None]
    ys = [r["f12"] for r in rows if r["f12"] is not None]
    n = len(xs)
    mx, my = sum(xs)/n, sum(ys)/n
    cov = sum((x-mx)*(y-my) for x, y in zip(xs, ys))
    vx = sum((x-mx)**2 for x in xs) ** 0.5
    vy = sum((y-my)**2 for y in ys) ** 0.5
    print(f"\n하락률 vs 저점 후 12개월 수익률 상관계수: {cov/(vx*vy):+.3f}")
    print("(음수일수록 '더 깊이 떨어질수록 더 크게 반등한다'는 주장에 부합)")

    section("주장 2 검증 — 강세장 수익은 첫 12개월에 몰리는가")
    print("강세장 = 약세장 저점 → 다음 약세장의 고점 (마지막 구간은 데이터 끝까지).")
    print("첫 12개월 수익률과, 그 이후 남은 구간의 연율 수익률을 비교한다.\n")

    hdr2 = (f"{'강세장 시작':<12}{'강세장 종료':<12}{'기간':>7}{'전체수익':>10}"
            f"{'첫12M':>9}{'이후 연율':>10}")
    print(hdr2)
    print("-" * len(hdr2))

    first_yr, rest_ann = [], []
    for k, r in enumerate(rows):
        start_i = r["trough_i"]
        end_i = rows[k + 1]["peak_i"] if k + 1 < len(rows) else len(df) - 1
        if end_i <= start_i:
            continue
        years = (df["date"].iloc[end_i] - df["date"].iloc[start_i]).days / 365.25
        total = (df["close"].iloc[end_i] / df["close"].iloc[start_i] - 1) * 100
        f12 = r["f12"]

        if years <= 1.05 or f12 is None:
            rest = None
        else:
            i12 = int(df["date"].searchsorted(df["date"].iloc[start_i] + pd.DateOffset(months=12)))
            rest_years = (df["date"].iloc[end_i] - df["date"].iloc[i12]).days / 365.25
            rest = ((df["close"].iloc[end_i] / df["close"].iloc[i12]) ** (1 / rest_years) - 1) * 100
            first_yr.append(f12)
            rest_ann.append(rest)

        print(f"{str(df['date'].iloc[start_i].date()):<12}{str(df['date'].iloc[end_i].date()):<12}"
              f"{years:>6.1f}년{total:>9.1f}%{fmt(f12,1,'%'):>9}{fmt(rest,1,'%'):>10}")

    if first_yr:
        print(f"\n첫 12개월 평균 수익률      {sum(first_yr)/len(first_yr):>6.1f}%")
        print(f"이후 구간 평균 연율 수익률 {sum(rest_ann)/len(rest_ann):>6.1f}%")
        print(f"배율                       {(sum(first_yr)/len(first_yr))/(sum(rest_ann)/len(rest_ann)):>6.1f}배")


if __name__ == "__main__":
    main()
