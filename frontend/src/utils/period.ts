import type { BacktestResult } from "../types";

export interface Period {
  start: string;
  end: string;
}

export const fullPeriodOf = (saved: BacktestResult): Period => ({ start: saved.start_date, end: saved.end_date });

export const isFullPeriod = (p: Period, saved: BacktestResult) =>
  p.start === saved.start_date && p.end === saved.end_date;

/** 고를 수 없는 구간이면 사유. 시세가 캐시돼 있는 저장된 구간 안에서만 고른다. */
export function periodError(p: Period, saved: BacktestResult): string {
  if (!p.start || !p.end) return "시작일과 종료일을 입력하세요";
  if (p.start < saved.start_date || p.end > saved.end_date) return `${saved.start_date} ~ ${saved.end_date} 안에서 고르세요`;
  if (p.start >= p.end) return "시작일이 종료일보다 앞이어야 합니다";
  return "";
}
