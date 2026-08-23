import { evenTicks } from "../utils/chart";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const MUTED = "#94a3b8";
const INK = "#e2e8f0";
const GRID = "#334155";

const tooltipStyle = {
  contentStyle: { background: "#0f172a", border: `1px solid ${GRID}` },
  labelStyle: { color: INK },
};

/**
 * 같은 x축을 공유하는 스택 차트의 한 칸.
 *
 * XAxis 설정을 이 안에만 두는 것이 핵심이다. 칸마다 축을 따로 쓰면
 * 눈금이 조금씩 어긋나 "세로로 같은 위치가 같은 시점"이라는 약속이 깨진다.
 */
export default function ChartRow({
  rows,
  tDomain,
  fmtX,
  lines,
  gradientId,
  title,
  fmtValue,
  fmtTooltip,
  refLine,
  yDomain,
  height = 150,
}: {
  rows: { t: number }[];
  tDomain: [number, number];
  /** 구간 길이에 따라 달라진다. 세 차트가 같은 함수를 써야 눈금이 어긋나지 않는다. */
  fmtX: (t: number) => string;
  /** 한 계열이면 면적으로, 여러 계열이면 선으로 그린다. 면적을 겹치면 서로를 가린다. */
  lines: { key: string; color: string; label: string }[];
  gradientId: string;
  title: string;
  fmtValue: (n: number) => string;
  /** 툴팁 전용 포맷. y축 눈금과 달리 단위를 붙이고 싶을 때 쓴다. */
  fmtTooltip?: (n: number) => string;
  refLine?: number;
  /** 기본값은 0부터 시작한다. 가격처럼 0이 기준이 아닌 계열은 ["auto","auto"]를 쓴다. */
  yDomain?: [string | number, string | number];
  height?: number;
}) {
  const filled = lines.length === 1;
  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginTop: 6 }}>
        <span style={{ color: MUTED, fontSize: 12 }}>{title}</span>
        {!filled && (
          <span style={{ display: "flex", gap: 10 }}>
            {lines.map((l) => (
              <span key={l.key} style={{ color: MUTED, fontSize: 11 }}>
                <span style={{ color: l.color, fontWeight: 700 }}>—</span> {l.label}
              </span>
            ))}
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={lines[0].color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={lines[0].color} stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={tDomain}
            ticks={evenTicks(tDomain)}
            tick={{ fill: MUTED, fontSize: 11 }}
            tickFormatter={fmtX}
            minTickGap={20}
          />
          <YAxis
            width={56}
            domain={yDomain}
            tick={{ fill: MUTED, fontSize: 11 }}
            tickFormatter={fmtValue}
          />
          <Tooltip
            {...tooltipStyle}
            labelFormatter={(t) => fmtX(Number(t))}
            formatter={(v, name) => [(fmtTooltip ?? fmtValue)(Number(v)), String(name)] as [string, string]}
          />
          {refLine !== undefined && (
            <ReferenceLine y={refLine} stroke={MUTED} strokeDasharray={refLine === 0 ? undefined : "4 4"} strokeWidth={1} />
          )}
          {lines.map((l) => (
            <Area
              key={l.key}
              type="monotone"
              dataKey={l.key}
              name={l.label}
              stroke={l.color}
              strokeWidth={2}
              fill={filled ? `url(#${gradientId})` : "none"}
              dot={false}
              isAnimationActive={false}
              connectNulls={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </>
  );
}
