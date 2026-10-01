import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { SignalEvent, SignalsOverview, StrategyInfo, WatchStatus } from "../types";
import { addWatch, checkSignals, deleteWatch, getSignals, listStrategies } from "../api/client";
import { errMessage } from "../utils/error";
import { CAUTION, NEGATIVE, POSITIVE } from "../theme";
import { currencyOf, fmtMoney } from "../utils/money";
import { fmtParam, paramLabel } from "../utils/params";

const MUTED = "#94a3b8";
const DIM = "#64748b";
const INK = "#e2e8f0";
const GRID = "#334155";
const PANEL: React.CSSProperties = { background: "#1e1e2e", borderRadius: 8, padding: 20, marginBottom: 24 };

/** 서버는 UTC 를 시간대 없이 보낸다. */
const localTime = (utc: string) =>
  new Date(utc.endsWith("Z") ? utc : `${utc}Z`).toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

const price = (v: number, ticker: string) => fmtMoney(v, currencyOf(ticker), currencyOf(ticker) === "KRW" ? 0 : 2);
const pct = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
const paramsText = (p: Record<string, number>) =>
  Object.entries(p).map(([k, v]) => `${paramLabel(k)} ${fmtParam(v)}`).join(" · ");
/** 날짜 사이 평일 수. 감지가 며칠 늦었는지 대략 보여 주는 데만 쓴다(휴장일은 모른다). */
const weekdaysBetween = (from: string, to: string) => {
  let n = 0;
  const d = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  while (d < end) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) n++;
  }
  return n;
};

function ActionBadge({ action }: { action: "BUY" | "SELL" }) {
  const buy = action === "BUY";
  return (
    <span
      style={{
        color: buy ? POSITIVE : NEGATIVE,
        border: `1px solid ${buy ? POSITIVE : NEGATIVE}`,
        borderRadius: 4,
        padding: "1px 6px",
        fontSize: 11,
        fontWeight: 700,
      }}
    >
      {buy ? "▲ BUY" : "▼ SELL"}
    </span>
  );
}

/**
 * 워치리스트의 매매 신호. 판정은 백테스트와 같은 코드로 하고(지표 준비 구간 포함), 일봉 종가
 * 기준이라 장 마감 뒤 하루 한 번 의미가 있다. 감지한 신호는 그때의 값 그대로 기록에 남는다.
 */
