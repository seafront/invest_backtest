import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import CandlestickChart from "../components/CandlestickChart";
import IndicatorPanel from "../components/IndicatorPanel";
import InvestorFlowPanel from "../components/InvestorFlowPanel";
import MacroStack from "../components/MacroStack";
import { getStockData, getStockStats } from "../api/client";
import { errMessage } from "../utils/error";
import type { StockData, StockStats, YearlyReturn } from "../types";
import { downsample, ts, fmtMonth, evenTicks } from "../utils/chart";
import { POSITIVE, NEGATIVE } from "../theme";

// 상승/하락 대비색. CVD 검증 통과 조합 (deutan ΔE 8.1). 부호는 색 외에
// 0선 기준 막대 방향으로도 인코딩되므로 색만으로 구분하지 않는다.
const UP = POSITIVE;
const DOWN = NEGATIVE;
const MUTED = "#94a3b8";
const INK = "#e2e8f0";
const SURFACE = "#1e1e2e";
const GRID = "#334155";

const card: React.CSSProperties = {
  background: SURFACE,
  borderRadius: 8,
  padding: 16,
  marginBottom: 24,
};

const tooltipStyle = {
  contentStyle: { background: "#0f172a", border: `1px solid ${GRID}` },
  labelStyle: { color: INK },
};

