/**
 * 차트 공용 헬퍼.
 *
 * 여러 차트가 같은 x축(시간)을 공유해야 세로로 같은 위치가 같은 시점이 된다.
 * 그러려면 날짜를 문자열이 아니라 숫자 타임스탬프로 넘겨 도메인을 고정해야 한다.
 */

/** 긴 시계열을 그릴 때 점을 솎아낸다. 마지막 점은 항상 남긴다. */
export function downsample<T>(rows: T[], target = 500): T[] {
  const step = Math.max(1, Math.floor(rows.length / target));
  return rows.filter((_, i) => i % step === 0 || i === rows.length - 1);
}

/** ISO 날짜 문자열 → 타임스탬프. */
export const ts = (d: string) => Date.parse(d);

/** 타임스탬프 → YYYY-MM. 축 눈금용. */
export const fmtMonth = (t: number) => new Date(t).toISOString().slice(0, 7);

/** 타임스탬프 → MM-DD. 구간이 짧아 YYYY-MM 눈금이 한두 개뿐일 때 쓴다. */
export const fmtDayMonth = (t: number) => new Date(t).toISOString().slice(5, 10);

/** 구간 길이에 맞는 눈금 포맷. 반년 이하면 일 단위까지 보여야 읽힌다. */
export const axisFormatter = ([from, to]: [number, number]) =>
  (to - from) / 86_400_000 <= 200 ? fmtDayMonth : fmtMonth;

/**
 * 도메인을 균등 분할한 눈금 위치.
 *
 * recharts는 눈금을 데이터 점에서 고르기 때문에, 도메인이 같아도 계열마다
 * 라벨이 다르게 찍힌다. 스택 차트에서는 눈금이 세로로 줄 맞아야 비교가 되므로
 * 위치를 직접 지정한다.
 */
export function evenTicks([from, to]: [number, number], count = 8): number[] {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return [];
  const step = (to - from) / (count - 1);
  return Array.from({ length: count }, (_, i) => Math.round(from + step * i));
}
