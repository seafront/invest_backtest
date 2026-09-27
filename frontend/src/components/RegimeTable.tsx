import type { AutoStrategyResult, TrendRegime } from "../types";
import { NEGATIVE, POSITIVE } from "../theme";
import { Swatch } from "./AutoReturnChart";

const MUTED = "#94a3b8";
const INK = "#e2e8f0";
const GRID = "#334155";

export interface RegimeRow {
  key: string;
  label: string;
  color: string;
  r: AutoStrategyResult;
}

interface Props {
  regimes: TrendRegime[];
  rows: RegimeRow[];
  /** 추세 전환으로 본 되돌림(%) */
  threshold: number;
}

const KIND_LABEL = { up: "상승", down: "하락", flat: "횡보" } as const;
const pct = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
const month = (d: string) => d.slice(0, 7);

/** 첫 매매와 구간의 관계. 첫 매매 전 구간의 0%는 방어가 아니라 미진입이다. */
function entryState(r: AutoStrategyResult, g: TrendRegime): "before" | "partial" | "in" {
  const first = r.first_trade;
  if (!first || first >= g.end) return "before";
  if (first > g.start) return "partial";
  return "in";
}

/**
 * 국면별 포착률: 상승 구간에서 B&H 상승분 중 얼마를 가져갔나, 하락 구간에서 B&H 하락분 중
 * 얼마를 맞았나. 로그 수익률 합의 비로 잰다 — 단순 합은 +100%와 -50%를 같은 크기로 보지 못한다.
 * 첫 매매 전 구간은 뺀다.
 */
function capture(r: AutoStrategyResult, regimes: TrendRegime[], kind: "up" | "down"): number | null {
  let s = 0;
  let b = 0;
  regimes.forEach((g, i) => {
    const v = r.regime_returns?.[i];
    if (g.kind !== kind || v == null || entryState(r, g) === "before") return;
    s += Math.log(1 + v / 100);
    b += Math.log(1 + g.benchmark_return / 100);
  });
  return b === 0 ? null : (s / b) * 100;
}

/** 추세 구간(B&H 기준 상승·하락)마다 원래 값과 변형이 어떻게 움직였는지. */
export default function RegimeTable({ regimes, rows, threshold }: Props) {
  if (regimes.length === 0) return null;
  const th: React.CSSProperties = { color: MUTED, fontWeight: 600, padding: "8px 10px", whiteSpace: "nowrap" };
  const num: React.CSSProperties = { textAlign: "right", padding: "7px 10px", fontVariantNumeric: "tabular-nums" };

  return (
    <div style={{ marginTop: 20 }}>
      <h4 style={{ color: INK, margin: "0 0 4px", fontSize: 14 }}>추세 구간별 성과</h4>
      <p style={{ color: "#64748b", fontSize: 12, margin: "0 0 10px" }}>
        Buy & Hold가 고점·저점에서 {threshold.toFixed(0)}% 넘게 되돌린 곳을 전환점으로 나눴습니다(종목 변동성에 비례).
        전환점은 지나고 나서야 확정되므로 과거를 설명하는 구분이지 매매 신호가 아닙니다. 그래프 배경의 초록·빨강이 이 구간입니다.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${GRID}` }}>
              <th style={{ ...th, textAlign: "left" }}>구간</th>
              <th style={{ ...th, textAlign: "right" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Swatch color={MUTED} dashed />
                  B&H
                </span>
              </th>
              {rows.map((row) => (
                <th key={row.key} style={{ ...th, textAlign: "right" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Swatch color={row.color} />
                    {row.label}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {regimes.map((g, i) => (
              <tr key={g.start} style={{ borderBottom: "1px solid #1e293b" }}>
                <td style={{ padding: "7px 10px", color: INK, whiteSpace: "nowrap" }}>
                  <span
                    style={{
                      color: g.kind === "up" ? POSITIVE : g.kind === "down" ? NEGATIVE : MUTED,
                      fontWeight: 600,
                      marginRight: 6,
                    }}
                  >
                    {g.kind === "up" ? "▲" : g.kind === "down" ? "▼" : "–"} {KIND_LABEL[g.kind]}
                  </span>
                  {month(g.start)} ~ {month(g.end)}
                  <span style={{ color: "#64748b", fontSize: 11, marginLeft: 6 }}>{g.weeks}주</span>
                </td>
                <td style={{ ...num, color: g.benchmark_return >= 0 ? POSITIVE : NEGATIVE }}>{pct(g.benchmark_return)}</td>
                {rows.map((row) => {
                  const v = row.r.regime_returns?.[i];
                  const state = entryState(row.r, g);
                  if (v == null || state === "before") {
                    return (
                      <td key={row.key} style={{ ...num, color: "#64748b", fontSize: 12 }} title="첫 매매 전이라 비교하지 않습니다">
                        첫 매매 전
                      </td>
                    );
                  }
                  const excess = v - g.benchmark_return;
                  return (
                    <td key={row.key} style={num}>
                      <span style={{ color: v >= 0 ? POSITIVE : NEGATIVE }}>{pct(v)}</span>
                      <span
                        style={{ color: excess >= 0 ? POSITIVE : NEGATIVE, fontSize: 11, marginLeft: 6, opacity: 0.85 }}
                        title="같은 구간 B&H 대비"
                      >
                        ({excess >= 0 ? "+" : ""}
                        {excess.toFixed(1)}%p)
                      </span>
                      {state === "partial" && (
                        <span style={{ color: "#64748b", fontSize: 11, marginLeft: 4 }} title="구간 도중에 첫 매매">
                          *
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {(["up", "down"] as const).map((kind) => (
              <tr key={kind} style={{ background: "rgba(148, 163, 184, 0.06)" }}>
                <td style={{ padding: "7px 10px", color: MUTED, fontSize: 12, whiteSpace: "nowrap" }}>
                  {kind === "up" ? "상승 구간 포착률" : "하락 구간 노출률"}
                  <span style={{ color: "#64748b", marginLeft: 6 }}>
                    {kind === "up" ? "높을수록 추종" : "낮을수록 방어"}
                  </span>
                </td>
                <td style={{ ...num, color: "#64748b" }}>100%</td>
                {rows.map((row) => {
                  const c = capture(row.r, regimes, kind);
                  return (
                    <td key={row.key} style={{ ...num, color: INK, fontWeight: 600 }}>
                      {c === null ? "—" : `${c.toFixed(0)}%`}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ color: "#64748b", fontSize: 11, margin: "6px 0 0" }}>
        괄호는 같은 구간 B&H 대비 차이입니다. * 는 구간 도중에 첫 매매가 있었다는 뜻입니다. 포착률·노출률은 첫 매매 이후 구간만 셉니다.
      </p>
    </div>
  );
}
