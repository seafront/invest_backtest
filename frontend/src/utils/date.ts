/** YYYY-MM-DD (로컬 시간대 기준). toISOString은 UTC라 새벽에 하루가 밀린다. */
export function isoDay(d: Date): string {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/** 오늘로부터 n년 전 날짜 (YYYY-MM-DD). */
export function yearsAgo(n: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  return isoDay(d);
}
