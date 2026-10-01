import { useEffect, useState } from "react";
import type { GuideRow, TriggerRange } from "../types";
import { getPortfolioGuide } from "../api/client";
import { errMessage } from "../utils/error";
import { CAUTION, NEGATIVE, POSITIVE } from "../theme";
import { currencyOf, fmtMoney } from "../utils/money";
import { fmtParam, paramLabel } from "../utils/params";

const MUTED = "#94a3b8";
const DIM = "#64748b";
const INK = "#e2e8f0";
const GRID = "#334155";

const money = (v: number, ticker: string) => fmtMoney(v, currencyOf(ticker), currencyOf(ticker) === "KRW" ? 0 : 2);
const sp = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;

/** 신호가 나는 내일 종가 구간을 한 줄로. */
function rangeText(r: TriggerRange, ticker: string): string {
  if (r.open_low && r.open_high) return "내일 종가와 상관없이 (±20% 어디서나)";
  if (r.open_low) return `${money(r.high, ticker)} 이하 (${sp(r.high_pct)} 이하)`;
  if (r.open_high) return `${money(r.low, ticker)} 이상 (${sp(r.low_pct)} 이상)`;
  return `${money(r.low, ticker)} ~ ${money(r.high, ticker)} (${sp(r.low_pct)} ~ ${sp(r.high_pct)})`;
}

interface Props {
  version: number;
}

/**
 * 매수·매도 시점 가이드. 보유 종목과 목표 비중 종목마다 연결한 전략의 지금 상태와, 내일 종가가 얼마면
 * 다음 신호(보유 중이면 SELL, 관망이면 BUY)가 나는지 보여 준다.
 */
export default function GuidePanel({ version }: Props) {
  const [rows, setRows] = useState<GuideRow[] | null>(null);
  const [error, setError] = useState("");
  const [loadedVersion, setLoadedVersion] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPortfolioGuide()
      .then((r) => {
        if (cancelled) return;
        setRows(r.data);
        setError("");
        setLoadedVersion(version);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(errMessage(err, "가이드를 계산하지 못했습니다"));
        setLoadedVersion(version);
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

  const loading = loadedVersion !== version;

  return (
    <div style={{ background: "#1e1e2e", borderRadius: 8, padding: 20, marginBottom: 24 }}>
      <h3 style={{ color: INK, margin: "0 0 4px", fontSize: 16 }}>매수 · 매도 시점 가이드</h3>
      <p style={{ color: DIM, fontSize: 12, margin: "0 0 12px", lineHeight: 1.6 }}>
        보유 종목과 목표 비중 종목마다 연결한 전략이 지금 보유 상태인지, 그리고 <b style={{ color: MUTED }}>내일 종가가 얼마면 다음 신호가 나는지</b>를
        계산합니다. 내일 종가를 지금 ±20% 안에서 바꿔 가며 전략을 다시 돌려 찾습니다(시가는 오늘 종가, 고가·저가는 시가와 종가로 가정). 전략은 보유
        종목 "설정"이나 Signals 워치리스트에서 연결합니다.
      </p>
      {error && <p style={{ color: NEGATIVE, fontSize: 13 }}>{error}</p>}
      {loading && <p style={{ color: MUTED, fontSize: 13 }}>계산 중… (종목당 1~3초)</p>}
      {rows && rows.length === 0 && !loading && <p style={{ color: MUTED, fontSize: 13 }}>보유 종목이나 목표 비중 종목이 없습니다.</p>}

      {rows && rows.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))", gap: 12, opacity: loading ? 0.5 : 1 }}>
          {rows.map((r) => (
            <GuideCard key={r.ticker} r={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function GuideCard({ r }: { r: GuideRow }) {
  const want = r.next_action;
  const zeroHit = r.ranges.some((x) => x.low_pct <= 0 && x.high_pct >= 0);
  return (
    <div style={{ background: "#0f172a", border: `1px solid ${zeroHit ? CAUTION : GRID}`, borderRadius: 8, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span style={{ color: INK, fontWeight: 700 }}>
          {r.ticker} <span style={{ color: DIM, fontSize: 11, fontWeight: 400 }}>{r.held ? "보유" : "목표만"}</span>
        </span>
        {r.position && (
          <span style={{ color: r.position === "long" ? POSITIVE : MUTED, fontSize: 12, fontWeight: 600 }}>
            {r.position === "long" ? "● 전략 보유" : "○ 전략 관망"}
          </span>
        )}
      </div>

      {!r.strategy_name ? (
        <p style={{ color: DIM, fontSize: 12, margin: "6px 0 0" }}>연결한 전략이 없습니다 — 보유 종목 "설정"이나 Signals 워치리스트에서 연결하세요.</p>
      ) : r.error ? (
        <p style={{ color: NEGATIVE, fontSize: 12, margin: "6px 0 0" }}>{r.error}</p>
      ) : (
        <>
          <div style={{ color: MUTED, fontSize: 12, marginTop: 2 }}>
            {r.display_name}
            <span style={{ color: DIM }}>
              {" "}
              · {Object.entries(r.params ?? {}).map(([k, v]) => `${paramLabel(k)} ${fmtParam(v)}`).join(" · ")} · {r.source}
            </span>
          </div>
          <div style={{ color: DIM, fontSize: 12, marginTop: 4 }}>
            마지막 신호{" "}
            {r.last_signal ? (
              <span style={{ color: INK }}>
                {r.last_signal.action} {r.last_signal.date} @ {money(r.last_signal.price, r.ticker)}
              </span>
            ) : (
              "없음"
            )}{" "}
            · 종가 {r.last_close != null && money(r.last_close, r.ticker)} ({r.last_bar_date})
          </div>
          <div style={{ marginTop: 8, fontSize: 13 }}>
            <span style={{ color: want === "BUY" ? POSITIVE : NEGATIVE, fontWeight: 700 }}>{want === "BUY" ? "▲ 다음 BUY" : "▼ 다음 SELL"}</span>
            <span style={{ color: DIM }}> — 내일 종가가</span>
            {r.ranges.length === 0 ? (
              <div style={{ color: MUTED, marginTop: 2 }}>±20% 안에서는 신호가 나지 않습니다</div>
            ) : (
              r.ranges.map((x, i) => (
                <div key={i} style={{ color: INK, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
                  {rangeText(x, r.ticker)}
                </div>
              ))
            )}
          </div>
          {zeroHit && <div style={{ color: CAUTION, fontSize: 12, marginTop: 4 }}>지금 종가 그대로여도 내일 {want} 신호가 납니다</div>}
          {r.mismatch && <div style={{ color: CAUTION, fontSize: 12, marginTop: 4 }}>⚠ {r.mismatch}</div>}
        </>
      )}
    </div>
  );
}
