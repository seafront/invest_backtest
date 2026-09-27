import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  ReferenceArea,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AutoStrategyResult } from "../types";
import { fmtMonth, ts } from "../utils/chart";
import { NEGATIVE, POSITIVE } from "../theme";

const MUTED = "#94a3b8";
const INK = "#e2e8f0";
const GRID = "#334155";
/** Buy & Hold는 비교 기준이라 계열 색을 쓰지 않고 회색 점선으로 그린다. */
export const BENCHMARK_COLOR = "#94a3b8";

const HEIGHT = 320;
const MARGIN = { top: 12, right: 170, bottom: 4, left: 4 };
const X_AXIS_HEIGHT = 24;
const LABEL_GAP = 14; // 끝 라벨끼리 최소 세로 간격(px)

export interface ChartSeries {
  result: AutoStrategyResult;
  color: string;
  benchmark?: boolean;
}

/** 배경에 옅게 칠할 추세 구간. 상승은 초록, 하락은 빨강 계열이다. */
export interface ChartRegion {
  start: string;
  end: string;
  kind: "up" | "down" | "flat";
}

interface Props {
  series: ChartSeries[];
  hovered: string | null;
  regions?: ChartRegion[];
}

const pct = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;

/** 전략별 누적 수익률을 한 축에 겹쳐 그린다. 선이 적을 때만 끝에 이름을 직접 단다. */
export default function AutoReturnChart({ series, hovered, regions = [] }: Props) {
  const { rows, domain, ticks, labelShift } = useMemo(() => {
    const byDate = new Map<number, Record<string, number>>();
    let lo = 0;
    let hi = 0;
    for (const s of series) {
      for (const p of s.result.curve) {
        const t = ts(p.date);
        const row = byDate.get(t) ?? { t };
        row[s.result.strategy_name] = p.ret;
        byDate.set(t, row);
        lo = Math.min(lo, p.ret);
        hi = Math.max(hi, p.ret);
      }
    }
    // 눈금이 259%·-1%처럼 어색하지 않도록 1·2·5×10ⁿ 간격에 맞춰 축 범위를 넓힌다.
    // 전부 0이면(거래가 한 번도 없으면) 범위가 0이 되어 축과 라벨 배치가 깨진다.
    if (hi - lo < 1) {
      lo -= 5;
      hi += 5;
    }
    const step = niceStep((hi - lo) / 5);
    const dom: [number, number] = [Math.floor(lo / step) * step, Math.ceil(hi / step) * step];
    const tickList: number[] = [];
    for (let v = dom[0]; v <= dom[1] + step / 2; v += step) tickList.push(Math.round(v));

    // 끝 라벨 겹침 풀기. 축 범위를 직접 정했으므로 값→픽셀 환산이 가능하다.
    const plotH = HEIGHT - MARGIN.top - MARGIN.bottom - X_AXIS_HEIGHT;
    const pxPerUnit = plotH / (dom[1] - dom[0]);
    const ends = series
      .map((s) => ({ name: s.result.strategy_name, y: -s.result.total_return * pxPerUnit }))
      .sort((a, b) => a.y - b.y);
    const shift: Record<string, number> = {};
    let prev = -Infinity;
    for (const e of ends) {
      const placed = Math.max(e.y, prev + LABEL_GAP);
      shift[e.name] = placed - e.y;
      prev = placed;
    }
    return {
      rows: [...byDate.values()].sort((a, b) => a.t - b.t),
      domain: dom,
      ticks: tickList,
      labelShift: shift,
    };
  }, [series]);

  if (series.length === 0) return null;
  const lastIndex = rows.length - 1;

  return (
    <ResponsiveContainer width="100%" height={HEIGHT}>
      <LineChart data={rows} margin={MARGIN}>
        <CartesianGrid stroke={GRID} strokeOpacity={0.5} vertical={false} />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={["dataMin", "dataMax"]}
          tickFormatter={fmtMonth}
          tick={{ fill: MUTED, fontSize: 11 }}
          stroke={GRID}
          height={X_AXIS_HEIGHT}
          minTickGap={40}
        />
        <YAxis
          domain={domain}
          ticks={ticks}
          tickFormatter={(v: number) => `${v}%`}
          tick={{ fill: MUTED, fontSize: 11 }}
          stroke={GRID}
          width={52}
        />
        {regions
          .filter((r) => r.kind !== "flat")
          .map((r) => (
            <ReferenceArea
              key={`${r.start}-${r.end}`}
              x1={ts(r.start)}
              x2={ts(r.end)}
              fill={r.kind === "up" ? POSITIVE : NEGATIVE}
              fillOpacity={0.07}
              strokeOpacity={0}
              ifOverflow="hidden"
            />
          ))}
        <ReferenceLine y={0} stroke={MUTED} strokeOpacity={0.6} />
        <Tooltip
          cursor={{ stroke: MUTED, strokeDasharray: "3 3" }}
          content={({ active, label, payload }) => {
            if (!active || !payload?.length) return null;
            const items = [...payload].sort((a, b) => Number(b.value) - Number(a.value));
            return (
              <div style={{ background: "#0f172a", border: `1px solid ${GRID}`, borderRadius: 6, padding: "8px 10px", fontSize: 12 }}>
                <div style={{ color: MUTED, marginBottom: 4 }}>{new Date(Number(label)).toISOString().slice(0, 10)}</div>
                {items.map((it) => {
                  const s = series.find((x) => x.result.strategy_name === it.dataKey);
                  return (
                    <div key={String(it.dataKey)} style={{ display: "flex", alignItems: "center", gap: 6, color: INK }}>
                      <Swatch color={s?.color ?? MUTED} dashed={s?.benchmark} />
                      <span style={{ flex: 1 }}>{s?.result.display_name}</span>
                      <span style={{ fontVariantNumeric: "tabular-nums", marginLeft: 12 }}>{pct(Number(it.value))}</span>
                    </div>
                  );
                })}
              </div>
            );
          }}
        />
        {series.map((s) => {
          const name = s.result.strategy_name;
          const dim = hovered !== null && hovered !== name;
          return (
            <Line
              key={name}
              dataKey={name}
              stroke={s.color}
              strokeWidth={hovered === name ? 3 : 2}
              strokeOpacity={dim ? 0.2 : 1}
              strokeDasharray={s.benchmark ? "5 4" : undefined}
              dot={false}
              activeDot={{ r: 4, stroke: "#1e1e2e", strokeWidth: 2 }}
              isAnimationActive={false}
              label={(p: { x?: number | string; y?: number | string; index?: number }) =>
                p.index === lastIndex && typeof p.x === "number" && typeof p.y === "number" ? (
                  <text
                    key={`${name}-end`}
                    x={p.x + 8}
                    y={p.y + (labelShift[name] ?? 0)}
                    dy={4}
                    fill={INK}
                    fillOpacity={dim ? 0.3 : 1}
                    fontSize={11}
                  >
                    {truncate(s.result.display_name, 16)} {pct(s.result.total_return)}
                  </text>
                ) : (
                  <g key={`${name}-${p.index}`} />
                )
              }
            />
          );
        })}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function Swatch({ color, dashed }: { color: string; dashed?: boolean }) {
  return (
    <svg width={16} height={8} aria-hidden style={{ flexShrink: 0 }}>
      <line x1={0} y1={4} x2={16} y2={4} stroke={color} strokeWidth={2} strokeDasharray={dashed ? "4 3" : undefined} />
    </svg>
  );
}

function niceStep(raw: number): number {
  if (raw <= 0) return 10;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
