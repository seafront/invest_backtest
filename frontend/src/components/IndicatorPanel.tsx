import { useEffect, useState } from "react";
import { getStockIndicators } from "../api/client";
import type { StockIndicators } from "../types";
import { errMessage } from "../utils/error";
import { POSITIVE, NEGATIVE, CAUTION, SERIES_COLORS } from "../theme";
import { downsample, ts, axisFormatter } from "../utils/chart";
import ChartRow from "./ChartRow";

const MUTED = "#94a3b8";
const INK = "#e2e8f0";
const SURFACE = "#1e1e2e";
const GRID = "#334155";

const PRICE_LINE = SERIES_COLORS[0];
const DISPARITY_LINE = SERIES_COLORS[1];

/** 같은 지표를 기간만 달리한 것이므로 한 차트에 겹쳐 그린다. 벌어진 폭 자체가 정보다. */
const DISPARITY_LINES = [
  { key: "d5", color: SERIES_COLORS[3], label: "5일" },
  { key: "d20", color: DISPARITY_LINE, label: "20일" },
  { key: "d60", color: SERIES_COLORS[2], label: "60일" },
]; // 방향에 의미가 있지만 0선으로 구분되므로 중립색
const TURNOVER_LINE = SERIES_COLORS[2];

const RANGES: { key: string; label: string }[] = [
  { key: "1m", label: "1달" },
  { key: "3m", label: "3달" },
  { key: "6m", label: "6달" },
  { key: "1y", label: "1년" },
  { key: "3y", label: "3년" },
  { key: "5y", label: "5년" },
  { key: "all", label: "전체" },
];

// level은 색으로만 전달하지 않는다 — 기호와 문장이 같은 내용을 중복해 담는다.
const LEVEL: Record<string, { color: string; mark: string }> = {
  ok: { color: POSITIVE, mark: "✓" },
  watch: { color: CAUTION, mark: "△" },
  alert: { color: NEGATIVE, mark: "▲" },
};

