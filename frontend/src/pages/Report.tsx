import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getReport, listPeriods, listUniverses } from "../api/client";
import type { PeriodInfo, ReportResponse, ReportRow, SectorRow, UniverseInfo } from "../types";
import { errMessage } from "../utils/error";
import { POSITIVE, NEGATIVE } from "../theme";

/**
 * 코스피 200 주기별 리포트.
 *
 * 네 주기가 같은 항목을 본다. 다른 것은 창의 길이뿐이고, 그래서 비교가 된다 —
 * 오늘 146종목이 올랐는데 분기로 넓히면 상승이 71종목뿐인 식으로 창마다 답이 갈리고,
 * 그 차이 자체가 국면을 알려 준다. 한 창만 보면 시장을 반대로 읽는다.
 */

const MUTED = "#94a3b8";
const INK = "#e2e8f0";
const SURFACE = "#1e1e2e";
const GRID = "#334155";

const pct = (v: number | null, digits = 1) =>
  v === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
const sign = (v: number | null) => (v === null ? INK : v >= 0 ? POSITIVE : NEGATIVE);
const shares = (v: number | null) =>
  v === null ? "—" : `${v > 0 ? "+" : ""}${Math.round(v / 10_000).toLocaleString()}만`;

const card: React.CSSProperties = { background: SURFACE, borderRadius: 8, padding: 20, marginBottom: 20 };

function Tile({ label, value, color, note }: { label: string; value: string; color?: string; note?: string }) {
  return (
    <div style={{ background: "#0f172a", borderRadius: 8, padding: "14px 18px", minWidth: 150, flex: 1 }}>
      <div style={{ color: MUTED, fontSize: 12, marginBottom: 4 }}>{label}</div>
      <div style={{ color: color ?? INK, fontSize: 20, fontWeight: 700 }}>{value}</div>
      {note && <div style={{ color: "#64748b", fontSize: 11, marginTop: 2 }}>{note}</div>}
    </div>
  );
}