function Tile({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background: SURFACE, borderRadius: 8, padding: "16px 24px", minWidth: 140, flex: 1 }}>
      <div style={{ color: MUTED, fontSize: 13, marginBottom: 4 }}>{label}</div>
      <div style={{ color: color ?? INK, fontSize: 22, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

interface Loaded {
  ticker: string;
  stats: StockStats | null;
  ohlcv: StockData[];
  error: string;
}

export default function StockDetail() {
  const { ticker = "" } = useParams();
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  // loading을 state로 두면 effect 본문에서 동기 setState를 해야 하므로 파생값으로 계산한다.
  const loading = loaded?.ticker !== ticker;

  useEffect(() => {
    let cancelled = false;
    Promise.all([getStockStats(ticker), getStockData(ticker)])
      .then(([s, d]) => {
        if (!cancelled) setLoaded({ ticker, stats: s.data, ohlcv: d.data, error: "" });
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoaded({ ticker, stats: null, ohlcv: [], error: errMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  const stats = loaded?.stats ?? null;
  const ohlcv = loaded?.ohlcv ?? [];
  const error = loaded?.error ?? "";

  if (loading) return <p style={{ color: MUTED }}>Loading {ticker}…</p>;
  if (error)
    return (
      <div>
        <Link to="/data" style={{ color: "#3b82f6", fontSize: 14 }}>← Data</Link>
        <p style={{ color: DOWN, marginTop: 16 }}>Error: {error}</p>
      </div>
    );
  if (!stats) return null;

  const sign = (v: number) => (v >= 0 ? UP : DOWN);

  // 두 차트가 같은 시간 도메인을 공유해야 x축이 정확히 맞는다.
  const tDomain: [number, number] = [ts(stats.start_date), ts(stats.end_date)];
  const ddData = downsample(stats.drawdown_curve).map((d) => ({
    t: ts(d.date),
    drawdown: d.drawdown,
  }));

  return (
    <div>
      <Link to="/data" style={{ color: "#3b82f6", fontSize: 14 }}>← Data</Link>

      <h2 style={{ color: INK, margin: "12px 0 4px" }}>{stats.ticker}</h2>
      <p style={{ color: MUTED, fontSize: 14, marginBottom: 20 }}>
        {stats.start_date} ~ {stats.end_date} · {stats.years}년 · 거래일{" "}
        {stats.trading_days.toLocaleString()}일 · 전략 없이 데이터 자체만 본 결과
      </p>

      {/* 요약 지표 */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
        <Tile label="Total Return" value={`${stats.total_return.toFixed(2)}%`} color={sign(stats.total_return)} />
        <Tile label="CAGR" value={`${stats.cagr.toFixed(2)}%`} color={sign(stats.cagr)} />
        <Tile label="Volatility (ann.)" value={`${stats.annual_volatility.toFixed(2)}%`} />
        <Tile label="Max Drawdown" value={`-${stats.max_drawdown.toFixed(2)}%`} color={DOWN} />
        <Tile label="Sharpe" value={stats.sharpe_ratio.toFixed(3)} />
        <Tile label="Up Days" value={`${stats.positive_day_pct.toFixed(1)}%`} />
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
        <Tile label="Best Day" value={`+${stats.best_day.change}% · ${stats.best_day.date}`} color={UP} />
        <Tile label="Worst Day" value={`${stats.worst_day.change}% · ${stats.worst_day.date}`} color={DOWN} />
        <Tile label="First / Last Close" value={`${stats.first_close.toLocaleString()} → ${stats.last_close.toLocaleString()}`} />
      </div>

      {/* 가격 — CandlestickChart가 자체 카드와 제목을 그리므로 감싸지 않는다 */}
      <CandlestickChart data={ohlcv} />

      {/* 파생 지표 — OHLCV에서 계산, 저장하지 않는다. 구간 선택은 패널이 직접 관리한다 */}
      <IndicatorPanel ticker={ticker} />

      {/* 투자자 매매동향 — 한국 종목에만 데이터가 있어 그 외에는 스스로 사라진다 */}
      <InvestorFlowPanel ticker={ticker} />

      {/* 낙폭 */}
      <div style={card}>
        <h3 style={{ color: INK, marginBottom: 4 }}>Drawdown — 전고점 대비 하락률</h3>
        <p style={{ color: MUTED, fontSize: 13, marginBottom: 12 }}>
          골이 깊고 넓을수록 회복에 오래 걸렸다는 뜻이다.
        </p>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={ddData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="ddFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={DOWN} stopOpacity={0.15} />
                <stop offset="100%" stopColor={DOWN} stopOpacity={0.5} />
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
              tickFormatter={fmtMonth}
              minTickGap={20}
            />
            <YAxis width={56} tick={{ fill: MUTED, fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
            <Tooltip
              {...tooltipStyle}
              labelFormatter={(t) => fmtMonth(Number(t))}
              formatter={(v) => [`${Number(v).toFixed(2)}%`, "Drawdown"] as [string, string]}
            />
            <Area type="monotone"
              isAnimationActive={false} dataKey="drawdown" stroke={DOWN} strokeWidth={2} fill="url(#ddFill)" dot={false} />
          </AreaChart>
        </ResponsiveContainer>

        {/* 거시 지표 — 낙폭과 같은 x축을 쓰는 칸을 아래에 쌓는다.
            한 축에 겹치지 않는 이유는 범위가 제각각이기 때문이다. 낙폭(0~-57%)과
            실업률(2.5~14.8%)을 한 축에 두면 이중 축이 필요해지고, 이중 축은
            두 계열의 교차점을 임의로 만들어 왜곡한다. */}
        <div style={{ borderTop: `1px solid ${GRID}`, marginTop: 16, paddingTop: 16 }}>
          <MacroStack
            startDate={stats.start_date}
            endDate={stats.end_date}
            tDomain={tDomain}
            fmtX={fmtMonth}
          />
        </div>
      </div>

      {/* 연도별 수익률 */}
      <div style={card}>
        <h3 style={{ color: INK, marginBottom: 4 }}>Yearly Returns</h3>
        <p style={{ color: MUTED, fontSize: 13, marginBottom: 12 }}>
          <span style={{ color: UP }}>■</span> 상승 &nbsp;
          <span style={{ color: DOWN }}>■</span> 하락 &nbsp;· 0선 위/아래 방향으로도 구분된다.
          {stats.yearly_returns.some((y) => y.partial) && " 빗금 연도는 아직 진행 중이다."}
        </p>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={stats.yearly_returns} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barCategoryGap="18%">
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
            <XAxis dataKey="year" tick={{ fill: MUTED, fontSize: 11 }} minTickGap={8} />
            <YAxis tick={{ fill: MUTED, fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
            <Tooltip
              {...tooltipStyle}
              cursor={{ fill: "#ffffff10" }}
              formatter={(v, _name, item) => {
                const n = Number(v);
                const partial = (item?.payload as YearlyReturn | undefined)?.partial;
                return [
                  `${n > 0 ? "+" : ""}${n.toFixed(2)}%${partial ? " (진행 중)" : ""}`,
                  "Return",
                ] as [string, string];
              }}
            />
            <ReferenceLine y={0} stroke={MUTED} strokeWidth={1} />
            <Bar dataKey="return_pct" isAnimationActive={false} radius={[4, 4, 0, 0]}>
              {stats.yearly_returns.map((y) => (
                <Cell
                  key={y.year}
                  fill={sign(y.return_pct)}
                  fillOpacity={y.partial ? 0.45 : 1}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* 약세장 */}
      <div style={{ ...card, padding: 24 }}>
        <h3 style={{ color: INK, marginBottom: 4 }}>Bear Markets — 고점 대비 -20% 이상</h3>
        <p style={{ color: MUTED, fontSize: 13, marginBottom: 12 }}>
          저점 이후 3·6·12개월 수익률을 함께 보면 반등의 속도를 알 수 있다.
        </p>
        {stats.bear_markets.length === 0 ? (
          <p style={{ color: "#64748b" }}>이 구간에는 -20% 이상 하락이 없었다.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${GRID}` }}>
                {["고점", "저점", "하락률", "하락기간", "+3M", "+6M", "+12M", "회복"].map((h) => (
                  <th key={h} style={{ color: MUTED, textAlign: "left", padding: "8px 12px", fontWeight: 600 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stats.bear_markets.map((b) => (
                <tr key={b.trough_date} style={{ borderBottom: "1px solid #1e293b" }}>
                  <td style={{ color: INK, padding: "8px 12px" }}>{b.peak_date}</td>
                  <td style={{ color: INK, padding: "8px 12px" }}>{b.trough_date}</td>
                  <td style={{ color: DOWN, padding: "8px 12px", fontWeight: 600 }}>{b.decline_pct}%</td>
                  <td style={{ color: MUTED, padding: "8px 12px" }}>
                    {(b.decline_days / 365.25).toFixed(1)}년
                  </td>
                  {[b.return_3m, b.return_6m, b.return_12m].map((v, i) => (
                    <td key={i} style={{ color: v === null ? "#64748b" : sign(v), padding: "8px 12px" }}>
                      {v === null ? "—" : `${v > 0 ? "+" : ""}${v}%`}
                    </td>
                  ))}
                  <td style={{ color: MUTED, padding: "8px 12px" }}>
                    {b.recovery_days === null ? "미회복" : `${(b.recovery_days / 365.25).toFixed(1)}년`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
