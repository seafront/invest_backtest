import { useCallback, useEffect, useState } from "react";
import type { Allocation, AllocationGroup } from "../types";
import { getAllocation, saveTargets } from "../api/client";
import { errMessage } from "../utils/error";
import { CAUTION, NEGATIVE, POSITIVE } from "../theme";
import { fmtMoney, fmtMoneyShort } from "../utils/money";

const MUTED = "#94a3b8";
const DIM = "#64748b";
const INK = "#e2e8f0";
const GRID = "#334155";
const BAR = "#3b82f6";
const BAND_KEY = "portfolio.band";

type View = "holding" | "sector" | "country" | "currency";
const VIEWS: { key: View; label: string }[] = [
  { key: "holding", label: "종목" },
  { key: "sector", label: "섹터" },
  { key: "country", label: "국가" },
  { key: "currency", label: "통화" },
];
const COUNTRY: Record<string, string> = { KR: "한국", US: "미국" };

function readBand(): number {
  try {
    const v = Number(localStorage.getItem(BAND_KEY));
    return v > 0 ? v : 5;
  } catch {
    return 5;
  }
}

const input: React.CSSProperties = {
  background: "#0f172a",
  border: `1px solid ${GRID}`,
  borderRadius: 6,
  color: INK,
  padding: "4px 8px",
  fontSize: 13,
};

interface Props {
  /** 보유 종목이 바뀌면 올라가는 번호. 바뀔 때마다 다시 불러온다. */
  version: number;
}

