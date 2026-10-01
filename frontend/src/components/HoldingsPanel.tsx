import { Fragment, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { HoldingRulesUpdate, HoldingStatus, PortfolioOverview, StrategyInfo } from "../types";
import { addHolding, deleteHolding, getPortfolio, listStrategies, syncPortfolio, updateHolding } from "../api/client";
import { errMessage } from "../utils/error";
import { CAUTION, NEGATIVE, POSITIVE } from "../theme";
import { currencyOf, fmtMoney } from "../utils/money";
import { fmtParam, paramLabel } from "../utils/params";

const MUTED = "#94a3b8";
const DIM = "#64748b";
const INK = "#e2e8f0";
const GRID = "#334155";

const money = (v: number, ticker: string) => fmtMoney(v, currencyOf(ticker), currencyOf(ticker) === "KRW" ? 0 : 2);
const pct = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
const localTime = (utc: string) =>
  new Date(utc.endsWith("Z") ? utc : `${utc}Z`).toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

const input: React.CSSProperties = {
  background: "#0f172a",
  border: `1px solid ${GRID}`,
  borderRadius: 6,
  color: INK,
  padding: "5px 8px",
  fontSize: 13,
};
const btn = (primary: boolean, disabled = false): React.CSSProperties => ({
  background: disabled ? GRID : primary ? "#3b82f6" : "transparent",
  border: primary ? "none" : `1px solid ${GRID}`,
  borderRadius: 6,
  color: primary ? "#fff" : MUTED,
  padding: primary ? "7px 14px" : "3px 10px",
  fontSize: primary ? 13 : 12,
  fontWeight: primary ? 600 : 400,
  cursor: disabled ? "not-allowed" : "pointer",
  whiteSpace: "nowrap",
});

/**
 * 보유 종목 관리. KIS 잔고를 읽어 오고(조회만 — 주문하지 않는다) 종목마다 청산 규칙을 일봉 종가로
 * 확인한다. 걸린 규칙이 있으면 맨 위에 띄운다.
 */
export default function HoldingsPanel() {
  const [data, setData] = useState<PortfolioOverview | null>(null);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [strategies, setStrategies] = useState<StrategyInfo[]>([]);

  const load = useCallback(
    () =>
      getPortfolio()
        .then((r) => {
          setData(r.data);
          setError("");
        })
        .catch((err: unknown) => setError(errMessage(err, "보유 종목을 불러오지 못했습니다"))),
    []
  );

  useEffect(() => {
    load();
    listStrategies()
      .then((r) => setStrategies(r.data.filter((s) => s.name !== "buy_and_hold")))
      .catch(() => {});
  }, [load]);

  const sync = async () => {
    setSyncing(true);
    setSyncNote("");
    setError("");
    try {
      const r = await syncPortfolio();
      setSyncNote(
        `국내 ${r.data.domestic}종목 · 해외 ${r.data.overseas}종목 · 체결 ${r.data.executions}건` +
          (r.data.errors.length ? ` · 일부 실패: ${r.data.errors.join(" / ")}` : "")
      );
      await load();
    } catch (err: unknown) {
      setError(errMessage(err));
    } finally {
      setSyncing(false);
    }
  };

  const active = data?.holdings.filter((h) => h.active) ?? [];
  const inactive = data?.holdings.filter((h) => !h.active) ?? [];
  const alerts = active.filter((h) => h.triggered);
  const snap = data?.snapshots[0];
  const kis = data?.kis;

  return (
    <div
      style={{
        background: "#1e1e2e",
        borderRadius: 8,
        padding: 20,
        marginBottom: 24,
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "8px 14px",
          marginBottom: 4,
        }}
      >
        <h3 style={{ color: INK, margin: 0, fontSize: 16 }}>보유 종목</h3>
        {kis && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              borderRadius: 4,
              padding: "1px 6px",
              color: kis.env === "paper" ? CAUTION : NEGATIVE,
              border: `1px solid ${kis.env === "paper" ? CAUTION : NEGATIVE}`,
            }}
          >
            KIS {kis.env === "paper" ? "모의투자" : "실전"} {kis.account_hint}
          </span>
        )}
        <button
          type="button"
          onClick={sync}
          disabled={syncing || !kis?.configured}
          style={btn(true, syncing || !kis?.configured)}
        >
          {syncing ? "동기화 중…" : "KIS 동기화"}
        </button>
        <span style={{ color: MUTED, fontSize: 12 }}>
          {kis && !kis.configured
            ? "backend/.env 에 KIS 앱키와 계좌번호를 넣으면 잔고를 읽어 옵니다"
            : kis?.last_sync
              ? `마지막 동기화 ${localTime(kis.last_sync)}`
              : "아직 동기화하지 않았습니다"}
        </span>
      </div>
      <p style={{ color: DIM, fontSize: 12, margin: "0 0 12px" }}>
        KIS 잔고·체결을 조회만 합니다(주문 기능 없음). 규칙은 일봉 종가로 확인하므로 KIS 앱의 실시간 평가와 장중에는 다를 수
        있습니다. 자동 확인 때 함께 동기화됩니다.
      </p>
      {syncNote && <p style={{ color: MUTED, fontSize: 12, margin: "0 0 10px" }}>{syncNote}</p>}
      {error && <p style={{ color: NEGATIVE, fontSize: 13 }}>{error}</p>}

      {snap && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            marginBottom: 14,
          }}
        >
          {[
            { label: "예수금", value: fmtMoney(snap.cash_krw, "KRW") },
            {
              label: "국내 평가",
              value: fmtMoney(snap.stock_krw, "KRW"),
              sub: snap.pnl_krw ? pct0(snap.pnl_krw, snap.stock_krw) : "",
            },
            { label: "국내 총평가", value: fmtMoney(snap.total_krw, "KRW") },
            {
              label: "해외 평가",
              value: fmtMoney(snap.stock_usd, "USD", 2),
              sub: snap.pnl_usd ? pct0(snap.pnl_usd, snap.stock_usd) : "",
            },
          ].map((t) => (
            <div
              key={t.label}
              style={{
                background: "#0f172a",
                border: `1px solid ${GRID}`,
                borderRadius: 8,
                padding: "8px 12px",
                minWidth: 140,
              }}
            >
              <div style={{ color: DIM, fontSize: 11 }}>{t.label}</div>
              <div
                style={{
                  color: INK,
                  fontSize: 15,
                  fontWeight: 600,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {t.value}
              </div>
              {t.sub && <div style={{ color: MUTED, fontSize: 11 }}>{t.sub}</div>}
            </div>
          ))}
          <div style={{ color: DIM, fontSize: 11, alignSelf: "flex-end" }}>
            {snap.date} 기준 · 기록 {data!.snapshots.length}일
          </div>
        </div>
      )}

      {alerts.length > 0 && (
        <div
          style={{
            border: `1px solid ${NEGATIVE}`,
            borderRadius: 8,
            padding: 12,
            marginBottom: 14,
          }}
        >
          <div
            style={{
              color: NEGATIVE,
              fontWeight: 700,
              fontSize: 13,
              marginBottom: 6,
            }}
          >
            청산 규칙에 걸린 종목
          </div>
          {alerts.map((h) => (
            <div key={h.id} style={{ color: INK, fontSize: 13, margin: "3px 0" }}>
              <b>{h.ticker}</b> {h.name && <span style={{ color: DIM }}>{h.name}</span>} —{" "}
              {h.rules
                .filter((r) => r.triggered)
                .map(
                  (r) =>
                    `${r.label}${r.kind === "strategy" ? ` (${r.note})` : r.line != null ? ` (선 ${money(r.line, h.ticker)})` : ""}`
                )
                .join(", ")}
              {h.last_close != null && (
                <span style={{ color: DIM }}>
                  {" "}
                  · 종가 {money(h.last_close, h.ticker)} ({h.last_bar_date})
                </span>
              )}
            </div>
          ))}
          <div style={{ color: DIM, fontSize: 11, marginTop: 6 }}>
            다음 거래일 시가 근처에서 정리할지 판단하세요. 이 앱은 주문하지 않습니다.
          </div>
        </div>
      )}

      {data && active.length === 0 && (
        <p style={{ color: MUTED, fontSize: 13 }}>
          보유 종목이 없습니다. {kis?.env === "paper" && "모의투자 계좌에서 산 종목이 있으면 KIS 동기화로 가져옵니다. "}
          아래에서 직접 넣을 수도 있습니다.
        </p>
      )}

      {active.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${GRID}` }}>
                <th style={th}>종목</th>
                <th style={{ ...th, textAlign: "right" }}>수량 · 평균단가</th>
                <th style={{ ...th, textAlign: "right" }}>종가 · 평가</th>
                <th style={{ ...th, textAlign: "right" }}>손익</th>
                <th style={th}>청산 규칙</th>
                <th style={th} title="실제 첫 매수 vs 연결한 전략의 진입">
                  실제 vs 전략
                </th>
                <th style={th} />
              </tr>
            </thead>
            <tbody>
              {active.map((h) => (
                <Fragment key={h.id}>
                  <HoldingRow h={h} onEdit={() => setEditing(editing === h.id ? null : h.id)} editing={editing === h.id} />
                  {editing === h.id && (
                    <tr>
                      <td
                        colSpan={7}
                        style={{
                          padding: "4px 10px 14px",
                          background: "#0f172a",
                        }}
                      >
                        <RuleEditor
                          h={h}
                          strategies={strategies}
                          onSaved={async () => {
                            setEditing(null);
                            await load();
                          }}
                          onDeleted={async () => {
                            setEditing(null);
                            await load();
                          }}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {inactive.length > 0 && (
        <p style={{ color: DIM, fontSize: 12, margin: "8px 0 0" }}>
          다 판 종목(규칙은 남겨 둠, 다시 사면 이어서 적용): {inactive.map((h) => h.ticker).join(", ")}
        </p>
      )}

      <ManualAdd onAdded={load} />
    </div>
  );
}

function pct0(pnl: number, value: number) {
  const cost = value - pnl;
  return cost > 0 ? `손익 ${pct((pnl / cost) * 100)}` : "";
}

const th: React.CSSProperties = {
  color: MUTED,
  fontWeight: 600,
  padding: "8px 10px",
  whiteSpace: "nowrap",
  textAlign: "left",
};
const td: React.CSSProperties = {
  padding: "8px 10px",
  color: INK,
  verticalAlign: "top",
};
const num: React.CSSProperties = {
  ...td,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};

function HoldingRow({ h, onEdit, editing }: { h: HoldingStatus; onEdit: () => void; editing: boolean }) {
  const c = h.comparison;
  return (
    <tr
      style={{
        borderBottom: "1px solid #1e293b",
        background: h.triggered ? "rgba(239, 68, 68, 0.06)" : undefined,
      }}
    >
      <td style={td}>
        <Link to={`/data/${h.ticker}`} style={{ color: INK, fontWeight: 600, textDecoration: "none" }}>
          {h.ticker}
        </Link>
        <span style={{ color: DIM, fontSize: 11, marginLeft: 6 }}>{h.source === "kis" ? "KIS" : "직접"}</span>
        {h.name && <div style={{ color: DIM, fontSize: 11 }}>{h.name}</div>}
        <div style={{ color: DIM, fontSize: 11 }}>첫 매수 {h.first_buy_date ?? "모름"}</div>
      </td>
      <td style={num}>
        {fmtParam(h.quantity)}주<div style={{ color: DIM, fontSize: 11 }}>{money(h.avg_price, h.ticker)}</div>
      </td>
      <td style={num}>
        {h.last_close != null ? money(h.last_close, h.ticker) : "—"}
        <div style={{ color: DIM, fontSize: 11 }}>
          {h.market_value != null ? money(h.market_value, h.ticker) : (h.error ?? "")}
          {h.last_bar_date && ` · ${h.last_bar_date.slice(5)}`}
        </div>
      </td>
      <td
        style={{
          ...num,
          color: h.pnl_pct == null ? DIM : h.pnl_pct >= 0 ? POSITIVE : NEGATIVE,
        }}
      >
        {h.pnl_pct == null ? "—" : pct(h.pnl_pct)}
        {h.pnl != null && <div style={{ fontSize: 11 }}>{money(h.pnl, h.ticker)}</div>}
      </td>
      <td style={td}>
        {h.rules.length === 0 ? (
          <span style={{ color: DIM, fontSize: 12 }}>규칙 없음 — 설정에서 추가</span>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {h.rules.map((r) => (
              <span key={r.kind} title={r.note} style={{ fontSize: 12, color: r.triggered ? NEGATIVE : MUTED }}>
                {r.triggered ? "● " : "○ "}
                <span style={{ color: r.triggered ? NEGATIVE : INK }}>
                  {r.kind === "strategy" && h.display_name ? h.display_name : r.label}
                </span>
                {r.kind === "strategy" ? (
                  <span>
                    {" "}
                    · {r.triggered ? "관망 전환" : "보유 유지"}
                    {r.is_new ? " (오늘)" : ""}
                  </span>
                ) : r.triggered ? (
                  <span> · 도달</span>
                ) : r.distance_pct != null ? (
                  <span>
                    {" "}
                    · {r.kind === "target" ? `${r.distance_pct.toFixed(1)}% 더 오르면` : `${r.distance_pct.toFixed(1)}% 여유`}
                  </span>
                ) : (
                  <span style={{ color: CAUTION }}> · {r.note}</span>
                )}
              </span>
            ))}
          </div>
        )}
      </td>
      <td style={{ ...td, fontSize: 12 }}>
        {!h.strategy_name ? (
          <span style={{ color: DIM }}>—</span>
        ) : !c ? (
          <span style={{ color: DIM }}>첫 매수일을 넣으면 비교</span>
        ) : c.strategy_holding ? (
          <>
            <div>
              전략 {c.strategy_date} {money(c.strategy_price!, h.ticker)}
            </div>
            <div>
              실제 {c.actual_date} {money(c.actual_price, h.ticker)}
            </div>
            <div
              style={{
                color: c.price_diff_pct != null && c.price_diff_pct > 0 ? NEGATIVE : POSITIVE,
              }}
            >
              {c.price_diff_pct != null && `${pct(c.price_diff_pct)} `}
              <span style={{ color: DIM }}>· {c.days_late}거래일 뒤</span>
            </div>
          </>
        ) : (
          <span style={{ color: CAUTION }}>산 날 전략은 관망 중{c.strategy_date ? ` (전략 매수 ${c.strategy_date})` : ""}</span>
        )}
      </td>
      <td style={{ ...td, textAlign: "right" }}>
        <button type="button" onClick={onEdit} style={btn(false)}>
          {editing ? "닫기" : "설정"}
        </button>
      </td>
    </tr>
  );
}

const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

function RuleEditor({
  h,
  strategies,
  onSaved,
  onDeleted,
}: {
  h: HoldingStatus;
  strategies: StrategyInfo[];
  onSaved: () => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const [strategyName, setStrategyName] = useState(h.strategy_name ?? "");
  const [params, setParams] = useState<Record<string, number>>(h.params ?? {});
  const [stop, setStop] = useState(h.stop_loss_pct?.toString() ?? "");
  const [target, setTarget] = useState(h.target_pct?.toString() ?? "");
  const [trailing, setTrailing] = useState(h.trailing_pct?.toString() ?? "");
  const [firstBuy, setFirstBuy] = useState(h.first_buy_date ?? "");
  const [qty, setQty] = useState(String(h.quantity));
  const [avg, setAvg] = useState(String(h.avg_price));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const strategy = strategies.find((s) => s.name === strategyName) ?? null;
  const manual = h.source === "manual";

  const pick = (name: string) => {
    setStrategyName(name);
    const s = strategies.find((x) => x.name === name);
    setParams(Object.fromEntries((s?.params ?? []).map((p) => [p.name, p.default])));
  };

  const save = async () => {
    setBusy(true);
    setError("");
    const req: HoldingRulesUpdate = {
      strategy_name: strategyName || null,
      params: strategyName ? params : null,
      backtest_id: strategyName === h.strategy_name ? h.backtest_id : null,
      stop_loss_pct: numOrNull(stop),
      target_pct: numOrNull(target),
      trailing_pct: numOrNull(trailing),
      first_buy_date: firstBuy || null,
      ...(manual ? { quantity: numOrNull(qty), avg_price: numOrNull(avg) } : {}),
    };
    try {
      await updateHolding(h.id, req);
      await onSaved();
    } catch (err: unknown) {
      setError(errMessage(err));
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await deleteHolding(h.id);
      await onDeleted();
    } catch (err: unknown) {
      setError(errMessage(err));
      setBusy(false);
    }
  };

  const field = (label: string, el: React.ReactNode, hint?: string) => (
    <label style={{ color: MUTED, fontSize: 12 }} title={hint}>
      {label}
      <div style={{ marginTop: 4 }}>{el}</div>
    </label>
  );

  return (
    <div style={{ paddingTop: 10 }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "flex-end",
        }}
      >
        {field(
          "전략 청산",
          <select value={strategyName} onChange={(e) => pick(e.target.value)} style={input}>
            <option value="">쓰지 않음</option>
            {strategies.map((s) => (
              <option key={s.name} value={s.name}>
                {s.display_name}
              </option>
            ))}
          </select>,
          "이 전략이 관망(SELL)으로 바뀌면 걸린다"
        )}
        {strategy?.params.map((p) => (
          <Fragment key={p.name}>
            {field(
              paramLabel(p.name),
              <input
                type="number"
                value={params[p.name] ?? p.default}
                min={p.min}
                max={p.max}
                step={p.type === "float" ? 0.1 : 1}
                onChange={(e) => setParams((x) => ({ ...x, [p.name]: Number(e.target.value) }))}
                style={{ ...input, width: 80 }}
              />,
              p.description
            )}
          </Fragment>
        ))}
        {field(
          "손절 -%",
          <input
            type="number"
            min={0}
            value={stop}
            onChange={(e) => setStop(e.target.value)}
            placeholder="없음"
            style={{ ...input, width: 70 }}
          />,
          "평균단가 대비"
        )}
        {field(
          "목표 +%",
          <input
            type="number"
            min={0}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="없음"
            style={{ ...input, width: 70 }}
          />,
          "평균단가 대비"
        )}
        {field(
          "트레일링 -%",
          <input
            type="number"
            min={0}
            value={trailing}
            onChange={(e) => setTrailing(e.target.value)}
            placeholder="없음"
            style={{ ...input, width: 70 }}
          />,
          "첫 매수 뒤 최고 종가 대비"
        )}
        {field(
          "첫 매수일",
          <input
            type="date"
            value={firstBuy}
            onChange={(e) => setFirstBuy(e.target.value)}
            style={{ ...input, colorScheme: "dark" }}
          />,
          "KIS 체결 내역(3개월)으로 못 찾으면 직접 넣는다. 트레일링 고점과 전략 비교의 기준"
        )}
        {manual &&
          field(
            "수량",
            <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} style={{ ...input, width: 80 }} />
          )}
        {manual &&
          field(
            "평균단가",
            <input type="number" value={avg} onChange={(e) => setAvg(e.target.value)} style={{ ...input, width: 100 }} />
          )}
        <button type="button" onClick={save} disabled={busy} style={btn(true, busy)}>
          저장
        </button>
        {manual && (
          <button type="button" onClick={remove} disabled={busy} style={btn(false)}>
            삭제
          </button>
        )}
      </div>
      {error && <p style={{ color: NEGATIVE, fontSize: 12, margin: "8px 0 0" }}>{error}</p>}
      {!manual && <p style={{ color: DIM, fontSize: 11, margin: "8px 0 0" }}>수량·평균단가는 KIS 잔고를 따릅니다.</p>}
    </div>
  );
}

function ManualAdd({ onAdded }: { onAdded: () => Promise<unknown> }) {
  const [ticker, setTicker] = useState("");
  const [qty, setQty] = useState("");
  const [avg, setAvg] = useState("");
  const [firstBuy, setFirstBuy] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const ok = ticker.trim() !== "" && Number(qty) > 0 && Number(avg) > 0;

  const submit = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await addHolding({
        ticker: ticker.trim(),
        quantity: Number(qty),
        avg_price: Number(avg),
        first_buy_date: firstBuy || null,
      });
      await onAdded();
      setMsg({
        text: `추가했습니다: ${r.data.ticker} — "설정"에서 청산 규칙을 거세요`,
        error: false,
      });
      setTicker("");
      setQty("");
      setAvg("");
      setFirstBuy("");
    } catch (err: unknown) {
      setMsg({ text: errMessage(err), error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ borderTop: `1px solid ${GRID}`, paddingTop: 12, marginTop: 14 }}>
      <div style={{ color: MUTED, fontSize: 12, marginBottom: 6 }}>직접 입력 (KIS 밖의 보유분)</div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
        }}
      >
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          placeholder="AAPL, 005930.KS"
          style={{ ...input, width: 130 }}
        />
        <input
          type="number"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          placeholder="수량"
          style={{ ...input, width: 80 }}
        />
        <input
          type="number"
          value={avg}
          onChange={(e) => setAvg(e.target.value)}
          placeholder="평균단가"
          style={{ ...input, width: 110 }}
        />
        <input
          type="date"
          value={firstBuy}
          onChange={(e) => setFirstBuy(e.target.value)}
          title="첫 매수일 (선택)"
          style={{ ...input, colorScheme: "dark" }}
        />
        <button type="button" onClick={submit} disabled={busy || !ok} style={btn(true, busy || !ok)}>
          {busy ? "추가 중…" : "보유 종목 추가"}
        </button>
      </div>
      {msg && (
        <p
          style={{
            color: msg.error ? NEGATIVE : MUTED,
            fontSize: 12,
            margin: "6px 0 0",
          }}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}
