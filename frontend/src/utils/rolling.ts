/**
 * 롤링 구간 비교.
 *
 * "오늘 기준 총수익률"은 끝 날짜에 크게 좌우된다 — TQQQ 5년에서 끝 날짜만 바꿔도
 * B&H를 이긴 전략이 1/14에서 10/14까지 오갔다. 그래서 같은 길이의 구간을 한 주씩
 * 밀어 가며 전부 잘라 보고, 몇 번이나 B&H보다 나았는지로 비교한다.
 */

export interface CurvePoint {
  date: string;
  /** 입금 효과를 뺀 수익률 지수. 두 점의 비율이 그 구간 수익률이다. */
  idx: number;
}

export interface RollingStats {
  /** B&H보다 구간 수익률이 높았던 구간 비율(%) */
  winRate: number;
  /** 구간별 초과수익(%p)의 중앙값 */
  medianExcess: number;
  windows: number;
}

/** 선택 가능한 구간 길이(주). 백테스트 기간의 절반을 넘는 길이는 쓰지 않는다. */
export const WINDOW_OPTIONS = [
  { weeks: 13, label: "3개월" },
  { weeks: 26, label: "6개월" },
  { weeks: 52, label: "1년" },
  { weeks: 104, label: "2년" },
];

/**
 * 구간 길이가 쓸 만한지. 절반을 넘으면 구간들이 대부분 겹쳐 사실상 표본이 한두 개다
 * (5년 데이터의 4년 구간은 서로 3년 이상 겹친다).
 */
export const windowAllowed = (weeks: number, points: number) => weeks * 2 <= points;

export function rollingVsBenchmark(curve: CurvePoint[], bench: CurvePoint[], weeks: number): RollingStats | null {
  const benchByDate = new Map(bench.map((p) => [p.date, p.idx]));
  // 같은 데이터로 돌린 결과라 날짜가 같지만, 어긋나도 틀리지 않게 공통 날짜만 쓴다.
  const pts = curve
    .filter((p) => benchByDate.has(p.date))
    .map((p) => ({ s: p.idx, b: benchByDate.get(p.date)! }));
  const excess: number[] = [];
  for (let i = 0; i + weeks < pts.length; i++) {
    const a = pts[i];
    const z = pts[i + weeks];
    if (a.s <= 0 || a.b <= 0) continue;
    excess.push((z.s / a.s - z.b / a.b) * 100);
  }
  if (excess.length === 0) return null;
  const sorted = [...excess].sort((x, y) => x - y);
  const mid = sorted.length >> 1;
  return {
    winRate: (excess.filter((e) => e > 0).length / excess.length) * 100,
    medianExcess: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
    windows: excess.length,
  };
}
