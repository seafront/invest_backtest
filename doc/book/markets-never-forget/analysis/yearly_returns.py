"""검증: "평균 수익률은 정상이 아니다 — 극단이 정상이다"

책의 주장: 장기 평균은 10% 안팎이지만 실제로 평균 근처에서 끝나는 해는 드물다.

    python yearly_returns.py
"""
import pandas as pd
from common import load, section, fmt

BUCKETS = [
    ("-40% 미만",   None,  -40),
    ("-40 ~ -20%",   -40,  -20),
    ("-20 ~ -10%",   -20,  -10),
    ("-10 ~   0%",   -10,    0),
    ("  0 ~ +10%",     0,   10),
    (" +10 ~ +20%",   10,   20),
    (" +20 ~ +40%",   20,   40),
    ("+40% 초과",     40, None),
]


def yearly(df: pd.DataFrame) -> pd.Series:
    """연말 종가 기준 연간 수익률(%).

    첫 해는 기준점이 없어 제외된다. 마지막 해는 12월까지 데이터가 없으면
    부분 연도이므로 제외한다 (그대로 두면 연간 수익률로 오인된다).
    """
    s = df.set_index("date")["close"]
    year_end = s.resample("YE").last().dropna()
    r = year_end.pct_change().dropna() * 100
    if s.index.max().month < 12:
        r = r[r.index.year < s.index.max().year]
    return r


def main() -> None:
    df = load("^GSPC")
    r = yearly(df)

    section(f"연도별 수익률 분포 — S&P 500 가격지수 (배당 제외)  {r.index[0].year}~{r.index[-1].year}, {len(r)}개 연도")

    mean, median = r.mean(), r.median()
    print(f"산술평균 {fmt(mean,2)}%   중앙값 {fmt(median,2)}%   "
          f"표준편차 {fmt(r.std(),2)}%   최소 {fmt(r.min(),1)}%   최대 {fmt(r.max(),1)}%")
    print(f"상승 {int((r>0).sum())}개 연도 ({(r>0).mean()*100:.1f}%)   "
          f"하락 {int((r<0).sum())}개 연도 ({(r<0).mean()*100:.1f}%)")

    section("분포 — 실제로 어느 구간에서 끝나는가")
    print(f"{'구간':<14}{'연도 수':>8}{'비중':>9}   히스토그램")
    for label, lo, hi in BUCKETS:
        m = pd.Series(True, index=r.index)
        if lo is not None:
            m &= r >= lo
        if hi is not None:
            m &= r < hi
        cnt = int(m.sum())
        pct = cnt / len(r) * 100
        print(f"{label:<14}{cnt:>8}{pct:>8.1f}%   {'█' * round(pct / 1.5)}")

    section("핵심 질문 — 평균 근처에서 끝난 해는 얼마나 되는가")
    for w in (2, 5, 10):
        m = (r >= mean - w) & (r <= mean + w)
        print(f"평균({mean:.1f}%) ±{w:>2}%p 구간  →  {int(m.sum()):>3}개 연도 / {len(r)}  ({m.mean()*100:>5.1f}%)")

    extreme = (r.abs() >= 20)
    print(f"\n±20% 이상 움직인 해     →  {int(extreme.sum()):>3}개 연도 / {len(r)}  ({extreme.mean()*100:>5.1f}%)")
    print(f"±10% 이상 움직인 해     →  {int((r.abs()>=10).sum()):>3}개 연도 / {len(r)}  ({(r.abs()>=10).mean()*100:>5.1f}%)")

    section("참고 — 총수익 기준(^SP500TR)과의 비교, 겹치는 구간")
    try:
        tr = yearly(load("^SP500TR"))
        common_years = r.index.intersection(tr.index)
        print(f"{len(common_years)}개 연도 공통 ({common_years[0].year}~{common_years[-1].year})")
        print(f"가격지수 평균 {fmt(r[common_years].mean(),2)}%   "
              f"총수익 평균 {fmt(tr[common_years].mean(),2)}%   "
              f"차이 {fmt(tr[common_years].mean()-r[common_years].mean(),2)}%p  (배당 기여분)")
    except SystemExit as e:
        print(e)


if __name__ == "__main__":
    main()
