import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getIndustry } from "../api/client";
import type {
  FinancialMetricInfo,
  GroupMember,
  IndustryOverview,
  ProductGroup,
} from "../types";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { errMessage } from "../utils/error";
import { ts, axisFormatter } from "../utils/chart";
import { POSITIVE, NEGATIVE, SERIES_COLORS } from "../theme";

/**
 * 제품군별 경쟁 구도.
 *
 * 금액은 한 줄도 나란히 놓지 않는다. 삼성전자는 원, 마이크론은 달러, 키오시아는 엔으로
 * 보고하므로 매출 절대액을 같은 표에 두면 읽는 사람이 크기를 비교하게 된다. 그래서
 * 이 화면은 **비율과 증가율만** 보여준다 — 통화가 달라도 뜻이 같은 값들이다.
 *
 * 분기 마감일도 회사마다 다르다(마이크론은 8월 결산). 같은 열에 놓인 두 분기가 같은
 * 기간이 아닐 수 있어 기준일을 함께 적는다.
 */

const MUTED = "#94a3b8";
const INK = "#e2e8f0";
const SURFACE = "#1e1e2e";
const GRID = "#334155";

const pct = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
const plain = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined ? "—" : `${v.toFixed(digits)}%`;
const sign = (v: number | null | undefined) =>
  v === null || v === undefined ? INK : v >= 0 ? POSITIVE : NEGATIVE;