function StockTable({ rows, columns }: { rows: ReportRow[]; columns: ("return" | "turnover" | "flow")[] }) {
  if (rows.length === 0) return <p style={{ color: "#64748b", fontSize: 13 }}>해당 종목이 없다.</p>;
  const head = ["종목", "업종"];
  if (columns.includes("return")) head.push("수익률");
  if (columns.includes("turnover")) head.push("거래대금 배율");
  if (columns.includes("flow")) head.push("외국인", "기관");

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr style={{ borderBottom: `1px solid ${GRID}` }}>
          {head.map((h, i) => (
            <th key={h} style={{
              color: MUTED, textAlign: i === 0 || i === 1 ? "left" : "right",
              padding: "7px 10px", fontWeight: 600, whiteSpace: "nowrap",
            }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.ticker} style={{ borderBottom: "1px solid #1e293b" }}>
            <td style={{ padding: "7px 10px" }}>
              <Link to={`/data/${encodeURIComponent(r.ticker)}`} style={{ color: "#3b82f6", textDecoration: "none", fontWeight: 600 }}>
                {r.name || r.ticker}
              </Link>
            </td>
            <td style={{
              color: MUTED, padding: "7px 10px", maxWidth: 180,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {r.industry ?? "—"}
            </td>
            {columns.includes("return") && (
              <td style={{ color: sign(r.return_pct), padding: "7px 10px", textAlign: "right" }}>
                {pct(r.return_pct)}
              </td>
            )}
            {columns.includes("turnover") && (
              <td style={{ color: INK, padding: "7px 10px", textAlign: "right" }}>
                {r.turnover_ratio === null ? "—" : `${r.turnover_ratio.toFixed(2)}×`}
              </td>
            )}
            {columns.includes("flow") && (
              <>
                <td style={{ color: sign(r.frgn_ntby_qty), padding: "7px 10px", textAlign: "right" }}>
                  {shares(r.frgn_ntby_qty)}
                </td>
                <td style={{ color: sign(r.orgn_ntby_qty), padding: "7px 10px", textAlign: "right" }}>
                  {shares(r.orgn_ntby_qty)}
                </td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Sectors({ rows }: { rows: SectorRow[] }) {
  const top = rows.slice(0, 8);
  const bottom = rows.slice(-8).reverse();
  const render = (list: SectorRow[]) => (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr style={{ borderBottom: `1px solid ${GRID}` }}>
          {["업종", "종목", "중앙값", "직전 구간", "상승", "외국인"].map((h, i) => (
            <th key={h} style={{
              color: MUTED, textAlign: i === 0 ? "left" : "right",
              padding: "7px 10px", fontWeight: 600, whiteSpace: "nowrap",
            }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {list.map((s) => (
          <tr key={s.industry} style={{ borderBottom: "1px solid #1e293b" }}>
            <td style={{ color: INK, padding: "7px 10px", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {s.industry}
            </td>
            <td style={{ color: MUTED, padding: "7px 10px", textAlign: "right" }}>{s.count}</td>
            <td style={{ color: sign(s.median_return), padding: "7px 10px", textAlign: "right", fontWeight: 600 }}>
              {pct(s.median_return)}
            </td>
            <td style={{ color: MUTED, padding: "7px 10px", textAlign: "right" }}>{pct(s.prev_median_return)}</td>
            <td style={{ color: MUTED, padding: "7px 10px", textAlign: "right" }}>{s.advancing}/{s.count}</td>
            <td style={{ color: sign(s.frgn_ntby), padding: "7px 10px", textAlign: "right" }}>{shares(s.frgn_ntby)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <>
      <div style={{ color: MUTED, fontSize: 12, marginBottom: 6 }}>자금이 몰린 업종</div>
      {render(top)}
      <div style={{ color: MUTED, fontSize: 12, margin: "20px 0 6px" }}>밀린 업종</div>
      {render(bottom)}
    </>
  );
}

export default function Report() {
  const { universe: universeKey, period: periodKey } = useParams();
  const [periods, setPeriods] = useState<PeriodInfo[]>([]);
  const [universes, setUniverses] = useState<UniverseInfo[]>([]);
  const [state, setState] = useState<{ key: string; data: ReportResponse | null; error: string } | null>(null);

  const period = periodKey || "daily";
  const universe = universeKey || "kospi200";
  const key = `${universe}/${period}`;

  useEffect(() => {
    listPeriods().then((r) => setPeriods(r.data)).catch(() => setPeriods([]));
    listUniverses().then((r) => setUniverses(r.data)).catch(() => setUniverses([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    getReport(period, universe)
      .then((r) => !cancelled && setState({ key, data: r.data, error: "" }))
      .catch((e) => !cancelled && setState({ key, data: null, error: errMessage(e) }));
    return () => {
      cancelled = true;
    };
  }, [key, period, universe]);

  const current = state?.key === key ? state : null;
  const data = current?.data ?? null;

  const universeTabs = (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
      {universes.map((u) => {
        const on = u.key === universe;
        return (
          <Link
            key={u.key}
            to={`/report/${u.key}/${period}`}
            style={{
              background: on ? "#3b82f6" : "transparent",
              color: on ? "#fff" : MUTED,
              border: `1px solid ${on ? "#3b82f6" : GRID}`,
              borderRadius: 6, padding: "8px 18px", fontSize: 14,
              fontWeight: on ? 700 : 500, textDecoration: "none",
            }}
          >
            {u.label}
          </Link>
        );
      })}
    </div>
  );

  const tabs = (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
      {periods.map((p) => {
        const on = p.key === period;
        return (
          <Link
            key={p.key}
            to={`/report/${universe}/${p.key}`}
            style={{
              background: on ? "#334155" : "transparent",
              color: on ? INK : MUTED,
              border: `1px solid ${on ? "#475569" : GRID}`,
              borderRadius: 6, padding: "8px 18px", fontSize: 14,
              fontWeight: on ? 700 : 500, textDecoration: "none",
            }}
          >
            {p.label}
            <span style={{ color: "#64748b", fontSize: 12, marginLeft: 6 }}>{p.days}일</span>
          </Link>
        );
      })}
    </div>
  );

  return (
    <div>
      <h2 style={{ color: INK, marginBottom: 4 }}>
        {universes.find((u) => u.key === universe)?.label ?? universe} 리포트
      </h2>
      <p style={{ color: MUTED, fontSize: 14, marginBottom: 16 }}>
        네 주기가 같은 항목을 본다. 다른 것은 창의 길이뿐이라, 주기마다 답이 갈리면 그 차이가 국면을 알려 준다.
        {universe !== "kospi200" && " 수급은 한국거래소만 공개하므로 국내 지수에만 나온다."}
      </p>
      {universeTabs}
      {tabs}

      {current?.error && <p style={{ color: NEGATIVE, fontSize: 13 }}>{current.error}</p>}
      {!data && !current?.error && <p style={{ color: MUTED }}>불러오는 중…</p>}

      {data && (
        <>
          <div style={card}>
            <h3 style={{ color: INK, margin: "0 0 4px" }}>
              {data.label} 시장 폭 — {data.base_date} → {data.as_of}
            </h3>
            <p style={{ color: MUTED, fontSize: 13, marginBottom: 16 }}>
              {data.note}. 지수가 아니라 구성종목 {data.breadth.total}개를 세어 본 결과다.
            </p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
              <Tile
                label="상승 / 하락"
                value={`${data.breadth.advancing} / ${data.breadth.declining}`}
                color={data.breadth.advancing >= data.breadth.declining ? POSITIVE : NEGATIVE}
                note={`보합 ${data.breadth.unchanged}`}
              />
              <Tile
                label="수익률 중앙값"
                value={pct(data.breadth.median_return, 2)}
                color={sign(data.breadth.median_return)}
              />
              <Tile
                label="20일선 위"
                value={`${data.breadth.above_ma20_pct.toFixed(0)}%`}
                note={`${data.breadth.above_ma20} / ${data.breadth.total}종목`}
              />
              <Tile label="52주 신고가" value={`${data.breadth.new_high_52w}종목`} note={`신저가 ${data.breadth.new_low_52w}`} />
              <Tile
                label="고점 대비 (중앙값)"
                value={pct(data.drawdown.median)}
                color={sign(data.drawdown.median)}
                note={`-20% 이하 ${data.drawdown.below_20pct}종목`}
              />
            </div>
          </div>

          {data.flows.available && (
            <div style={card}>
              <h3 style={{ color: INK, margin: "0 0 4px" }}>수급 — {data.flows.days}거래일 누적</h3>
              <p style={{ color: MUTED, fontSize: 13, marginBottom: 16 }}>
                외국인과 기관이 <strong style={{ color: INK }}>동시에</strong> 순매수한 종목{" "}
                <strong style={{ color: POSITIVE }}>{data.flows.both_buy_count}개</strong>. 단위는 주식 수.
              </p>
              <div style={{ color: MUTED, fontSize: 12, marginBottom: 6 }}>외국인·기관 동시 순매수</div>
              <StockTable rows={data.flows.both_buy} columns={["flow", "return"]} />
              <div style={{ color: MUTED, fontSize: 12, margin: "20px 0 6px" }}>외국인 순매도 상위</div>
              <StockTable rows={data.flows.bottom_foreign} columns={["flow", "return"]} />
            </div>
          )}

          <div style={card}>
            <h3 style={{ color: INK, margin: "0 0 4px" }}>업종</h3>
            <p style={{ color: MUTED, fontSize: 13, marginBottom: 16 }}>
              {universe === "kospi200" ? "KRX 업종" : "GICS 섹터"} 기준. 직전 구간과 나란히 두면 자금이 옮겨간 방향이 보인다. 종목이 2개 미만인 업종은 뺐다.
            </p>
            <Sectors rows={data.sectors} />
          </div>

          <div style={card}>
            <h3 style={{ color: INK, margin: "0 0 4px" }}>등락 상·하위</h3>
            <p style={{ color: MUTED, fontSize: 13, marginBottom: 16 }}>{data.note} 기준.</p>
            <div style={{ color: MUTED, fontSize: 12, marginBottom: 6 }}>상승</div>
            <StockTable rows={data.movers.top} columns={["return"]} />
            <div style={{ color: MUTED, fontSize: 12, margin: "20px 0 6px" }}>하락</div>
            <StockTable rows={data.movers.bottom} columns={["return"]} />
          </div>

          <div style={card}>
            <h3 style={{ color: INK, margin: "0 0 4px" }}>거래대금 급증</h3>
            <p style={{ color: MUTED, fontSize: 13, marginBottom: 16 }}>
              해당 기간 평균 거래대금이 20일 평균의 몇 배인지. 종가×거래량 근사치라 배율로만 읽는다.
            </p>
            <StockTable rows={data.turnover_surge} columns={["turnover", "return"]} />
          </div>
        </>
      )}
    </div>
  );
}
