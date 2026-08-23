import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getMacroSeries, getStockIndicators } from "../api/client";
import type { MacroSeriesDetail, StockIndicators } from "../types";
import { errMessage } from "../utils/error";
import { downsample, ts } from "../utils/chart";
import { POSITIVE, NEGATIVE, SERIES_COLORS } from "../theme";

/**
 * 목록에서 행을 펼쳤을 때 보여주는 요약.
 *
 * 전체 분석은 상세 페이지(/data/:ticker)가 맡는다. 여기서는 목록 화면이 답해야 할
 * 질문 — "이 데이터를 다시 받아야 하나, 구간이 맞나" — 에 필요한 만큼만 보여준다.
 */

const MUTED = "#94a3b8";
const INK = "#e2e8f0";
const GRID = "#334155";
const PANEL = "#0f172a";
const SPARK = SERIES_COLORS[2];

/** 끝점 눈금은 연-월-일까지 적는다 — 구간을 정확히 알리는 게 목적이다. */
const fmtDay = (t: number) => new Date(t).toISOString().slice(0, 10);

const box: React.CSSProperties = {
  background: PANEL,
  border: `1px solid ${GRID}`,
  borderRadius: 8,
  padding: 16,
  margin: "4px 0 12px",
};

const tooltipStyle = {
  contentStyle: { background: "#0f172a", border: `1px solid ${GRID}` },
  labelStyle: { color: INK },
};

/**
 * 미리보기용 미니 차트.
 *
 * 눈금은 양 끝점만 붙인다. 전체 눈금을 달면 스파크라인이 아니라 작은 차트가 되고,
 * 아무것도 없으면 선의 높낮이가 무엇을 뜻하는지 알 수 없다. 시작·끝 날짜와
 * 최저·최고값만 있으면 "어느 구간의, 어느 범위 안 움직임인지"는 읽힌다.
 * 정확한 값은 툴팁이 답한다.
 */