const pct = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}%`);
const sign = (v: number | null) => (v === null ? INK : v >= 0 ? POSITIVE : NEGATIVE);

/** 거래대금은 자릿수가 커서 그대로 두면 읽히지 않는다. */
function money(v: number | null): string {
  if (v === null) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  return v.toLocaleString();
}

function Tile({ label, value, color, note }: { label: string; value: string; color?: string; note?: string }) {
  return (
    <div style={{ background: "#0f172a", borderRadius: 8, padding: "12px 16px", minWidth: 130, flex: 1 }}>
      <div style={{ color: MUTED, fontSize: 12, marginBottom: 4 }}>{label}</div>
      <div style={{ color: color ?? INK, fontSize: 19, fontWeight: 700 }}>{value}</div>
      {note && <div style={{ color: "#64748b", fontSize: 11, marginTop: 2 }}>{note}</div>}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span style={{ color: MUTED, fontSize: 13 }}>{label} </span>
      <span style={{ color: INK, fontSize: 13, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

export default function IndicatorPanel({ ticker }: { ticker: string }) {
  const [range, setRange] = useState("1y");
  // 티커를 함께 담아 둔다 — 구간만 바꿀 때는 이전 데이터를 그대로 두어 화면이 깜빡이지 않고,
  // 티커가 바뀌면 남의 데이터를 그리지 않도록 렌더에서 걸러낸다.
  const [state, setState] = useState<{ ticker: string; data: StockIndicators | null; error: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getStockIndicators(ticker, range)
      .then((r) => !cancelled && setState({ ticker, data: r.data, error: "" }))
      .catch((e: unknown) => !cancelled && setState({ ticker, data: null, error: errMessage(e) }));
    return () => {
      cancelled = true;
    };
  }, [ticker, range]);

  const ind = state?.ticker === ticker ? state.data : null;
  // 거래일이 20일 미만이면 400이 온다. 카드만 접고 나머지 화면은 그대로 둔다.
  if (!ind) return null;

  const rows = downsample(ind.series).map((p) => ({
    t: ts(p.date),
    close: p.close,
    d5: p.disparity_5,
    d20: p.disparity_20,
    d60: p.disparity_60,
    ratio: p.turnover_ratio,
  }));
  const tDomain: [number, number] = [
    ts(ind.series[0]?.date ?? ind.as_of),
    ts(ind.as_of),
  ];
  const fmtX = axisFormatter(tDomain);

  const surged = (ind.turnover_ratio_5_60 ?? 0) >= 1.5;

  return (
    <div style={{ background: SURFACE, borderRadius: 8, padding: 16, marginBottom: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ color: INK, margin: "0 0 4px" }}>파생 지표 — 지금 어디에 서 있나</h3>
        <div style={{ display: "flex", gap: 4 }}>
          {RANGES.map((r) => (
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
      <p style={{ color: MUTED, fontSize: 13, marginBottom: 16 }}>
        {ind.as_of} 종가 기준. 캐시된 OHLCV에서 계산하므로 따로 받아올 데이터가 없다.
        거래대금은 <code style={{ color: "#cbd5e1" }}>종가 × 거래량</code> 근사치라 절대 금액이 아닌 배율로 읽는다.
        구간 버튼은 아래 차트에만 적용되며, 타일 값은 언제나 마지막 거래일 기준이다.
      </p>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <Tile label="20일선 이격도" value={pct(ind.disparity_20)} color={sign(ind.disparity_20)} />
        <Tile
          label="거래대금 5일÷60일"
          value={ind.turnover_ratio_5_60 === null ? "—" : `${ind.turnover_ratio_5_60.toFixed(2)}×`}
          color={surged ? CAUTION : INK}
          note={`5일 ${money(ind.turnover_avg5)}`}
        />
        <Tile label="5일 수익률" value={pct(ind.return_5d)} color={sign(ind.return_5d)} />
        <Tile label="20일 수익률" value={pct(ind.return_20d)} color={sign(ind.return_20d)} />
        <Tile
          label="52주 고가 대비"
          value={pct(ind.from_high_pct)}
          color={sign(ind.from_high_pct)}
          note={ind.is_52w_high ? "신고가 경신" : `고가 ${ind.high_52w.toLocaleString()}`}
        />
        <Tile
          label="변동성 (20일·연율)"
          value={ind.volatility_20d === null ? "—" : `${ind.volatility_20d.toFixed(2)}%`}
        />
      </div>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 16 }}>
        <Fact label="20일선 위 연속" value={`${ind.above_ma20_days}일`} />
        <Fact label="긴 위꼬리 (20일 중)" value={`${ind.upper_wick_days_20}일`} />
        <Fact label="양봉 (15일 중)" value={`${ind.bullish_days_15}일`} />
        <Fact
          label="저점"
          value={ind.low_rising === null ? "—" : ind.low_rising ? "직전 20일보다 높아짐" : "높아지지 않음"}
        />
        <Fact
          label="이격도 5/20/60"
          value={[ind.disparity_5, ind.disparity_20, ind.disparity_60]
            .map((d) => (d === null ? "—" : `${d > 0 ? "+" : ""}${d.toFixed(2)}%`))
            .join(" / ")}
        />
        <Fact label="MA 5/20/60" value={[ind.ma5, ind.ma20, ind.ma60].map((m) => (m === null ? "—" : m.toFixed(2))).join(" / ")} />
      </div>

      {/* 관찰 결과 — 매매 신호가 아니다. 임계값을 문장 안에 그대로 적어 판단 근거를 숨기지 않는다. */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
        {ind.signals.map((s) => {
          const lv = LEVEL[s.level] ?? LEVEL.ok;
          return (
            <span
              key={s.key}
              style={{
                border: `1px solid ${lv.color}`,
                borderRadius: 999,
                padding: "5px 12px",
                fontSize: 12,
                color: INK,
                background: "#0f172a",
              }}
            >
              <span style={{ color: lv.color, fontWeight: 700 }}>{lv.mark}</span>{" "}
              <span style={{ color: MUTED }}>{s.label}</span> {s.detail}
            </span>
          );
        })}
      </div>

      <p style={{ color: MUTED, fontSize: 13, marginBottom: 4 }}>
        아래 세 차트는 x축이 같다. 세로로 같은 위치가 같은 시점이다.
        {" "}지금 구간은 {ind.series[0]?.date} ~ {ind.as_of} ({ind.series.length.toLocaleString()}거래일).
      </p>

      <ChartRow
        rows={rows}
        tDomain={tDomain}
        fmtX={fmtX}
        lines={[{ key: "close", color: PRICE_LINE, label: "종가" }]}
        gradientId="priceFill"
        title="종가"
        fmtValue={(n) => n.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        yDomain={["auto", "auto"]}
        height={170}
      />
      <ChartRow
        rows={rows}
        tDomain={tDomain}
        fmtX={fmtX}
        lines={DISPARITY_LINES}
        gradientId="dispFill"
        title="이격도 — 0선 위면 그 기간 평균보다 비싸다"
        fmtValue={(n) => `${n.toFixed(2)}%`}
        refLine={0}
        height={170}
      />
      <ChartRow
        rows={rows}
        tDomain={tDomain}
        fmtX={fmtX}
        lines={[{ key: "ratio", color: TURNOVER_LINE, label: "거래대금 / 20일 평균" }]}
        gradientId="ratioFill"
        title="거래대금 / 20일 평균 — 1배 선 위로 솟은 날이 거래가 몰린 날이다"
        fmtValue={(n) => `${n.toFixed(2)}×`}
        refLine={1}
      />
    </div>
  );
}
