import { useEffect, useState } from "react";
import type { PortfolioRisk } from "../types";
import { getPortfolioRisk } from "../api/client";
import { errMessage } from "../utils/error";
import { CAUTION, NEGATIVE } from "../theme";

const MUTED = "#94a3b8";
const DIM = "#64748b";
const INK = "#e2e8f0";
const GRID = "#334155";
const BAR = "#3b82f6";

/** 상관계수 색: 음수 빨강 ← 0 회색 → 양수 파랑. 값은 칸에 숫자로도 적는다(색만으로 읽지 않게). */
const NEUTRAL = [0x38, 0x38, 0x35];
const POS = [0x2a, 0x78, 0xd6];
const NEG = [0xd6, 0x45, 0x45];
function corrColor(v: number): string {
  const pole = v >= 0 ? POS : NEG;
  const t = Math.min(1, Math.abs(v));
  const c = NEUTRAL.map((n, i) => Math.round(n + (pole[i] - n) * t));
  return `rgb(${c.join(",")})`;
}

interface Props {
  version: number;
}

/** 지금 비중을 지난 1년 들고 있었다면의 변동성·낙폭, 위험 기여, 종목 간 상관. */
export default function RiskPanel({ version }: Props) {
  const [data, setData] = useState<PortfolioRisk | null>(null);
  const [error, setError] = useState("");
  const [hover, setHover] = useState<{ a: string; b: string; v: number } | null>(null);

  useEffect(() => {
    getPortfolioRisk()
      .then((r) => {
        setData(r.data);
        setError("");
      })
      .catch((err: unknown) => setError(errMessage(err, "위험 분석을 불러오지 못했습니다")));
  }, [version]);

  const maxContrib = Math.max(1, ...(data?.holdings ?? []).map((h) => Math.abs(h.risk_contribution)));
  const cell = 52;

  return (
    <div style={{ background: "#1e1e2e", borderRadius: 8, padding: 20, marginBottom: 24 }}>
      <h3 style={{ color: INK, margin: "0 0 4px", fontSize: 16 }}>위험 분석</h3>
      <p style={{ color: DIM, fontSize: 12, margin: "0 0 12px", lineHeight: 1.6 }}>
        지금 주식 비중을 지난 1년 동안 그대로 들고 있었다면 어땠을지 계산합니다(매일 비중을 맞춘 근사, 현금 제외 — 실제 계좌의 과거 수익률이 아닙니다).
        변동성·상관은 주간 수익률로 잽니다. 한국장이 미국장보다 먼저 닫혀 일간으로 재면 한·미 종목의 상관이 실제보다 낮게 나오기 때문입니다.
      </p>
      {error && <p style={{ color: NEGATIVE, fontSize: 13 }}>{error}</p>}
      {data && !data.available && <p style={{ color: MUTED, fontSize: 13 }}>{data.reason}</p>}

      {data?.available && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
            {[
              { label: "연 변동성", value: `${data.volatility!.toFixed(1)}%`, sub: "주간 수익률 기준" },
              { label: "1년 최대 낙폭", value: `-${data.max_drawdown!.toFixed(1)}%`, sub: "고점 대비 최저" },
              {
                label: "유효 종목 수",
                value: `${data.effective_n!.toFixed(1)} / ${data.holdings_n}`,
                sub: "1 ÷ Σ비중² — 비중이 고르면 종목 수와 같음",
              },
              { label: "기간", value: `${data.days}거래일`, sub: `${data.start} ~ ${data.end}` },
            ].map((t) => (
              <div key={t.label} style={{ background: "#0f172a", border: `1px solid ${GRID}`, borderRadius: 8, padding: "8px 12px", minWidth: 150 }}>
                <div style={{ color: DIM, fontSize: 11 }}>{t.label}</div>
                <div style={{ color: INK, fontSize: 16, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{t.value}</div>
                <div style={{ color: MUTED, fontSize: 11 }}>{t.sub}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 28, alignItems: "flex-start" }}>
            <div style={{ flex: "1 1 380px", overflowX: "auto" }}>
              <div style={{ color: INK, fontSize: 13, fontWeight: 600, marginBottom: 6 }}>종목별 위험 기여</div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${GRID}` }}>
                    <th style={th("left")}>종목</th>
                    <th style={th("right")} title="주식 안에서의 비중">
                      비중
                    </th>
                    <th style={th("right")}>연 변동성</th>
                    <th style={th("left")} title="포트폴리오 변동 중 이 종목이 만드는 몫">
                      위험 기여
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.holdings.map((h) => (
                    <tr key={h.ticker} style={{ borderBottom: "1px solid #1e293b" }}>
                      <td style={{ padding: "6px 8px", color: INK, fontWeight: 600 }}>{h.ticker}</td>
                      <td style={numCell}>{h.weight.toFixed(1)}%</td>
                      <td style={numCell}>{h.volatility.toFixed(1)}%</td>
                      <td style={{ padding: "6px 8px", minWidth: 150 }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span
                            style={{
                              height: 10,
                              width: `${(Math.max(0, h.risk_contribution) / maxContrib) * 90}px`,
                              background: BAR,
                              borderRadius: "0 4px 4px 0",
                            }}
                          />
                          <span style={{ color: h.risk_contribution > h.weight * 1.5 ? CAUTION : INK, fontVariantNumeric: "tabular-nums", fontSize: 12 }}>
                            {h.risk_contribution.toFixed(1)}%
                          </span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ color: DIM, fontSize: 11, margin: "6px 0 0" }}>위험 기여가 비중의 1.5배를 넘으면 노란색 — 비중보다 흔들림을 훨씬 많이 만드는 종목입니다.</p>
            </div>

            {data.tickers.length >= 2 && (
              <div>
                <div style={{ color: INK, fontSize: 13, fontWeight: 600, marginBottom: 6 }}>상관계수 (주간)</div>
                <div style={{ display: "grid", gridTemplateColumns: `90px repeat(${data.tickers.length}, ${cell}px)`, gap: 2 }}>
                  <span />
                  {data.tickers.map((t) => (
                    <span key={t} style={{ color: MUTED, fontSize: 10, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t}
                    </span>
                  ))}
                  {data.tickers.map((a, i) => (
                    <Row key={a} a={a} i={i} data={data} cell={cell} onHover={setHover} />
                  ))}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: 11, color: MUTED }}>
                  -1
                  <span style={{ width: 120, height: 8, borderRadius: 2, background: `linear-gradient(90deg, ${corrColor(-1)}, ${corrColor(0)}, ${corrColor(1)})` }} />
                  +1
                </div>
                <div style={{ color: hover ? INK : DIM, fontSize: 12, minHeight: 18, marginTop: 4 }}>
                  {hover ? `${hover.a} · ${hover.b}: ${hover.v.toFixed(2)}` : "+1에 가까울수록 같이 움직여 분산 효과가 작습니다"}
                </div>
              </div>
            )}
          </div>

          {data.warnings.length > 0 && (
            <div style={{ color: CAUTION, fontSize: 12, marginTop: 12 }}>
              {data.warnings.map((w) => (
                <div key={w}>⚠ {w}</div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Row({
  a,
  i,
  data,
  cell,
  onHover,
}: {
  a: string;
  i: number;
  data: PortfolioRisk;
  cell: number;
  onHover: (h: { a: string; b: string; v: number } | null) => void;
}) {
  return (
    <>
      <span style={{ color: MUTED, fontSize: 11, alignSelf: "center", textAlign: "right", paddingRight: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {a}
      </span>
      {data.tickers.map((b, j) => {
        const v = data.correlation[i][j];
        return (
          <span
            key={b}
            onMouseEnter={() => onHover({ a, b, v })}
            onMouseLeave={() => onHover(null)}
            style={{
              height: cell - 18,
              background: i === j ? "#2a2a3a" : corrColor(v),
              borderRadius: 3,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: i === j ? DIM : INK,
              fontSize: 11,
              fontVariantNumeric: "tabular-nums",
              cursor: "default",
            }}
          >
            {i === j ? "—" : v.toFixed(2)}
          </span>
        );
      })}
    </>
  );
}

const th = (align: "left" | "right"): React.CSSProperties => ({ color: MUTED, fontWeight: 600, padding: "6px 8px", textAlign: align, whiteSpace: "nowrap" });
const numCell: React.CSSProperties = { padding: "6px 8px", textAlign: "right", color: INK, fontVariantNumeric: "tabular-nums" };