/** 자산 현황·비중, 목표 비중과 리밸런싱 수량. 달러 보유분은 USD/KRW 종가로 원화로 합친다. */
export default function AllocationPanel({ version }: Props) {
  const [band, setBand] = useState(readBand);
  const [data, setData] = useState<Allocation | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("holding");
  const [hovered, setHovered] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ ticker: string; weight: string }[] | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(
    () =>
      getAllocation(band)
        .then((r) => {
          setData(r.data);
          setError("");
        })
        .catch((err: unknown) => setError(errMessage(err, "자산 현황을 불러오지 못했습니다"))),
    [band]
  );

  useEffect(() => {
    load();
  }, [load, version]);

  const changeBand = (v: number) => {
    setBand(v);
    try {
      localStorage.setItem(BAND_KEY, String(v));
    } catch {
      /* 저장 못 해도 이번 화면에서는 쓴다 */
    }
  };

  const startEdit = () =>
    setDraft(
      (data?.holdings ?? []).filter((r) => r.target != null || r.quantity > 0).map((r) => ({ ticker: r.ticker, weight: r.target?.toString() ?? "" }))
    );

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError("");
    try {
      const items = draft.filter((d) => d.ticker.trim() && d.weight.trim() !== "").map((d) => ({ ticker: d.ticker.trim(), weight: Number(d.weight) }));
      const r = await saveTargets(items, band);
      setData(r.data);
      setDraft(null);
    } catch (err: unknown) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const draftSum = draft?.reduce((s, d) => s + (Number(d.weight) || 0), 0) ?? 0;

  const groups: AllocationGroup[] = !data
    ? []
    : view === "holding"
      ? [
          ...data.holdings.filter((r) => r.quantity > 0).map((r) => ({ name: r.ticker, value_krw: r.value_krw, weight: r.weight })),
          ...(data.cash_krw ? [{ name: "현금", value_krw: data.cash_krw, weight: data.cash_weight }] : []),
        ]
      : view === "sector"
        ? data.by_sector
        : view === "country"
          ? data.by_country.map((g) => ({ ...g, name: COUNTRY[g.name] ?? g.name }))
          : data.by_currency;
  const targetOf = (name: string): number | null => {
    if (view !== "holding" || !data) return null;
    if (name === "현금") return data.cash_target;
    return data.holdings.find((r) => r.ticker === name)?.target ?? null;
  };
  const scale = Math.max(1, ...groups.map((g) => Math.max(g.weight, targetOf(g.name) ?? 0)));
  const hoverRow = groups.find((g) => g.name === hovered);
  const holdingName = (t: string) => data?.holdings.find((r) => r.ticker === t)?.name;

  return (
    <div style={{ background: "#1e1e2e", borderRadius: 8, padding: 20, marginBottom: 24 }}>
      <h3 style={{ color: INK, margin: "0 0 4px", fontSize: 16 }}>자산 현황 · 비중</h3>
      <p style={{ color: DIM, fontSize: 12, margin: "0 0 12px" }}>
        보유 종목(KIS + 직접 입력)과 KIS 예수금을 합친 총자산입니다. 캐시 종가로 계산하고, 달러 보유분은 USD/KRW 종가로 원화로 바꿉니다.
      </p>
      {error && <p style={{ color: NEGATIVE, fontSize: 13 }}>{error}</p>}

      {data && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
            {[
              { label: "총자산", value: fmtMoney(data.total_krw, "KRW") },
              { label: "주식", value: fmtMoney(data.invested_krw, "KRW"), sub: `${(100 - data.cash_weight).toFixed(1)}%` },
              {
                label: "현금 (KIS 예수금)",
                value: fmtMoney(data.cash_krw, "KRW"),
                sub: `${data.cash_weight.toFixed(1)}%${data.cash_target != null ? ` · 목표 ${data.cash_target.toFixed(1)}%` : ""}`,
              },
              {
                label: "USD/KRW",
                value: data.fx_rate ? `₩${data.fx_rate.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}` : "—",
                sub: data.fx_date ? `${data.fx_date} 종가` : "환율 없음",
              },
            ].map((t) => (
              <div key={t.label} style={{ background: "#0f172a", border: `1px solid ${GRID}`, borderRadius: 8, padding: "8px 12px", minWidth: 150 }}>
                <div style={{ color: DIM, fontSize: 11 }}>{t.label}</div>
                <div style={{ color: INK, fontSize: 16, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{t.value}</div>
                {t.sub && <div style={{ color: MUTED, fontSize: 11 }}>{t.sub}</div>}
              </div>
            ))}
          </div>

          <div style={{ display: "flex", background: "#0f172a", border: `1px solid ${GRID}`, borderRadius: 6, padding: 2, width: "fit-content", marginBottom: 10 }}>
            {VIEWS.map((v) => (
              <button
                key={v.key}
                type="button"
                onClick={() => setView(v.key)}
                style={{
                  background: view === v.key ? BAR : "transparent",
                  color: view === v.key ? "#fff" : MUTED,
                  border: "none",
                  borderRadius: 4,
                  padding: "3px 12px",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                {v.label}
              </button>
            ))}
          </div>

          {groups.length === 0 ? (
            <p style={{ color: MUTED, fontSize: 13 }}>보유 종목도 예수금도 없습니다.</p>
          ) : (
            <div role="table" aria-label="비중" style={{ marginBottom: 6 }}>
              {groups.map((g) => {
                const tgt = targetOf(g.name);
                return (
                  <div
                    key={g.name}
                    role="row"
                    onMouseEnter={() => setHovered(g.name)}
                    onMouseLeave={() => setHovered(null)}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "150px 1fr 220px",
                      alignItems: "center",
                      gap: 10,
                      padding: "5px 4px",
                      borderRadius: 4,
                      background: hovered === g.name ? "rgba(59, 130, 246, 0.08)" : undefined,
                    }}
                  >
                    <span role="cell" style={{ color: INK, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {g.name}
                    </span>
                    <span role="cell" style={{ position: "relative", height: 14 }}>
                      <span
                        style={{
                          position: "absolute",
                          left: 0,
                          top: 2,
                          height: 10,
                          width: `${(g.weight / scale) * 100}%`,
                          background: g.name === "현금" ? "#64748b" : BAR,
                          borderRadius: "0 4px 4px 0",
                        }}
                      />
                      {tgt != null && (
                        <span
                          title={`목표 ${tgt}%`}
                          style={{ position: "absolute", left: `calc(${(tgt / scale) * 100}% - 1px)`, top: -1, width: 2, height: 16, background: INK }}
                        />
                      )}
                    </span>
                    <span role="cell" style={{ color: MUTED, fontSize: 12, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      <b style={{ color: INK }}>{g.weight.toFixed(1)}%</b>
                      {tgt != null && <span> / 목표 {tgt.toFixed(1)}%</span>} · {fmtMoneyShort(g.value_krw, "KRW")}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          <div style={{ color: hoverRow ? INK : DIM, fontSize: 12, minHeight: 18, marginBottom: 12 }}>
            {hoverRow
              ? `${hoverRow.name}${holdingName(hoverRow.name) ? ` (${holdingName(hoverRow.name)})` : ""} — ${fmtMoney(hoverRow.value_krw, "KRW")}, 총자산의 ${hoverRow.weight.toFixed(2)}%`
              : view === "holding"
                ? "흰 세로선은 목표 비중입니다. 막대에 올리면 금액이 나옵니다."
                : "막대에 올리면 금액이 나옵니다."}
          </div>

          {data.warnings.length > 0 && (
            <div style={{ color: CAUTION, fontSize: 12, marginBottom: 14 }}>
              {data.warnings.map((w) => (
                <div key={w}>⚠ {w}</div>
              ))}
            </div>
          )}

          <div style={{ borderTop: `1px solid ${GRID}`, paddingTop: 14 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginBottom: 8 }}>
              <h4 style={{ color: INK, margin: 0, fontSize: 14 }}>목표 비중 · 리밸런싱</h4>
              <label style={{ color: MUTED, fontSize: 12 }} title="목표에서 이만큼 벗어난 종목만 수량을 제안합니다">
                허용 범위 ±
                <input type="number" min={0} step={0.5} value={band} onChange={(e) => changeBand(Number(e.target.value) || 0)} style={{ ...input, width: 60, margin: "0 4px" }} />
                %p
              </label>
              {!draft ? (
                <button type="button" onClick={startEdit} style={smallBtn}>
                  목표 비중 편집
                </button>
              ) : (
                <>
                  <button type="button" onClick={save} disabled={saving || draftSum > 100} style={{ ...smallBtn, color: "#fff", background: BAR, border: "none" }}>
                    {saving ? "저장 중…" : "저장"}
                  </button>
                  <button type="button" onClick={() => setDraft(null)} style={smallBtn}>
                    취소
                  </button>
                  <span style={{ color: draftSum > 100 ? NEGATIVE : MUTED, fontSize: 12 }}>
                    합계 {draftSum.toFixed(1)}% · 나머지 {Math.max(0, 100 - draftSum).toFixed(1)}%는 현금 목표
                  </span>
                </>
              )}
            </div>

            {draft ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 420 }}>
                {draft.map((d, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      value={d.ticker}
                      onChange={(e) => setDraft((x) => x!.map((y, j) => (j === i ? { ...y, ticker: e.target.value.toUpperCase() } : y)))}
                      placeholder="티커"
                      style={{ ...input, width: 130 }}
                    />
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={d.weight}
                      onChange={(e) => setDraft((x) => x!.map((y, j) => (j === i ? { ...y, weight: e.target.value } : y)))}
                      placeholder="목표 %"
                      style={{ ...input, width: 90 }}
                    />
                    <span style={{ color: MUTED, fontSize: 12 }}>%</span>
                    <button type="button" onClick={() => setDraft((x) => x!.filter((_, j) => j !== i))} style={smallBtn}>
                      빼기
                    </button>
                  </div>
                ))}
                <button type="button" onClick={() => setDraft((x) => [...x!, { ticker: "", weight: "" }])} style={{ ...smallBtn, width: "fit-content" }}>
                  + 종목 추가
                </button>
                <span style={{ color: DIM, fontSize: 11 }}>목표에만 있고 아직 없는 종목은 저장할 때 시세를 받습니다. 비워 둔 칸은 목표에서 뺍니다.</span>
              </div>
            ) : (
              <RebalanceTable data={data} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

const smallBtn: React.CSSProperties = {
  background: "transparent",
  border: `1px solid ${GRID}`,
  borderRadius: 6,
  color: MUTED,
  padding: "3px 10px",
  fontSize: 12,
  cursor: "pointer",
};
const th: React.CSSProperties = { color: MUTED, fontWeight: 600, padding: "7px 10px", whiteSpace: "nowrap", textAlign: "right" };
const num: React.CSSProperties = { padding: "7px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: INK, whiteSpace: "nowrap" };

function RebalanceTable({ data }: { data: Allocation }) {
  const rows = data.holdings.filter((r) => r.target != null);
  if (rows.length === 0) {
    return <p style={{ color: MUTED, fontSize: 13, margin: 0 }}>목표 비중이 없습니다. "목표 비중 편집"에서 종목별 목표를 정하면 맞추는 데 필요한 수량을 계산합니다.</p>;
  }
  const drift = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%p`);
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${GRID}` }}>
            <th style={{ ...th, textAlign: "left" }}>종목</th>
            <th style={th}>지금</th>
            <th style={th}>목표</th>
            <th style={th}>차이</th>
            <th style={th}>종가</th>
            <th style={{ ...th, textAlign: "left" }}>목표로 돌아가려면</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const out = r.drift != null && Math.abs(r.drift) > data.band;
            return (
              <tr key={r.ticker} style={{ borderBottom: "1px solid #1e293b" }}>
                <td style={{ padding: "7px 10px", color: INK }}>
                  <b>{r.ticker}</b>
                  {r.name && <span style={{ color: DIM, fontSize: 11, marginLeft: 6 }}>{r.name}</span>}
                  {r.quantity === 0 && <span style={{ color: DIM, fontSize: 11, marginLeft: 6 }}>(미보유)</span>}
                </td>
                <td style={num}>{r.weight.toFixed(1)}%</td>
                <td style={num}>{r.target!.toFixed(1)}%</td>
                <td style={{ ...num, color: out ? CAUTION : MUTED }}>{drift(r.drift)}</td>
                <td style={{ ...num, color: MUTED }}>{fmtMoney(r.price, r.currency, r.currency === "KRW" ? 0 : 2)}</td>
                <td style={{ padding: "7px 10px", whiteSpace: "nowrap" }}>
                  {r.action ? (
                    <span style={{ color: r.action.side === "BUY" ? POSITIVE : NEGATIVE, fontWeight: 600 }}>
                      {r.action.side === "BUY" ? "▲ 매수" : "▼ 매도"} {r.action.shares}주{" "}
                      <span style={{ color: MUTED, fontWeight: 400 }}>≈ {fmtMoney(r.action.amount_krw, "KRW")}</span>
                    </span>
                  ) : (
                    <span style={{ color: DIM }}>{out ? "1주 미만" : "범위 안"}</span>
                  )}
                </td>
              </tr>
            );
          })}
          {data.cash_target != null && (
            <tr style={{ background: "rgba(148, 163, 184, 0.08)" }}>
              <td style={{ padding: "7px 10px", color: INK }}>현금</td>
              <td style={num}>{data.cash_weight.toFixed(1)}%</td>
              <td style={num}>{data.cash_target.toFixed(1)}%</td>
              <td style={{ ...num, color: MUTED }}>{drift(data.cash_drift)}</td>
              <td style={num} />
              <td style={{ padding: "7px 10px", color: DIM, fontSize: 12 }}>매수·매도의 결과로 따라 움직임</td>
            </tr>
          )}
        </tbody>
      </table>
      <p style={{ color: DIM, fontSize: 11, margin: "6px 0 0" }}>
        차이가 ±{data.band}%p를 넘는 종목만 수량을 제안합니다. 종가 기준이며 수수료·세금은 넣지 않았습니다. 주문은 하지 않습니다 — 시점은 아래 매수·매도 시점 가이드를 함께 보세요.
      </p>
    </div>
  );
}