function Spark({
  rows,
  range,
  gradientId,
  label,
  fmtValue,
}: {
  rows: { t: number; v: number }[];
  /** 세로축 범위. 솎기 전 원본 기준이어야 아래 최저·최고 값과 어긋나지 않는다. */
  range: [number, number];
  gradientId: string;
  label: string;
  fmtValue: (n: number) => string;
}) {
  if (rows.length === 0) return null;

  const [lo, hi] = range;
  const first = rows[0].t;
  const last = rows[rows.length - 1].t;

  return (
    <ResponsiveContainer width="100%" height={110}>
      <AreaChart data={rows} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={SPARK} stopOpacity={0.35} />
            <stop offset="100%" stopColor={SPARK} stopOpacity={0.03} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={[first, last]}
          ticks={[first, last]}
          tickFormatter={fmtDay}
          tick={{ fill: "#64748b", fontSize: 10 }}
          tickLine={false}
          axisLine={{ stroke: GRID }}
          height={18}
          interval="preserveStartEnd"
        />
        <YAxis
          domain={[lo, hi]}
          ticks={[lo, hi]}
          tickFormatter={fmtValue}
          tick={{ fill: "#64748b", fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          width={64}
        />
        <Tooltip
          {...tooltipStyle}
          labelFormatter={(t) => fmtDay(Number(t))}
          formatter={(v) => [fmtValue(Number(v)), label] as [string, string]}
        />
        <Area
          type="monotone"
          dataKey="v"
          stroke={SPARK}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function Fact({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ color: MUTED, fontSize: 12 }}>{label}</div>
      <div style={{ color: color ?? INK, fontSize: 15, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function Header({ title, to }: { title: string; to: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
      <span style={{ color: INK, fontSize: 15, fontWeight: 700 }}>{title}</span>
      <Link to={to} style={{ color: "#3b82f6", fontSize: 13, textDecoration: "none" }}>
        전체 보기 →
      </Link>
    </div>
  );
}

/** 응답 + 대상 id. id가 지금 보고 있는 대상과 다르면 아직 이전 요청의 결과다. */
type Fetched<T> = { id: string; data: T | null; error: string } | null;

/** 로딩·에러·본문을 한 곳에서 처리한다. 두 미리보기가 같은 껍데기를 쓴다. */
function Shell({
  state,
  children,
}: {
  state: { loading: boolean; error: string };
  children: React.ReactNode;
}) {
  if (state.loading) return <div style={box}><span style={{ color: MUTED, fontSize: 13 }}>불러오는 중…</span></div>;
  if (state.error) return <div style={box}><span style={{ color: NEGATIVE, fontSize: 13 }}>{state.error}</span></div>;
  return <div style={box}>{children}</div>;
}

export function StockPreview({ ticker }: { ticker: string }) {
  // 요청 결과에 대상 id를 함께 담아 둔다. 그래야 effect 본문에서 초기화용
  // setState를 하지 않고도 "이전 대상의 응답"을 렌더 단계에서 걸러낼 수 있다.
  const [state, setState] = useState<Fetched<StockIndicators>>(null);

  useEffect(() => {
    let cancelled = false;
    getStockIndicators(ticker)
      .then((r) => !cancelled && setState({ id: ticker, data: r.data, error: "" }))
      .catch((e: unknown) => !cancelled && setState({ id: ticker, data: null, error: errMessage(e) }));
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  const current = state?.id === ticker ? state : null;
  const data = current?.data ?? null;

  const closes = data?.series.map((p) => p.close) ?? [];
  const spark = data ? downsample(data.series, 120).map((p) => ({ t: ts(p.date), v: p.close })) : [];
  // series는 마지막 252거래일이므로 첫 점 대비가 곧 최근 1년 수익률이다.
  const first = data?.series[0]?.close;
  const last = data?.series.at(-1)?.close;
  const yearReturn = first && last ? (last / first - 1) * 100 : null;

  return (
    <Shell state={{ loading: !current, error: current?.error ?? "" }}>
      {data && (
        <>
          <Header title={data.ticker} to={`/data/${encodeURIComponent(data.ticker)}`} />
          <Spark
            rows={spark}
            range={[Math.min(...closes), Math.max(...closes)]}
            gradientId="sparkFill"
            label="종가"
            fmtValue={(n) => n.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          />
          <p style={{ color: "#64748b", fontSize: 11, margin: "6px 0 12px" }}>
            가로축 최근 {data.series.length}거래일 · 세로축 종가 최저~최고
          </p>
          <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
            <Fact label="마지막 종가" value={data.close.toLocaleString()} />
            <Fact
              label="1년 수익률"
              value={yearReturn === null ? "—" : `${yearReturn > 0 ? "+" : ""}${yearReturn.toFixed(2)}%`}
              color={yearReturn === null ? undefined : yearReturn >= 0 ? POSITIVE : NEGATIVE}
            />
            <Fact
              label="20일선 이격도"
              value={data.disparity_20 === null ? "—" : `${data.disparity_20 > 0 ? "+" : ""}${data.disparity_20.toFixed(2)}%`}
              color={data.disparity_20 === null ? undefined : data.disparity_20 >= 0 ? POSITIVE : NEGATIVE}
            />
            <Fact
              label="거래대금 5일÷60일"
              value={data.turnover_ratio_5_60 === null ? "—" : `${data.turnover_ratio_5_60.toFixed(2)}×`}
            />
            <Fact label="기준일" value={data.as_of} />
          </div>
        </>
      )}
    </Shell>
  );
}

export function MacroPreview({ seriesId }: { seriesId: string }) {
  const [state, setState] = useState<Fetched<MacroSeriesDetail>>(null);

  useEffect(() => {
    let cancelled = false;
    getMacroSeries(seriesId)
      .then((r) => !cancelled && setState({ id: seriesId, data: r.data, error: "" }))
      .catch((e: unknown) => !cancelled && setState({ id: seriesId, data: null, error: errMessage(e) }));
    return () => {
      cancelled = true;
    };
  }, [seriesId]);

  const current = state?.id === seriesId ? state : null;
  const data = current?.data ?? null;

  const spark = data ? downsample(data.data, 200).map((p) => ({ t: ts(p.date), v: p.value })) : [];

  return (
    <Shell state={{ loading: !current, error: current?.error ?? "" }}>
      {data && (
        <>
          <Header title={`${data.name} (${data.series_id})`} to={`/data/macro/${encodeURIComponent(data.series_id)}`} />
          <Spark
            rows={spark}
            range={[data.min_value, data.max_value]}
            gradientId="macroSparkFill"
            label={data.name}
            fmtValue={(n) => `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}${data.unit}`}
          />
          <p style={{ color: "#64748b", fontSize: 11, margin: "6px 0 12px" }}>
            가로축 {data.frequency === "daily" ? "일별" : "관측"} 전체 구간 · 세로축 {data.unit || "값"} 최저~최고
          </p>
          <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
            <Fact label="최신 값" value={`${data.latest_value.toLocaleString()}${data.unit}`} />
            <Fact label="최저" value={`${data.min_value.toLocaleString()}${data.unit}`} />
            <Fact label="최고" value={`${data.max_value.toLocaleString()}${data.unit}`} />
            <Fact label="관측치" value={data.count.toLocaleString()} />
          </div>
          {data.description && (
            <p style={{ color: MUTED, fontSize: 12, marginTop: 12, marginBottom: 0 }}>{data.description}</p>
          )}
        </>
      )}
    </Shell>
  );
}
