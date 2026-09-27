/**
 * 백테스트 금액의 통화.
 *
 * 엔진은 통화를 모르고 시세와 같은 단위로 계산한다. 한국 종목(.KS/.KQ)은 시세가 원화라
 * 투자금도 원화여야 한다 — 달러 기준 기본값(월 1,000)으로는 28만 원짜리 주식을 1주도
 * 살 수 없어 모든 전략이 0%로 나왔다. 그래서 입력과 표시 모두 종목에서 통화를 정한다.
 */
export type Currency = "USD" | "KRW";

export const currencyOf = (ticker: string): Currency =>
  /\.(KS|KQ)$/i.test(ticker.trim()) ? "KRW" : "USD";

export const SYMBOL: Record<Currency, string> = { USD: "$", KRW: "₩" };

/** 통화별 입력 기본값과 단위. 원화는 1주가 수십만 원이라 달러의 1,000배로 잡는다. */
export const AMOUNT_DEFAULTS: Record<Currency, {
  capital: number; monthly: number; capitalMin: number; capitalStep: number; monthlyMin: number; monthlyStep: number;
}> = {
  USD: { capital: 100_000, monthly: 1_000, capitalMin: 1_000, capitalStep: 1_000, monthlyMin: 100, monthlyStep: 100 },
  KRW: { capital: 100_000_000, monthly: 1_000_000, capitalMin: 1_000_000, capitalStep: 1_000_000, monthlyMin: 100_000, monthlyStep: 100_000 },
};

/** 금액 표기. 원화는 소수점을 쓰지 않는다. */
export function fmtMoney(v: number, currency: Currency, decimals = 0): string {
  const d = currency === "KRW" ? 0 : decimals;
  const sign = v < 0 ? "-" : "";
  return `${sign}${SYMBOL[currency]}${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}

/** 축 눈금용 짧은 표기. $120k / ₩1.2억 */
export function fmtMoneyShort(v: number, currency: Currency): string {
  if (currency === "KRW") {
    const abs = Math.abs(v);
    if (abs >= 1e8) return `₩${(v / 1e8).toFixed(abs >= 1e9 ? 0 : 1)}억`;
    return `₩${Math.round(v / 1e4).toLocaleString()}만`;
  }
  return `$${(v / 1000).toFixed(0)}k`;
}
