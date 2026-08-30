import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getFundamentals, syncFundamentals } from "../api/client";
import type { FundamentalPoint, FundamentalSeries } from "../types";
import { POSITIVE, NEGATIVE, SERIES_COLORS } from "../theme";

/**
 * 분기 재무.
 *
 * 매출만 보면 "매출은 느는데 이익이 줄어드는" 구간을 놓친다. 그래서 마진을 함께 낸다.
 * 절대 금액은 통화가 시장마다 다르므로(삼성전자는 원, 애플은 달러) 자릿수만 줄여
 * 보여주고, 비교는 증가율과 비율로 한다.
 *
 * yfinance가 최근 5개 분기만 주므로 장기 추세는 알 수 없다. 이 패널이 답하는 것은
 * "최근 이익의 방향과 질"까지다.
 */

const MUTED = "#94a3b8";
const INK = "#e2e8f0";
const SURFACE = "#1e1e2e";
const GRID = "#334155";

/** 조·억 단위로 접는다. 통화 기호는 붙이지 않는다 — 시장마다 다르다. */
function compact(v: number | null): string {
  if (v === null) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${(v / 1e12).toFixed(1)}조`;
  if (abs >= 1e8) return `${(v / 1e8).toFixed(0)}억`;
  if (abs >= 1e4) return `${(v / 1e4).toFixed(0)}만`;
  return v.toFixed(0);
}

const margin = (num: number | null, den: number | null) =>
  num !== null && den ? (num / den) * 100 : null;

const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);

/** 직전 분기 대비 변화. 개선이면 초록, 악화면 빨강. */
function delta(rows: FundamentalPoint[], pick: (r: FundamentalPoint) => number | null) {
  if (rows.length < 2) return null;
  const now = pick(rows[rows.length - 1]);
  const prev = pick(rows[rows.length - 2]);
  return now !== null && prev !== null ? now - prev : null;
}

const tooltipStyle = {
  contentStyle: { background: "#0f172a", border: `1px solid ${GRID}` },
  labelStyle: { color: INK },
};

/**
 * 매출·영업이익은 막대, 영업이익률은 선으로 칸을 나눠 그린다.
 *
 * 한 축에 겹치면 이중 축이 필요한데, 이중 축은 두 계열의 교차점을 임의로 만들어
 * 없는 관계를 있는 것처럼 보이게 한다. 칸을 나누면 x가 같으므로 세로로 읽으면 된다.
 * 분기가 5개뿐이라 선보다 막대가 낫다 — 점 다섯 개를 잇는 선은 추세로 읽히지 않는다.
 */
function Charts({ rows }: { rows: FundamentalPoint[] }) {
  const data = rows.map((r) => ({
    q: r.period_end.slice(2, 7),                       // 26-03
    revenue: r.revenue,
    operating: r.operating_income,
    margin: margin(r.operating_income, r.revenue),
  }));

  const axis = { tick: { fill: MUTED, fontSize: 11 }, tickLine: false };

  return (
    <>
      <div style={{ color: MUTED, fontSize: 12, marginTop: 6 }}>
        매출과 영업이익 — <span style={{ color: SERIES_COLORS[2] }}>■</span> 매출{" "}
        <span style={{ color: SERIES_COLORS[0] }}>■</span> 영업이익
      </div>
      <ResponsiveContainer width="100%" height={150}>
        <BarChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }} barGap={2}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
          <XAxis dataKey="q" {...axis} />
          <YAxis width={56} {...axis} tickFormatter={(v) => compact(Number(v))} />
          <Tooltip
            {...tooltipStyle}
            cursor={{ fill: "#ffffff10" }}
            formatter={(v, name) => [compact(Number(v)), String(name)] as [string, string]}
          />
          <Bar dataKey="revenue" name="매출" fill={SERIES_COLORS[2]} isAnimationActive={false} radius={[3, 3, 0, 0]} />
          <Bar dataKey="operating" name="영업이익" isAnimationActive={false} radius={[3, 3, 0, 0]}>
            {data.map((d) => (
              // 영업손실이면 색이 뒤집힌다. 0선 아래로 내려가는 것과 중복 표현이다.
              <Cell key={d.q} fill={(d.operating ?? 0) >= 0 ? SERIES_COLORS[0] : NEGATIVE} />
            ))}
          </Bar>
          <ReferenceLine y={0} stroke={MUTED} />
        </BarChart>
      </ResponsiveContainer>

      <div style={{ color: MUTED, fontSize: 12, marginTop: 10 }}>
        영업이익률 — 위 막대에서 나온 비율. 방향이 이익의 질이다
      </div>
      <ResponsiveContainer width="100%" height={130}>
        <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
          <XAxis dataKey="q" {...axis} />
          <YAxis width={56} {...axis} tickFormatter={(v) => `${Number(v).toFixed(0)}%`} />
          <Tooltip
            {...tooltipStyle}
            formatter={(v) => [`${Number(v).toFixed(1)}%`, "영업이익률"] as [string, string]}
          />
          <ReferenceLine y={0} stroke={MUTED} />
          <Line
            type="monotone"
            dataKey="margin"
            stroke={SERIES_COLORS[1]}
            strokeWidth={2}
            dot={{ r: 3, fill: SERIES_COLORS[1] }}
            isAnimationActive={false}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </>
  );
}

export default function FundamentalPanel({ ticker }: { ticker: string }) {
  const [state, setState] = useState<{ ticker: string; data: FundamentalSeries | null } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getFundamentals(ticker)
      .then((r) => !cancelled && setState({ ticker, data: r.data }))
      .catch(() => !cancelled && setState({ ticker, data: null }));
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  const series = state?.ticker === ticker ? state.data : null;
  if (!series) return null;

  const handleSync = async () => {
    setSyncing(true);
    setError("");
    try {
      const { data } = await syncFundamentals(ticker);
      setState({ ticker, data });
    } catch {
      setError("재무 데이터를 받지 못했습니다.");
    } finally {
      setSyncing(false);
    }
  };

  const rows = series.data;
  const opMarginDelta = delta(rows, (r) => margin(r.operating_income, r.revenue));

  return (
    <div style={{ background: SURFACE, borderRadius: 8, padding: 16, marginBottom: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ color: INK, margin: "0 0 4px" }}>분기 재무 — 이익이 늘고 있나</h3>
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          style={{
            background: "transparent", color: syncing ? "#64748b" : "#94a3b8",
            border: `1px solid ${GRID}`, borderRadius: 6, padding: "6px 14px",
            fontSize: 12, cursor: syncing ? "default" : "pointer",
          }}
        >
          {syncing ? "받는 중…" : rows.length ? "다시 받기" : "재무 받기"}
        </button>
      </div>
      <p style={{ color: MUTED, fontSize: 13, marginBottom: 16 }}>
        yfinance가 최근 5개 분기를 준다. 금액 단위는 상장 시장의 통화라 시장 간 비교는
        증가율·비율로만 한다.
        {opMarginDelta !== null && (
          <>
            {" "}직전 분기 대비 영업이익률{" "}
            <span style={{ color: opMarginDelta >= 0 ? POSITIVE : NEGATIVE, fontWeight: 700 }}>
              {opMarginDelta >= 0 ? "+" : ""}{opMarginDelta.toFixed(1)}%p
            </span>
          </>
        )}
      </p>

      {error && <p style={{ color: NEGATIVE, fontSize: 13 }}>{error}</p>}

      {rows.length === 0 ? (
        <p style={{ color: "#64748b", fontSize: 13 }}>
          아직 받지 않았다. 「재무 받기」를 누르면 약 2초 걸린다.
        </p>
      ) : (
        <>
        <Charts rows={rows} />
        <div style={{ overflowX: "auto", marginTop: 16 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${GRID}` }}>
                <th style={{ color: MUTED, textAlign: "left", padding: "8px 10px", fontWeight: 600 }}>항목</th>
                {rows.map((r) => (
                  <th key={r.period_end} style={{ color: MUTED, textAlign: "right", padding: "8px 10px", fontWeight: 600 }}>
                    {r.period_end.slice(0, 7)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { label: "매출", get: (r: FundamentalPoint) => compact(r.revenue) },
                { label: "영업이익", get: (r: FundamentalPoint) => compact(r.operating_income) },
                { label: "순이익", get: (r: FundamentalPoint) => compact(r.net_income) },
                { label: "영업이익률", get: (r: FundamentalPoint) => pct(margin(r.operating_income, r.revenue)) },
                { label: "매출총이익률", get: (r: FundamentalPoint) => pct(margin(r.gross_profit, r.revenue)) },
                { label: "재고자산", get: (r: FundamentalPoint) => compact(r.inventory) },
                { label: "영업활동현금흐름", get: (r: FundamentalPoint) => compact(r.operating_cashflow) },
                { label: "부채비율", get: (r: FundamentalPoint) => pct(margin(r.total_debt, r.equity)) },
              ].map((row) => (
                <tr key={row.label} style={{ borderBottom: "1px solid #1e293b" }}>
                  <td style={{ color: MUTED, padding: "8px 10px", whiteSpace: "nowrap" }}>{row.label}</td>
                  {rows.map((r) => (
                    <td key={r.period_end} style={{ color: INK, padding: "8px 10px", textAlign: "right" }}>
                      {row.get(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}
