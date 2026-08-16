import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
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
import { getMacroSeries } from "../api/client";
import type { MacroSeriesDetail } from "../types";
import { errMessage } from "../utils/error";
import { NEGATIVE, POSITIVE } from "../theme";

const MUTED = "#94a3b8";
const INK = "#e2e8f0";
const SURFACE = "#1e1e2e";
const GRID = "#334155";
const LINE = "#0891b2"; // 지표 계열색 — 상승/하락 의미가 아니므로 POSITIVE/NEGATIVE를 쓰지 않는다

const FREQ_LABEL: Record<string, string> = {
  daily: "일간",
  weekly: "주간",
  monthly: "월간",
  quarterly: "분기",
};

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ background: SURFACE, borderRadius: 8, padding: "16px 24px", minWidth: 140, flex: 1 }}>
      <div style={{ color: MUTED, fontSize: 13, marginBottom: 4 }}>{label}</div>
      <div style={{ color: INK, fontSize: 22, fontWeight: 700 }}>{value}</div>
      {sub && <div style={{ color: "#64748b", fontSize: 12, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function downsample<T>(rows: T[], target = 700): T[] {
  const step = Math.max(1, Math.floor(rows.length / target));
  return rows.filter((_, i) => i % step === 0 || i === rows.length - 1);
}

export default function MacroDetail() {
  const { seriesId = "" } = useParams();
  const [loaded, setLoaded] = useState<{ id: string; data: MacroSeriesDetail | null; error: string } | null>(
    null
  );

  const current = loaded?.id === seriesId ? loaded : null;
  const loading = current === null;

  useEffect(() => {
    let cancelled = false;
    getMacroSeries(seriesId)
      .then((r) => {
        if (!cancelled) setLoaded({ id: seriesId, data: r.data, error: "" });
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoaded({ id: seriesId, data: null, error: errMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [seriesId]);

  if (loading) return <p style={{ color: MUTED }}>Loading {seriesId}…</p>;
  if (current.error || !current.data)
    return (
      <div>
        <Link to="/data" style={{ color: "#3b82f6", fontSize: 14 }}>← Data</Link>
        <p style={{ color: NEGATIVE, marginTop: 16 }}>Error: {current.error}</p>
      </div>
    );

  const s = current.data;
  const chart = downsample(s.data);
  // 값이 음수로 내려갈 수 있는 지표(금리차 등)는 0선을 그려 부호를 읽히게 한다
  const crossesZero = s.min_value < 0 && s.max_value > 0;

  return (
    <div>
      <Link to="/data" style={{ color: "#3b82f6", fontSize: 14 }}>← Data</Link>

      <h2 style={{ color: INK, margin: "12px 0 4px" }}>{s.name}</h2>
      <p style={{ color: MUTED, fontSize: 14, marginBottom: 8 }}>
        {s.series_id} · {s.source} · {FREQ_LABEL[s.frequency] ?? s.frequency} · {s.start_date} ~ {s.end_date}
      </p>
      {s.description && (
        <p style={{ color: "#64748b", fontSize: 14, marginBottom: 20, maxWidth: 780 }}>{s.description}</p>
      )}

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
        <Tile label="최근 값" value={`${s.latest_value.toLocaleString()}${s.unit}`} sub={s.end_date} />
        <Tile label="최저" value={`${s.min_value.toLocaleString()}${s.unit}`} />
        <Tile label="최고" value={`${s.max_value.toLocaleString()}${s.unit}`} />
        <Tile label="관측치" value={s.count.toLocaleString()} sub={FREQ_LABEL[s.frequency] ?? s.frequency} />
      </div>

      <div style={{ background: SURFACE, borderRadius: 8, padding: 16, marginBottom: 24 }}>
        <h3 style={{ color: INK, marginBottom: 4 }}>{s.name} 추이</h3>
        <p style={{ color: MUTED, fontSize: 13, marginBottom: 12 }}>
          단위 {s.unit || "—"}
          {crossesZero && " · 0선을 지나므로 부호가 바뀌는 구간을 함께 표시했다"}
        </p>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={chart} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="macroFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={LINE} stopOpacity={0.4} />
                <stop offset="100%" stopColor={LINE} stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
            <XAxis
              dataKey="date"
              tick={{ fill: MUTED, fontSize: 11 }}
              tickFormatter={(v: string) => v.slice(0, 7)}
              minTickGap={40}
            />
            <YAxis tick={{ fill: MUTED, fontSize: 11 }} width={64} />
            <Tooltip
              contentStyle={{ background: "#0f172a", border: `1px solid ${GRID}` }}
              labelStyle={{ color: INK }}
              formatter={(v) => [`${Number(v).toLocaleString()}${s.unit}`, s.name] as [string, string]}
            />
            {crossesZero && <ReferenceLine y={0} stroke={NEGATIVE} strokeDasharray="4 4" />}
            <Area
              type="monotone"
              dataKey="value"
              stroke={LINE}
              strokeWidth={2}
              fill="url(#macroFill)"
              dot={false}
              // 수백~수천 포인트에서는 진입 애니메이션이 이득 없이 렌더만 지연시킨다
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <p style={{ color: "#64748b", fontSize: 13 }}>
        출처: Federal Reserve Bank of St. Louis (FRED) · 시계열 <code style={{ color: POSITIVE }}>{s.series_id}</code>.
        거시 지표는 사후 수정(revision)이 발생하므로, 과거 값이 발표 당시와 다를 수 있다.
      </p>
    </div>
  );
}
