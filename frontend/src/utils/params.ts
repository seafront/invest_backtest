/** 파라미터 값 표기. 2.0 같은 실수는 2로 줄인다. */
export const fmtParam = (v: number) => (Number.isInteger(v) ? String(v) : String(Number(v.toFixed(4))));

/** fast_period → fast period */
export const paramLabel = (name: string) => name.replace(/_/g, " ");
