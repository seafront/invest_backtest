import { useEffect, useState } from "react";
import { getInvestorFlow, syncInvestorFlow } from "../api/client";
import type { InvestorFlowPoint, InvestorFlowSeries } from "../types";
import { downsample, ts, axisFormatter } from "../utils/chart";
import { POSITIVE, NEGATIVE, SERIES_COLORS } from "../theme";
import ChartRow from "./ChartRow";

/**
 * 투자자 매매동향 — 한국 종목 전용.
 *
 * 미국 시장은 투자자 유형별 매매 자료를 공개하지 않는다. 그래서 이 패널은
 * 데이터가 있을 때만 나타나고, 미국 종목에서는 조용히 사라진다.
 *
 * 일별 순매수만으로는 흐름이 읽히지 않아 누적선을 함께 그린다. 하루하루는
 * 들쭉날쭉해도 누적선의 기울기는 "누가 계속 사고 있나"를 그대로 보여준다.
 */

const MUTED = "#94a3b8";
const INK = "#e2e8f0";
const SURFACE = "#1e1e2e";
const GRID = "#334155";

// 세 주체는 서로 다른 계열이지 좋고 나쁨이 아니므로 상승/하락 색을 쓰지 않는다.
const ACTORS = [
  { key: "frgn", label: "외국인", color: SERIES_COLORS[1] },
  { key: "orgn", label: "기관", color: SERIES_COLORS[2] },
  { key: "prsn", label: "개인", color: SERIES_COLORS[3] },
] as const;

type ActorKey = (typeof ACTORS)[number]["key"];

/** 주식 수는 자릿수가 커서 그대로 두면 축이 읽히지 않는다. */
const inManShares = (n: number) => `${Math.round(n / 10_000).toLocaleString()}만`;

function Tile({ label, value, color, note }: { label: string; value: string; color?: string; note?: string }) {
  return (
    <div style={{ background: "#0f172a", borderRadius: 8, padding: "12px 16px", minWidth: 150, flex: 1 }}>
      <div style={{ color: MUTED, fontSize: 12, marginBottom: 4 }}>{label}</div>
      <div style={{ color: color ?? INK, fontSize: 19, fontWeight: 700 }}>{value}</div>
      {note && <div style={{ color: "#64748b", fontSize: 11, marginTop: 2 }}>{note}</div>}
    </div>
  );
}

/** 마지막 날부터 거꾸로 세어, 순매수 부호가 유지된 일수. 부호가 방향을 담는다. */
function streak(rows: InvestorFlowPoint[], key: ActorKey): number {
  const field = `${key}_ntby_qty` as const;
  const last = rows.at(-1)?.[field];
  if (!last) return 0;
  const sign = Math.sign(last);
  let n = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = rows[i][field];
    if (v === null || Math.sign(v) !== sign) break;
    n++;
  }
  return sign * n;
}

export default function InvestorFlowPanel({ ticker }: { ticker: string }) {
  const [state, setState] = useState<{ ticker: string; data: InvestorFlowSeries | null } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getInvestorFlow(ticker)
      .then((r) => !cancelled && setState({ ticker, data: r.data }))
      .catch(() => !cancelled && setState({ ticker, data: null }));
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  const series = state?.ticker === ticker ? state.data : null;
  // 미국 종목은 이 데이터가 존재하지 않는다. 안내조차 띄우지 않고 사라진다.
  if (!series || series.data.length === 0) return null;

  const handleSync = async () => {
    setSyncing(true);
    setError("");
    try {
      const { data } = await syncInvestorFlow(ticker, 3);
      setState({ ticker, data });
    } catch {
      setError("수집에 실패했습니다. 증권사 API 키 설정을 확인하세요.");
    } finally {
      setSyncing(false);
    }
  };

  const rows = series.data;
  const recent = rows.slice(-20);

  // 누적선은 구간 시작을 0으로 두고 쌓는다. 절대 보유량이 아니라 이 구간의 방향이다.
  const running: Record<ActorKey, number> = { prsn: 0, frgn: 0, orgn: 0 };
  const chart = downsample(rows, 300).map((p) => {
    running.prsn += p.prsn_ntby_qty ?? 0;
    running.frgn += p.frgn_ntby_qty ?? 0;
    running.orgn += p.orgn_ntby_qty ?? 0;
    return {
      t: ts(p.date),
      d_frgn: p.frgn_ntby_qty,
      d_orgn: p.orgn_ntby_qty,
      d_prsn: p.prsn_ntby_qty,
      c_frgn: running.frgn,
      c_orgn: running.orgn,
      c_prsn: running.prsn,
    };
  });

  const tDomain: [number, number] = [ts(rows[0].date), ts(rows[rows.length - 1].date)];
  const fmtX = axisFormatter(tDomain);
  const sum20 = (key: ActorKey) =>
    recent.reduce((acc, r) => acc + (r[`${key}_ntby_qty`] ?? 0), 0);

  return (
    <div style={{ background: SURFACE, borderRadius: 8, padding: 16, marginBottom: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ color: INK, margin: "0 0 4px" }}>투자자 매매동향 — 누가 사고 누가 팔았나</h3>
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          style={{
            background: "transparent",
            color: syncing ? "#64748b" : "#94a3b8",
            border: `1px solid ${GRID}`,
            borderRadius: 6,
            padding: "6px 14px",
            fontSize: 12,
            cursor: syncing ? "default" : "pointer",
          }}
        >
          {syncing ? "수집 중…" : "3개월 다시 받기"}
        </button>
      </div>
      <p style={{ color: MUTED, fontSize: 13, marginBottom: 16 }}>
        한국거래소가 공개하는 자료라 국내 종목에만 있다. 단위는 주식 수.
        {series.start_date && ` 보유 구간 ${series.start_date} ~ ${series.end_date} (${series.count}거래일).`}
      </p>

      {error && <p style={{ color: NEGATIVE, fontSize: 13 }}>{error}</p>}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        {ACTORS.map((a) => {
          const total = sum20(a.key);
          const days = streak(rows, a.key);
          return (
            <Tile
              key={a.key}
              label={`${a.label} 20일 누적`}
              value={`${total > 0 ? "+" : ""}${inManShares(total)}주`}
              color={total >= 0 ? POSITIVE : NEGATIVE}
              // 20일 누적과 방향이 반대일 수 있다. 누적은 구간 합, 이건 직전 연속 구간이다.
              note={days === 0 ? "—" : `직전 ${Math.abs(days)}일 ${days > 0 ? "연속 순매수" : "연속 순매도"}`}
            />
          );
        })}
      </div>

      <ChartRow
        rows={chart}
        tDomain={tDomain}
        fmtX={fmtX}
        lines={ACTORS.map((a) => ({ key: `d_${a.key}`, color: a.color, label: a.label }))}
        gradientId="flowDaily"
        title="일별 순매수 — 0선 위면 그날 순매수"
        fmtValue={inManShares}
        refLine={0}
        height={150}
      />
      <ChartRow
        rows={chart}
        tDomain={tDomain}
        fmtX={fmtX}
        lines={ACTORS.map((a) => ({ key: `c_${a.key}`, color: a.color, label: a.label }))}
        gradientId="flowCumulative"
        title="누적 순매수 — 구간 시작을 0으로 둔 합계. 기울기가 방향이다"
        fmtValue={inManShares}
        refLine={0}
        height={170}
      />
    </div>
  );
}
