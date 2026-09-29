import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtMonth, niceStep, ts } from "../utils/chart";
import type { ExcessPoint } from "../utils/rolling";
import { NEGATIVE, POSITIVE } from "../theme";
import { Swatch, type ChartRegion } from "./AutoReturnChart";

const MUTED = "#94a3b8";
const INK = "#e2e8f0";
const GRID = "#334155";

// 위 누적 수익률 그래프와 여백·y축 폭을 맞춰야 같은 가로 위치가 같은 날짜가 된다.
const HEIGHT = 220;
const MARGIN = { top: 12, right: 170, bottom: 4, left: 4 };
const X_AXIS_HEIGHT = 24;
const LABEL_GAP = 14;

export interface ExcessSeries {
  key: string;
  label: string;
  color: string;
  points: ExcessPoint[];
  /** 0선 위에 있던 점의 비율(%) — 표의 B&H 승률과 같은 값 */
  winRate: number | null;
}

interface Props {
  series: ExcessSeries[];
  /** 위 그래프와 같은 x축 범위. 첫 구간이 끝나기 전은 비어 있다. */
  range: [string, string];
  hovered: string | null;
  regions?: ChartRegion[];
}

const pp = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%p`;

/**
 * 구간 끝 날짜마다 "직전 N주 동안 전략 − B&H"를 그린다. 0선 위면 그 구간은 B&H를 이겼다.
 * 비교 구간을 바꾸면 선이 다시 계산된다 — 짧을수록 들쭉날쭉, 길수록 매끄럽다.
 */
export default function RollingExcessChart({ series, range, hovered, regions = [] }: Props) {
  const { rows, domain, ticks, labelShift } = useMemo(() => {
    const byDate = new Map<number, Record<string, number>>();
    let lo = 0;
    let hi = 0;
    for (const s of series) {
      for (const p of s.points) {
        const t = ts(p.date);
        const row = byDate.get(t) ?? { t };
        row[s.key] = p.excess;
        byDate.set(t, row);
        lo = Math.min(lo, p.excess);
        hi = Math.max(hi, p.excess);
      }
    }
    if (hi - lo < 1) {
      lo -= 5;
      hi += 5;
    }
    const step = niceStep((hi - lo) / 4);
    const dom: [number, number] = [Math.floor(lo / step) * step, Math.ceil(hi / step) * step];
    const tickList: number[] = [];
    for (let v = dom[0]; v <= dom[1] + step / 2; v += step) tickList.push(Math.round(v));

    const plotH = HEIGHT - MARGIN.top - MARGIN.bottom - X_AXIS_HEIGHT;
    const pxPerUnit = plotH / (dom[1] - dom[0]);
    const ends = series
      .filter((s) => s.points.length > 0)
      .map((s) => ({ key: s.key, y: -s.points[s.points.length - 1].excess * pxPerUnit }))
      .sort((a, b) => a.y - b.y);
    const shift: Record<string, number> = {};
    let prev = -Infinity;
    for (const e of ends) {
      const placed = Math.max(e.y, prev + LABEL_GAP);
      shift[e.key] = placed - e.y;
      prev = placed;
    }
    return {
      rows: [...byDate.values()].sort((a, b) => a.t - b.t),
      domain: dom,
      ticks: tickList,
      labelShift: shift,
    };
  }, [series]);

  if (rows.length === 0) return null;
  const lastIndex = rows.length - 1;

  return (
    <ResponsiveContainer width="100%" height={HEIGHT}>
      <LineChart data={rows} margin={MARGIN}>
        <CartesianGrid stroke={GRID} strokeOpacity={0.5} vertical={false} />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={[ts(range[0]), ts(range[1])]}
          tickFormatter={fmtMonth}
          tick={{ fill: MUTED, fontSize: 11 }}
          stroke={GRID}
          height={X_AXIS_HEIGHT}
          minTickGap={40}
        />
        <YAxis
          domain={domain}
          ticks={ticks}
          tickFormatter={(v: number) => `${v}%p`}
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
        {/* 0선 = B&H와 같은 수익. 위 그래프의 B&H 점선과 같은 모양으로 기준임을 알린다. */}
        <ReferenceLine y={0} stroke={MUTED} strokeDasharray="5 4" />
        <Tooltip
          cursor={{ stroke: MUTED, strokeDasharray: "3 3" }}
          content={({ active, label, payload }) => {
            if (!active || !payload?.length) return null;
            const items = [...payload].sort((a, b) => Number(b.value) - Number(a.value));
            return (
              <div style={{ background: "#0f172a", border: `1px solid ${GRID}`, borderRadius: 6, padding: "8px 10px", fontSize: 12 }}>
                <div style={{ color: MUTED, marginBottom: 4 }}>
                  {new Date(Number(label)).toISOString().slice(0, 10)}로 끝나는 구간 · B&H 대비
                </div>
                {items.map((it) => {
                  const s = series.find((x) => x.key === it.dataKey);
                  const v = Number(it.value);
                  return (
                    <div key={String(it.dataKey)} style={{ display: "flex", alignItems: "center", gap: 6, color: INK }}>
                      <Swatch color={s?.color ?? MUTED} />
                      <span style={{ flex: 1 }}>{s?.label}</span>
                      <span style={{ fontVariantNumeric: "tabular-nums", marginLeft: 12, color: v >= 0 ? POSITIVE : NEGATIVE }}>
                        {pp(v)}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          }}
        />
        {series.map((s) => {
          const dim = hovered !== null && hovered !== s.key;
          return (
            <Line
              key={s.key}
              dataKey={s.key}
              stroke={s.color}
              strokeWidth={hovered === s.key ? 3 : 2}
              strokeOpacity={dim ? 0.2 : 1}
              dot={false}
              activeDot={{ r: 4, stroke: "#1e1e2e", strokeWidth: 2 }}
              isAnimationActive={false}
              connectNulls
              label={(p: { x?: number | string; y?: number | string; index?: number }) =>
                p.index === lastIndex && typeof p.x === "number" && typeof p.y === "number" ? (
                  <text
                    key={`${s.key}-end`}
                    x={p.x + 8}
                    y={p.y + (labelShift[s.key] ?? 0)}
                    dy={4}
                    fill={INK}
                    fillOpacity={dim ? 0.3 : 1}
                    fontSize={11}
                  >
                    {s.label}
                    {s.winRate !== null && ` 승률 ${s.winRate.toFixed(0)}%`}
                  </text>
                ) : (
                  <g key={`${s.key}-${p.index}`} />
                )
              }
            />
          );
        })}
      </LineChart>
    </ResponsiveContainer>
  );
}