const shares = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${v > 0 ? "+" : ""}${Math.round(v / 10_000).toLocaleString()}만`;

function Section({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ color: INK, fontSize: 14, fontWeight: 700, marginBottom: 2 }}>{title}</div>
      <div style={{ color: "#64748b", fontSize: 12, marginBottom: 8 }}>{note}</div>
      <div style={{ overflowX: "auto" }}>{children}</div>
    </div>
  );
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr style={{ borderBottom: `1px solid ${GRID}` }}>
          {head.map((h, i) => (
            <th key={h} style={{
              color: MUTED, textAlign: i === 0 ? "left" : "right",
              padding: "8px 10px", fontWeight: 600, whiteSpace: "nowrap",
            }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function NameCell({ m }: { m: GroupMember }) {
  return (
    <td style={{ padding: "8px 10px" }}>
      <Link to={`/data/${encodeURIComponent(m.ticker)}`} style={{ color: "#3b82f6", textDecoration: "none", fontWeight: 600 }}>
        {m.name || m.ticker}
      </Link>
      <div style={{ color: "#475569", fontSize: 11 }}>{m.ticker}</div>
    </td>
  );
}

const cell = (color?: string): React.CSSProperties => ({
  color: color ?? INK, padding: "8px 10px", textAlign: "right", whiteSpace: "nowrap",
});

const tooltipStyle = {
  contentStyle: { background: "#0f172a", border: `1px solid ${GRID}` },
  labelStyle: { color: INK },
};

/**
 * 팔레트를 넘는 계열은 색이 되돌아온다. 지금은 6색이라 NAND(6종목)까지는 겹치지 않지만,
 * 그보다 많아지면 한 바퀴 돌 때마다 선 모양을 바꿔 구분한다. 색과 파선이 함께
 * 달라지므로 색을 구분하지 못해도 읽힌다.
 */
const DASHES = [undefined, "6 3", "2 3"];

function lineStyle(i: number): { stroke: string; dash: string | undefined } {
  const n = SERIES_COLORS.length;
  return { stroke: SERIES_COLORS[i % n], dash: DASHES[Math.floor(i / n) % DASHES.length] };
}

function Trend({
  rows,
  tickers,
  names,
  title,
  note,
  fmt,
  baseline,
}: {
  rows: Record<string, string | number | null>[];
  tickers: string[];
  names: Record<string, string>;
  title: string;
  note: string;
  fmt: (n: number) => string;
  baseline?: number;
}) {
  if (rows.length === 0) return null;
  const data = rows.map((r) => ({ ...r, t: ts(String(r.date)) }));
  const domain: [number, number] = [data[0].t, data[data.length - 1].t];
  // 3개월 창에 월 단위 눈금을 쓰면 "2026-06"만 반복된다. 구간 길이에 맞춰 바꾼다.
  const fmtX = axisFormatter(domain);

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ color: INK, fontSize: 14, fontWeight: 700, marginBottom: 2 }}>{title}</div>
      <div style={{ color: "#64748b", fontSize: 12, marginBottom: 8 }}>{note}</div>
      <ResponsiveContainer width="100%" height={230}>
        <LineChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
          <XAxis
            dataKey="t" type="number" scale="time" domain={domain}
            tick={{ fill: MUTED, fontSize: 11 }} tickFormatter={fmtX} minTickGap={40}
          />
          <YAxis width={60} tick={{ fill: MUTED, fontSize: 11 }} tickFormatter={(v) => fmt(Number(v))} />
          <Tooltip
            {...tooltipStyle}
            labelFormatter={(t) => fmtX(Number(t))}
            formatter={(v, name) => [fmt(Number(v)), String(name)] as [string, string]}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: MUTED }} />
          {baseline !== undefined && <ReferenceLine y={baseline} stroke={MUTED} strokeDasharray="4 4" />}
          {tickers.map((ticker, i) => {
            const { stroke, dash } = lineStyle(i);
            return (
              <Line
                key={ticker}
                type="monotone"
                dataKey={ticker}
                name={names[ticker] ?? ticker}
                stroke={stroke}
                strokeDasharray={dash}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function Group({ group, metrics, rangeLabel }: { group: ProductGroup; metrics: FinancialMetricInfo[]; rangeLabel: string }) {
  const [metric, setMetric] = useState(metrics[0]?.key ?? "operating_margin");
  const active = metrics.find((m) => m.key === metric);

  const listed = group.members.filter((m) => m.cached);
  const missing = group.members.filter((m) => !m.cached);
  const withFlow = listed.filter((m) => m.flow);
  // 범례에는 짧은 이름이 필요하다. 정식 사명은 표에서 보면 된다.
  const shortNames = Object.fromEntries(
    group.members.map((m) => [m.ticker, (m.name ?? m.ticker).split(" ").slice(0, 2).join(" ")])
  );

  return (
    <div style={{ background: SURFACE, borderRadius: 8, padding: 20, marginBottom: 24 }}>
      <h3 style={{ color: INK, margin: "0 0 4px" }}>{group.label}</h3>
      <p style={{ color: MUTED, fontSize: 13, marginBottom: 20, lineHeight: 1.6 }}>{group.note}</p>

      <Trend
        rows={group.price_series}
        tickers={listed.map((m) => m.ticker)}
        names={shortNames}
        title={`주가 추이 — ${rangeLabel} 전을 100으로 맞춤`}
        note="통화가 달라 종가는 겹칠 수 없지만, 같은 날을 100으로 두면 이후 흐름은 비교된다. 시장별 휴일은 직전 값으로 채웠다. 구간 시작에 상장돼 있지 않던 종목은 자기 첫 거래일이 기준이다."
        fmt={(n) => n.toFixed(0)}
        baseline={100}
      />

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        {metrics.map((mt) => (
          <button
            key={mt.key}
            type="button"
            onClick={() => setMetric(mt.key)}
            style={{
              background: metric === mt.key ? "#334155" : "transparent",
              color: metric === mt.key ? INK : MUTED,
              border: `1px solid ${metric === mt.key ? "#475569" : GRID}`,
              borderRadius: 999, padding: "4px 12px", fontSize: 12, cursor: "pointer",
            }}
          >
            {mt.label}
          </button>
        ))}
      </div>
      <Trend
        rows={group.financial_series?.[metric] ?? []}
        tickers={group.members.map((m) => m.ticker)}
        names={shortNames}
        title={`재무 추이 — ${active?.label ?? ""}`}
        note={`${active?.note ?? ""} 분기 기준일이 회사마다 달라, 점의 가로 위치가 각자의 결산일이다.`}
        fmt={(n) => `${n.toFixed(0)}${active?.unit ?? ""}`}
        baseline={active?.baseline ?? undefined}
      />

      <Section title="주가" note="같은 기간 수익률. 시장이 달라도 % 는 비교할 수 있다.">
        <Table head={["종목", "종가", "20일", "60일", "1년", "52주 고가 대비", "변동성(60일)"]}>
          {listed.map((m) => (
            <tr key={m.ticker} style={{ borderBottom: "1px solid #1e293b" }}>
              <NameCell m={m} />
              <td style={cell()}>{m.price?.close.toLocaleString()}</td>
              <td style={cell(sign(m.price?.return_20d))}>{pct(m.price?.return_20d)}</td>
              <td style={cell(sign(m.price?.return_60d))}>{pct(m.price?.return_60d)}</td>
              <td style={cell(sign(m.price?.return_252d))}>{pct(m.price?.return_252d, 0)}</td>
              <td style={cell(sign(m.price?.from_high_pct))}>{pct(m.price?.from_high_pct)}</td>
              <td style={cell(MUTED)}>{plain(m.price?.volatility_60d, 0)}</td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section
        title="재무"
        note="비율만 싣는다 — 원·달러·엔이 섞여 있어 금액은 비교 대상이 아니다. 결산월도 회사마다 다르므로 기준 분기를 함께 본다."
      >
        <Table head={["종목", "기준 분기", "영업이익률", "직전 대비", "매출 QoQ", "매출 YoY", "재고/매출", "영업현금/매출"]}>
          {listed.map((m) => {
            const f = m.fundamental;
            return (
              <tr key={m.ticker} style={{ borderBottom: "1px solid #1e293b" }}>
                <NameCell m={m} />
                <td style={cell(MUTED)}>{f?.period_end ?? "—"}</td>
                <td style={cell()}>{plain(f?.operating_margin)}</td>
                <td style={cell(sign(f?.operating_margin_delta))}>
                  {f?.operating_margin_delta === null || f?.operating_margin_delta === undefined
                    ? "—"
                    : `${f.operating_margin_delta > 0 ? "+" : ""}${f.operating_margin_delta.toFixed(1)}%p`}
                </td>
                <td style={cell(sign(f?.revenue_qoq))}>{pct(f?.revenue_qoq)}</td>
                <td style={cell(sign(f?.revenue_yoy))}>{pct(f?.revenue_yoy, 0)}</td>
                <td style={cell(MUTED)}>{plain(f?.inventory_to_revenue, 0)}</td>
                <td style={cell(MUTED)}>{plain(f?.ocf_to_revenue, 0)}</td>
              </tr>
            );
          })}
        </Table>
      </Section>

      {withFlow.length > 0 && (
        <Section title="수급 (20일 누적)" note="한국거래소가 공개하는 자료라 국내 종목에만 있다. 단위는 주식 수.">
          <Table head={["종목", "외국인", "기관", "개인"]}>
            {withFlow.map((m) => (
              <tr key={m.ticker} style={{ borderBottom: "1px solid #1e293b" }}>
                <NameCell m={m} />
                <td style={cell(sign(m.flow?.frgn_ntby_20d))}>{shares(m.flow?.frgn_ntby_20d)}</td>
                <td style={cell(sign(m.flow?.orgn_ntby_20d))}>{shares(m.flow?.orgn_ntby_20d)}</td>
                <td style={cell(sign(m.flow?.prsn_ntby_20d))}>{shares(m.flow?.prsn_ntby_20d)}</td>
              </tr>
            ))}
          </Table>
        </Section>
      )}

      {/* 목표주가와 투자의견은 일부러 뺐다. 예측이자 의견이라 객관적 수치 옆에 두면
          같은 성격으로 읽힌다. 스냅샷에는 그대로 쌓이고 있어 "기대가 변했나"를 볼 때
          꺼내 쓰면 된다. 시가총액도 뺐다 — 통화가 섞여 비교되지 않는다. */}
      <Section title="밸류에이션" note="주가를 이익·자본으로 나눈 값이라 통화와 무관하게 비교된다.">
        <Table head={["종목", "PER", "PBR"]}>
          {listed.map((m) => {
            const s = m.snapshot;
            return (
              <tr key={m.ticker} style={{ borderBottom: "1px solid #1e293b" }}>
                <NameCell m={m} />
                <td style={cell()}>{s?.per ? s.per.toFixed(1) : "—"}</td>
                <td style={cell()}>{s?.pbr ? s.pbr.toFixed(2) : "—"}</td>
              </tr>
            );
          })}
        </Table>
      </Section>

      {(missing.length > 0 || group.unlisted.length > 0) && (
        <p style={{ color: "#64748b", fontSize: 12, borderTop: `1px solid ${GRID}`, paddingTop: 12, margin: 0 }}>
          {missing.length > 0 && <>시세 없음: {missing.map((m) => m.ticker).join(", ")} · </>}
          {group.unlisted.length > 0 && <>비상장이라 추적 불가: {group.unlisted.join(", ")}</>}
        </p>
      )}
    </div>
  );
}

export default function IndustryDetail() {
  // 제품군을 경로에 둔다. 탭 상태를 컴포넌트 안에만 두면 링크로 공유할 수 없다.
  const { key = "", group: groupKey } = useParams();
  // 구간은 주가 차트에만 적용된다. 표의 수익률 칸(20일·60일·1년)은 고정이다.
  const [range, setRange] = useState("1y");
  // 응답에 요청 조건을 함께 담아, effect 본문에서 초기화용 setState를 하지 않고도
  // 이전 요청의 결과를 렌더 단계에서 걸러낸다.
  const [state, setState] = useState<{ key: string; data: IndustryOverview | null; error: string } | null>(null);
  const requestKey = `${key}|${range}`;

  useEffect(() => {
    let cancelled = false;
    getIndustry(key, range)
      .then((r) => !cancelled && setState({ key: requestKey, data: r.data, error: "" }))
      .catch((e) => !cancelled && setState({ key: requestKey, data: null, error: errMessage(e) }));
    return () => {
      cancelled = true;
    };
  }, [key, range, requestKey]);

  const current = state?.key === requestKey ? state : null;
  const data = current?.data ?? null;
  const error = current?.error ?? "";

  if (error) {
    return (
      <div>
        <Link to="/industry" style={{ color: "#3b82f6", fontSize: 14 }}>← Industry</Link>
        <p style={{ color: NEGATIVE, marginTop: 16 }}>{error}</p>
      </div>
    );
  }
  if (!data) return <p style={{ color: MUTED }}>불러오는 중…</p>;

  // 경로에 제품군이 없거나 알 수 없는 값이면 첫 번째를 보여준다.
  const selected = data.groups.find((g) => g.key === groupKey) ?? data.groups[0];
  if (!selected) return <p style={{ color: MUTED }}>표시할 제품군이 없습니다.</p>;

  return (
    <div>
      <Link to="/industry" style={{ color: "#3b82f6", fontSize: 14 }}>← Industry</Link>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ color: INK, margin: "12px 0 4px" }}>{data.label} 현황</h2>
        <div style={{ display: "flex", gap: 4 }}>
          {data.ranges.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRange(r.key)}
              aria-pressed={range === r.key}
              style={{
                background: range === r.key ? "#334155" : "transparent",
                color: range === r.key ? INK : MUTED,
                border: `1px solid ${GRID}`,
                borderRadius: 6,
                padding: "4px 12px",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <p style={{ color: MUTED, fontSize: 14, marginBottom: 24 }}>
        {data.note} 제품군 구분은 공개 데이터에 없어 직접 관리하는 표다.
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
        {data.groups.map((g) => {
          const on = g.key === selected.key;
          return (
            <Link
              key={g.key}
              to={`/industry/${key}/${g.key}`}
              style={{
                background: on ? "#334155" : "transparent",
                color: on ? INK : MUTED,
                border: `1px solid ${on ? "#475569" : GRID}`,
                borderRadius: 6, padding: "8px 18px", fontSize: 14,
                fontWeight: on ? 700 : 500, textDecoration: "none",
              }}
            >
              {g.label}
              <span style={{ color: "#64748b", fontSize: 12, marginLeft: 6 }}>
                {g.members.filter((m) => m.cached).length}
              </span>
            </Link>
          );
        })}
      </div>

      <Group key={selected.key} group={selected} metrics={data.metrics}
             rangeLabel={data.ranges.find((r) => r.key === data.chart_range)?.label ?? ""} />
    </div>
  );
}
