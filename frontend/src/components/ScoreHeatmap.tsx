import { useState } from "react";
import { fmtParam, paramLabel } from "../utils/params";

const MUTED = "#94a3b8";
const INK = "#e2e8f0";
const GRID = "#334155";
const SURFACE = "#1e1e2e";

/**
 * 순차(단일 색상) 파랑 램프. 다크 배경에서는 낮은 값이 배경 쪽(어두움), 높은 값이 밝다.
 * 값의 크기를 나타내므로 무지개나 두 색 대비를 쓰지 않는다.
 */
const RAMP = ["#0d366b", "#104281", "#184f95", "#1c5cab", "#256abf", "#2a78d6", "#3987e5",
  "#5598e7", "#6da7ec", "#86b6ef", "#9ec5f4", "#b7d3f6", "#cde2fb"];

export interface HeatCell {
  value: number | null;
  excluded: string | null;
  detail: string;
}

export interface HeatMarker {
  x: number;
  y: number;
  symbol: string;
  label: string;
}

interface Props {
  xName: string;
  xValues: number[];
  yName: string;
  yValues: number[];
  cell: (x: number, y: number) => HeatCell | null;
  markers: HeatMarker[];
  fmt: (v: number) => string;
}

function color(v: number, lo: number, hi: number): string {
  const t = hi > lo ? (v - lo) / (hi - lo) : 1;
  return RAMP[Math.round(Math.min(1, Math.max(0, t)) * (RAMP.length - 1))];
}

/** 파라미터 두 개의 조합별 점수. 칸 위에 올리면 아래에 자세한 값이 나온다. */
export default function ScoreHeatmap({ xName, xValues, yName, yValues, cell, markers, fmt }: Props) {
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const values: number[] = [];
  for (const y of yValues) for (const x of xValues) {
    const c = cell(x, y);
    if (c?.value != null && !c.excluded) values.push(c.value);
  }
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const hovered = hover ? cell(hover.x, hover.y) : null;
  const size = 30;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start", overflowX: "auto" }}>
        <div style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", color: MUTED, fontSize: 12, alignSelf: "center" }}>
          {paramLabel(yName)} →
        </div>
        <div>
          <div style={{ display: "grid", gridTemplateColumns: `44px repeat(${xValues.length}, ${size}px)`, gap: 2 }}>
            {[...yValues].reverse().map((y) => (
              <div key={y} style={{ display: "contents" }}>
                <div style={{ color: MUTED, fontSize: 11, textAlign: "right", paddingRight: 6, lineHeight: `${size - 6}px` }}>
                  {fmtParam(y)}
                </div>
                {xValues.map((x) => {
                  const c = cell(x, y);
                  const mark = markers.find((m) => m.x === x && m.y === y);
                  const bg = !c || c.value == null
                    ? SURFACE
                    : c.excluded
                      ? "#2a2a3a"
                      : color(c.value, lo, hi);
                  const light = c?.value != null && !c.excluded && hi > lo && (c.value - lo) / (hi - lo) > 0.55;
                  return (
                    <div
                      key={x}
                      onMouseEnter={() => setHover({ x, y })}
                      onMouseLeave={() => setHover(null)}
                      style={{
                        width: size,
                        height: size - 6,
                        background: bg,
                        borderRadius: 3,
                        outline: hover?.x === x && hover?.y === y ? `2px solid ${INK}` : undefined,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 12,
                        fontWeight: 700,
                        color: light ? "#0b0b0b" : INK,
                        // 제약을 어긴 칸은 빗금으로도 구분한다 — 색만으로 구분하지 않는다
                        backgroundImage: c?.excluded
                          ? "repeating-linear-gradient(45deg, transparent 0 4px, rgba(148,163,184,0.25) 4px 5px)"
                          : undefined,
                        cursor: "default",
                      }}
                    >
                      {mark?.symbol}
                    </div>
                  );
                })}
              </div>
            ))}
            <div />
            {xValues.map((x) => (
              <div key={x} style={{ color: MUTED, fontSize: 10, textAlign: "center" }}>
                {fmtParam(x)}
              </div>
            ))}
          </div>
          <div style={{ color: MUTED, fontSize: 12, textAlign: "center", marginTop: 4 }}>{paramLabel(xName)} →</div>
        </div>
        <div style={{ fontSize: 11, color: MUTED, marginLeft: 8, minWidth: 90 }}>
          <div style={{ marginBottom: 4 }}>점수</div>
          <div style={{ display: "flex", alignItems: "stretch", gap: 6 }}>
            <div style={{ width: 10, height: 120, borderRadius: 3, background: `linear-gradient(to top, ${RAMP[0]}, ${RAMP[RAMP.length - 1]})` }} />
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              <span>{values.length ? fmt(hi) : "—"}</span>
              <span>{values.length ? fmt(lo) : "—"}</span>
            </div>
          </div>
          <div style={{ marginTop: 10, lineHeight: 1.7 }}>
            {markers.map((m) => (
              <div key={m.label}>
                <b style={{ color: INK }}>{m.symbol}</b> {m.label}
              </div>
            ))}
            <div>
              <span style={{ display: "inline-block", width: 10, height: 10, background: "#2a2a3a", border: `1px solid ${GRID}`,
                backgroundImage: "repeating-linear-gradient(45deg, transparent 0 3px, rgba(148,163,184,0.4) 3px 4px)", verticalAlign: "middle" }} />{" "}
              제약 위반
            </div>
          </div>
        </div>
      </div>
      <div style={{ color: hovered ? INK : "#64748b", fontSize: 12, minHeight: 18, marginTop: 6 }}>
        {hover && hovered
          ? `${paramLabel(xName)} ${fmtParam(hover.x)} · ${paramLabel(yName)} ${fmtParam(hover.y)} — ${hovered.detail}`
          : hover
            ? "평가하지 않은 조합"
            : "칸 위에 올리면 값이 나옵니다"}
      </div>
    </div>
  );
}