export default function Signals() {
  const [data, setData] = useState<SignalsOverview | null>(null);
  const [loadError, setLoadError] = useState("");
  const [checking, setChecking] = useState(false);
  const [actionError, setActionError] = useState("");

  const load = useCallback(
    () =>
      getSignals()
        .then((r) => {
          setData(r.data);
          setLoadError("");
        })
        .catch((err: unknown) => setLoadError(errMessage(err, "신호를 불러오지 못했습니다"))),
    []
  );

  useEffect(() => {
    load();
  }, [load]);

  const check = async () => {
    setChecking(true);
    setActionError("");
    try {
      await checkSignals();
      await load();
    } catch (err: unknown) {
      setActionError(errMessage(err));
    } finally {
      setChecking(false);
    }
  };

  const remove = async (w: WatchStatus) => {
    setActionError("");
    try {
      await deleteWatch(w.id);
      await load();
    } catch (err: unknown) {
      setActionError(errMessage(err));
    }
  };

  const fresh = data?.watches.filter((w) => w.is_new) ?? [];
  const run = data?.last_run;

  return (
    <div>
      <div style={{ color: DIM, fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>
        Signals · 매매 신호 모니터링
      </div>
      <h2 style={{ color: INK, margin: "0 0 6px" }}>워치리스트 신호</h2>
      <p style={{ color: DIM, fontSize: 13, margin: "0 0 16px", lineHeight: 1.6 }}>
        감시할 종목·전략·파라미터 조합을 백테스트와 같은 코드로 매일 판정합니다. 일봉 종가 기준이라 신호가 난 날 종가로
        계산되며, 실제로는 다음 거래일 시가 근처에서 체결하게 됩니다. 장이 끝난 날의 봉까지만 받으므로 장중에 확인해도
        미완성 봉으로 판정하지 않습니다.
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <button
          type="button"
          onClick={check}
          disabled={checking || !data?.watches.length}
          style={{
            background: checking || !data?.watches.length ? GRID : "#3b82f6",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            padding: "8px 18px",
            fontSize: 14,
            fontWeight: 600,
            cursor: checking ? "wait" : "pointer",
          }}
        >
          {checking ? "확인 중…" : "지금 확인"}
        </button>
        <span style={{ color: MUTED, fontSize: 13 }}>
          {run?.finished_at
            ? `마지막 확인 ${localTime(run.finished_at)} (${run.source === "schedule" ? "자동" : "수동"}) · ${run.tickers}종목 · 새 신호 ${run.new_events}건`
            : "아직 확인한 적이 없습니다"}
          {run && run.failed.length > 0 && <span style={{ color: CAUTION }}> · 실패 {run.failed.length}건</span>}
        </span>
        <span style={{ color: DIM, fontSize: 12 }}>자동 확인: 매일 07:10(미국장 마감 뒤) · 16:40(한국장 마감 뒤)</span>
      </div>
      {run && run.failed.length > 0 && (
        <div style={{ color: CAUTION, fontSize: 12, margin: "-12px 0 16px" }}>
          {run.failed.map((f) => (
            <div key={`${f.ticker}${f.error}`}>
              {f.ticker}: {f.error}
            </div>
          ))}
        </div>
      )}
      {(loadError || actionError) && <p style={{ color: NEGATIVE, fontSize: 13 }}>{loadError || actionError}</p>}

      {fresh.length > 0 && (
        <div style={{ ...PANEL, border: `1px solid ${CAUTION}` }}>
          <h3 style={{ color: INK, margin: "0 0 10px", fontSize: 16 }}>마지막 거래일에 난 신호</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
            {fresh.map((w) => (
              <div key={w.id} style={{ background: "#0f172a", border: `1px solid ${GRID}`, borderRadius: 8, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ color: INK, fontWeight: 700 }}>{w.ticker}</span>
                  <ActionBadge action={w.last_signal!.action} />
                </div>
                <div style={{ color: MUTED, fontSize: 12 }}>{w.display_name}</div>
                <div style={{ color: INK, fontSize: 13, marginTop: 6 }}>
                  {w.last_signal!.date} 종가 {price(w.last_signal!.price, w.ticker)}
                </div>
                <div style={{ color: DIM, fontSize: 12, marginTop: 2 }}>다음 거래일 시가 근처에서 체결</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={PANEL}>
        <h3 style={{ color: INK, margin: "0 0 4px", fontSize: 16 }}>워치리스트</h3>
        <p style={{ color: DIM, fontSize: 12, margin: "0 0 12px" }}>
          Tear Sheet 의 "Signals에 추가"나 아래 입력으로 더합니다. 상태는 같은 파라미터의 백테스트가 지금 보유 중인지입니다.
        </p>
        {data && data.watches.length === 0 && <p style={{ color: MUTED, fontSize: 13 }}>감시 중인 조합이 없습니다.</p>}
        {data && data.watches.length > 0 && <WatchTable watches={data.watches} onRemove={remove} />}
        <AddWatchForm onAdded={load} />
      </div>

      <div style={PANEL}>
        <h3 style={{ color: INK, margin: "0 0 4px", fontSize: 16 }}>감지한 신호</h3>
        <p style={{ color: DIM, fontSize: 12, margin: "0 0 12px" }}>
          감시를 시작한 뒤에 감지한 매매 신호를 감지한 그때의 값으로 남깁니다. 야후가 배당·분할로 과거 가격을 고치면 다시
          계산한 신호와 달라질 수 있는데, 여기에는 실제로 본 값이 남습니다.
        </p>
        {data && data.events.length === 0 ? (
          <p style={{ color: MUTED, fontSize: 13 }}>아직 감지한 신호가 없습니다.</p>
        ) : (
          data && <EventTable events={data.events} />
        )}
      </div>
    </div>
  );
}

const th: React.CSSProperties = { color: MUTED, fontWeight: 600, padding: "8px 10px", whiteSpace: "nowrap", textAlign: "left" };
const td: React.CSSProperties = { padding: "8px 10px", color: INK, verticalAlign: "top" };
const num: React.CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
const smallBtn = (color: string): React.CSSProperties => ({
  background: "transparent",
  border: `1px solid ${GRID}`,
  borderRadius: 6,
  color,
  padding: "3px 10px",
  fontSize: 12,
  cursor: "pointer",
  whiteSpace: "nowrap",
  textDecoration: "none",
});

function WatchTable({ watches, onRemove }: { watches: WatchStatus[]; onRemove: (w: WatchStatus) => void }) {
  return (
    <div style={{ overflowX: "auto", marginBottom: 16 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${GRID}` }}>
            <th style={th}>종목</th>
            <th style={th}>전략</th>
            <th style={th}>상태</th>
            <th style={th}>마지막 신호</th>
            <th style={{ ...th, textAlign: "right" }} title="마지막 신호 뒤 지난 거래일">경과</th>
            <th style={{ ...th, textAlign: "right" }} title="보유 중이면 진입 후, 관망이면 청산 후 종가 변화">그 뒤 변화</th>
            <th style={th}>마지막 시세</th>
            <th style={th} />
          </tr>
        </thead>
        <tbody>
          {watches.map((w) => {
            const stale = w.last_bar_date !== null && w.last_bar_date < w.expected_bar_date;
            return (
              <tr key={w.id} style={{ borderBottom: "1px solid #1e293b", background: w.is_new ? "rgba(234, 179, 8, 0.06)" : undefined }}>
                <td style={td}>
                  <Link to={`/data/${w.ticker}`} style={{ color: INK, fontWeight: 600, textDecoration: "none" }}>
                    {w.ticker}
                  </Link>
                  {w.name && <div style={{ color: DIM, fontSize: 11 }}>{w.name}</div>}
                </td>
                <td style={td}>
                  {w.display_name}
                  <div style={{ color: DIM, fontSize: 11 }}>{paramsText(w.params)}</div>
                </td>
                <td style={td}>
                  {w.error ? (
                    <span style={{ color: NEGATIVE, fontSize: 12 }}>{w.error}</span>
                  ) : w.position === "long" ? (
                    <span style={{ color: POSITIVE, fontWeight: 600 }}>● 보유 중</span>
                  ) : (
                    <span style={{ color: MUTED }}>○ 관망</span>
                  )}
                </td>
                <td style={td}>
                  {w.last_signal ? (
                    <>
                      <ActionBadge action={w.last_signal.action} />{" "}
                      <span style={{ marginLeft: 4 }}>{w.last_signal.date}</span>
                      <div style={{ color: DIM, fontSize: 11 }}>종가 {price(w.last_signal.price, w.ticker)}</div>
                    </>
                  ) : (
                    <span style={{ color: DIM }}>—</span>
                  )}
                </td>
                <td style={num}>{w.bars_since == null ? "—" : w.bars_since === 0 ? "오늘" : `${w.bars_since}일`}</td>
                <td style={{ ...num, color: w.since_return == null ? DIM : w.since_return >= 0 ? POSITIVE : NEGATIVE }}>
                  {w.since_return == null ? "—" : pct(w.since_return)}
                  {w.since_return != null && (
                    <div style={{ color: DIM, fontSize: 11 }}>{w.position === "long" ? "진입 후" : "청산 후"}</div>
                  )}
                </td>
                <td style={td}>
                  {w.last_bar_date ?? "—"}
                  {w.last_close != null && <div style={{ color: DIM, fontSize: 11 }}>{price(w.last_close, w.ticker)}</div>}
                  {stale && (
                    <div style={{ color: CAUTION, fontSize: 11 }} title="휴장일이면 정상입니다">
                      {w.expected_bar_date} 봉 없음
                    </div>
                  )}
                </td>
                <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                  {w.backtest_id && (
                    <Link to={`/results/${w.backtest_id}`} style={{ ...smallBtn("#3b82f6"), marginRight: 6 }}>
                      Tear Sheet
                    </Link>
                  )}
                  <button type="button" onClick={() => onRemove(w)} style={smallBtn(MUTED)} title="감지한 신호 기록도 함께 지워집니다">
                    삭제
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EventTable({ events }: { events: SignalEvent[] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${GRID}` }}>
            <th style={th}>신호일</th>
            <th style={th}>종목</th>
            <th style={th}>전략</th>
            <th style={th}>매매</th>
            <th style={{ ...th, textAlign: "right" }}>종가</th>
            <th style={th} title="신호가 난 봉을 언제 처음 봤는지">감지</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => {
            const late = weekdaysBetween(e.date, e.seen_bar_date);
            return (
              <tr key={e.id} style={{ borderBottom: "1px solid #1e293b" }}>
                <td style={td}>{e.date}</td>
                <td style={{ ...td, fontWeight: 600 }}>{e.ticker}</td>
                <td style={td}>
                  {e.display_name}
                  <div style={{ color: DIM, fontSize: 11 }}>{paramsText(e.params)}</div>
                </td>
                <td style={td}>
                  <ActionBadge action={e.action} />
                </td>
                <td style={num}>{price(e.price, e.ticker)}</td>
                <td style={{ ...td, color: late > 0 ? CAUTION : MUTED, fontSize: 12 }}>
                  {late > 0 ? `${late}거래일 늦게` : "당일"} · {localTime(e.detected_at)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AddWatchForm({ onAdded }: { onAdded: () => Promise<unknown> }) {
  const [strategies, setStrategies] = useState<StrategyInfo[]>([]);
  const [ticker, setTicker] = useState("");
  const [strategyName, setStrategyName] = useState("");
  const [params, setParams] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    listStrategies()
      .then((r) => setStrategies(r.data.filter((s) => s.name !== "buy_and_hold")))
      .catch(() => {});
  }, []);

  const strategy = strategies.find((s) => s.name === strategyName) ?? null;

  const pick = (name: string) => {
    setStrategyName(name);
    const s = strategies.find((x) => x.name === name);
    setParams(Object.fromEntries((s?.params ?? []).map((p) => [p.name, p.default])));
  };

  const submit = async () => {
    if (!ticker.trim() || !strategy) return;
    setBusy(true);
    setMessage(null);
    try {
      const r = await addWatch({ ticker: ticker.trim(), strategy_name: strategy.name, params });
      await onAdded();
      setMessage({ text: `추가했습니다: ${r.data.ticker} ${r.data.display_name}`, error: false });
      setTicker("");
    } catch (err: unknown) {
      setMessage({ text: errMessage(err), error: true });
    } finally {
      setBusy(false);
    }
  };

  const input: React.CSSProperties = {
    background: "#0f172a",
    border: `1px solid ${GRID}`,
    borderRadius: 6,
    color: INK,
    padding: "6px 10px",
    fontSize: 13,
  };

  return (
    <div style={{ borderTop: `1px solid ${GRID}`, paddingTop: 14 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
        <label style={{ color: MUTED, fontSize: 12 }}>
          종목
          <input
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            placeholder="AAPL, 005930.KS"
            style={{ ...input, display: "block", width: 140, marginTop: 4 }}
          />
        </label>
        <label style={{ color: MUTED, fontSize: 12 }}>
          전략
          <select value={strategyName} onChange={(e) => pick(e.target.value)} style={{ ...input, display: "block", marginTop: 4 }}>
            <option value="">선택</option>
            {strategies.map((s) => (
              <option key={s.name} value={s.name}>
                {s.display_name}
              </option>
            ))}
          </select>
        </label>
        {strategy?.params.map((p) => (
          <label key={p.name} style={{ color: MUTED, fontSize: 12 }} title={p.description}>
            {paramLabel(p.name)}
            <input
              type="number"
              value={params[p.name] ?? p.default}
              min={p.min}
              max={p.max}
              step={p.type === "float" ? 0.1 : 1}
              onChange={(e) => setParams((x) => ({ ...x, [p.name]: Number(e.target.value) }))}
              style={{ ...input, display: "block", width: 90, marginTop: 4 }}
            />
          </label>
        ))}
        <button
          type="button"
          onClick={submit}
          disabled={busy || !ticker.trim() || !strategy}
          style={{
            background: busy || !ticker.trim() || !strategy ? GRID : "#3b82f6",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            padding: "8px 16px",
            fontSize: 13,
            fontWeight: 600,
            cursor: busy ? "wait" : "pointer",
          }}
        >
          {busy ? "추가 중…" : "워치리스트에 추가"}
        </button>
      </div>
      {message && (
        <p style={{ color: message.error ? NEGATIVE : MUTED, fontSize: 12, margin: "8px 0 0" }}>{message.text}</p>
      )}
      <p style={{ color: DIM, fontSize: 11, margin: "6px 0 0" }}>
        시세가 없는 종목은 추가할 때 받습니다(몇 초). 파라미터는 백테스트로 확인한 값을 넣는 것을 권합니다.
      </p>
    </div>
  );
}
