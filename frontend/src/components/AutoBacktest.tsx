import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type {
  AutoBacktestRequest,
  AutoBacktestResponse,
  AutoStrategyResult,
  StrategyInfo,
  TickerInfo,
} from "../types";
import { listStrategies, listTickers, runAutoBacktest, runBacktest } from "../api/client";
import { errMessage } from "../utils/error";
import { POSITIVE, NEGATIVE, SERIES_COLORS } from "../theme";
import AutoReturnChart, { BENCHMARK_COLOR, Swatch, type ChartSeries } from "./AutoReturnChart";
import { AMOUNT_DEFAULTS, SYMBOL, currencyOf, fmtMoney } from "../utils/money";
import { DEFAULT_TICKER } from "../utils/defaults";
import { WINDOW_OPTIONS, rollingVsBenchmark, windowAllowed } from "../utils/rolling";

const MUTED = "#94a3b8";
const INK = "#e2e8f0";
const GRID = "#334155";
const YEARS = 5;
const BENCHMARK = "buy_and_hold";
/**
 * 그래프에 색으로 그릴 전략 수의 상한. SERIES_COLORS 앞 4색은 다크 배경에서 모든 쌍이
 * 색각이상 검증(ΔE ≥ 8)을 통과하지만 5색부터는 통과하지 못한다. 기본은 상위 3개다.
 */
const MAX_PLOTTED = 4;
const DEFAULT_PLOTTED = 3;

/** 파라미터 값 표기. 2.0 같은 실수는 2로 줄인다. */
const fmtParam = (v: number) => (Number.isInteger(v) ? String(v) : String(Number(v.toFixed(4))));

/** 표 한 줄. 롤링 지표는 구간 길이에 따라 화면에서 계산하며, B&H 자신은 null이다. */
type Row = AutoStrategyResult & { roll_win: number | null; roll_excess: number | null };

type SortKey = keyof Pick<
  Row,
  "roll_win" | "roll_excess" | "total_return" | "cagr" | "sharpe_ratio" | "max_drawdown" | "win_rate" | "trades_count"
>;

/** 오름차순이 더 좋은 지표. MDD는 작을수록 낫다. */
const ASCENDING_BETTER: SortKey[] = ["max_drawdown"];

const COLUMNS: { key: SortKey; label: string; fmt: (v: number) => string; signed?: boolean; title?: string }[] = [
  {
    key: "roll_win", label: "B&H 승률", fmt: (v) => `${v.toFixed(0)}%`,
    title: "같은 길이 구간을 한 주씩 밀어 가며 잘랐을 때 B&H보다 수익이 높았던 구간 비율",
  },
  {
    key: "roll_excess", label: "초과 중앙값", fmt: (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%p`, signed: true,
    title: "그 구간들에서 B&H 대비 초과수익의 중앙값",
  },
  { key: "total_return", label: "총수익률", fmt: (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`, signed: true,
    title: "오늘(마지막 거래일) 기준. 끝 날짜에 따라 크게 달라진다" },
  { key: "cagr", label: "CAGR", fmt: (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`, signed: true },
  { key: "sharpe_ratio", label: "Sharpe", fmt: (v) => v.toFixed(2) },
  { key: "max_drawdown", label: "MDD", fmt: (v) => `-${v.toFixed(1)}%` },
  { key: "win_rate", label: "매매 승률", fmt: (v) => `${v.toFixed(0)}%` },
  { key: "trades_count", label: "거래", fmt: (v) => String(v) },
];

/**
 * Auto 모드: 한 종목에 등록된 전략 전부를 기본 파라미터로 최근 5년 돌려 비교한다.
 * 결과는 저장하지 않고, "상세 보기"를 누른 전략만 /run 으로 다시 돌려 저장한다.
 */
export default function AutoBacktest() {
  const navigate = useNavigate();
  const [tickers, setTickers] = useState<TickerInfo[]>([]);
  const [ticker, setTicker] = useState(DEFAULT_TICKER);
  const [investMode, setInvestMode] = useState<"lump_sum" | "dca">("lump_sum");
  // 금액은 통화별로 따로 들고 있는다. 종목을 AAPL ↔ 005930.KS로 바꿔도 각자 입력값이 남는다.
  const [amounts, setAmounts] = useState(() => ({
    USD: { capital: AMOUNT_DEFAULTS.USD.capital, monthly: AMOUNT_DEFAULTS.USD.monthly },
    KRW: { capital: AMOUNT_DEFAULTS.KRW.capital, monthly: AMOUNT_DEFAULTS.KRW.monthly },
  }));
  const currency = currencyOf(ticker);
  const unit = AMOUNT_DEFAULTS[currency];
  const capital = amounts[currency].capital;
  const monthlyContribution = amounts[currency].monthly;
  const setCapital = (v: number) =>
    setAmounts((prev) => ({ ...prev, [currency]: { ...prev[currency], capital: v } }));
  const setMonthlyContribution = (v: number) =>
    setAmounts((prev) => ({ ...prev, [currency]: { ...prev[currency], monthly: v } }));

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // 표에 보이는 결과를 만든 요청. 상세 보기는 폼이 바뀌었어도 이 조건으로 돌린다.
  const [ran, setRan] = useState<{ req: AutoBacktestRequest; res: AutoBacktestResponse } | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("roll_win");
  const [windowWeeks, setWindowWeeks] = useState(52);
  const [opening, setOpening] = useState<string | null>(null);
  const [strategies, setStrategies] = useState<StrategyInfo[]>([]);
  // 그래프에 켠 전략 → 색 번호. 색은 순위가 아니라 전략에 붙는다 — 다른 전략을 켜고 꺼도
  // 이미 켜진 선의 색은 바뀌지 않는다.
  const [plotted, setPlotted] = useState<Record<string, number>>({});
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    listStrategies().then((r) => setStrategies(r.data));
    listTickers().then((r) => {
      setTickers(r.data);
    });
  }, []);

  const tickerName = tickers.find((t) => t.ticker === ticker)?.name;

  const handleRun = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticker) return;
    const req: AutoBacktestRequest = {
      ticker,
      years: YEARS,
      invest_mode: investMode,
      initial_capital: investMode === "lump_sum" ? capital : 0,
      monthly_contribution: investMode === "dca" ? monthlyContribution : 0,
    };
    setLoading(true);
    setError("");
    try {
      const res = await runAutoBacktest(req);
      setRan({ req, res: res.data });
      // 그래프 기본 선택도 표의 기본 순위(롤링 B&H 승률)를 따른다. 구간 길이를 나중에 바꿔도
      // 선택은 다시 고르지 않는다 — 켜 둔 선의 색이 바뀌지 않게 하기 위해서다.
      const bench = res.data.results.find((r) => r.strategy_name === BENCHMARK);
      const points = res.data.results[0]?.curve.length ?? 0;
      const weeks = windowAllowed(windowWeeks, points)
        ? windowWeeks
        : [...WINDOW_OPTIONS].reverse().find((w) => windowAllowed(w.weeks, points))?.weeks;
      const score = (r: AutoStrategyResult) =>
        bench && weeks ? (rollingVsBenchmark(r.curve, bench.curve, weeks)?.winRate ?? -1) : r.total_return;
      const top = res.data.results
        .filter((r) => r.strategy_name !== BENCHMARK)
        .sort((a, b) => score(b) - score(a))
        .slice(0, DEFAULT_PLOTTED);
      setPlotted(Object.fromEntries(top.map((r, i) => [r.strategy_name, i])));
    } catch (err: unknown) {
      setError(errMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const openDetail = async (row: AutoStrategyResult) => {
    if (!ran) return;
    setOpening(row.strategy_name);
    setError("");
    try {
      const res = await runBacktest({
        ticker: ran.res.ticker,
        strategy_name: row.strategy_name,
        params: row.params,
        start_date: ran.res.start_date,
        end_date: ran.res.end_date,
        invest_mode: ran.req.invest_mode,
        initial_capital: ran.req.initial_capital,
        monthly_contribution: ran.req.monthly_contribution,
      });
      navigate(`/results/${res.data.id}`, { state: res.data });
    } catch (err: unknown) {
      setError(errMessage(err));
      setOpening(null);
    }
  };

  // 데이터가 짧으면(상장이 늦은 종목) 고른 길이를 못 쓸 수 있다. 쓸 수 있는 가장 긴 길이로 내린다.
  const curvePoints = ran?.res.results[0]?.curve.length ?? 0;
  const effectiveWeeks = windowAllowed(windowWeeks, curvePoints)
    ? windowWeeks
    : ([...WINDOW_OPTIONS].reverse().find((w) => windowAllowed(w.weeks, curvePoints))?.weeks ?? null);
  const windowLabel = WINDOW_OPTIONS.find((w) => w.weeks === effectiveWeeks)?.label ?? "";

  const { rows, windows } = useMemo(() => {
    if (!ran) return { rows: [] as Row[], windows: 0 };
    const bench = ran.res.results.find((r) => r.strategy_name === BENCHMARK);
    let count = 0;
    const withRolling: Row[] = ran.res.results.map((r) => {
      const stats =
        bench && effectiveWeeks && r.strategy_name !== BENCHMARK
          ? rollingVsBenchmark(r.curve, bench.curve, effectiveWeeks)
          : null;
      if (stats) count = stats.windows;
      return { ...r, roll_win: stats?.winRate ?? null, roll_excess: stats?.medianExcess ?? null };
    });
    const asc = ASCENDING_BETTER.includes(sortKey);
    // 값이 없는 줄(B&H 자신, 구간 부족)은 정렬 방향과 상관없이 맨 아래로 보낸다.
    const sorted = withRolling.sort((a, b) => {
      const x = a[sortKey];
      const y = b[sortKey];
      if (x === null) return y === null ? 0 : 1;
      if (y === null) return -1;
      return asc ? x - y : y - x;
    });
    return { rows: sorted, windows: count };
  }, [ran, sortKey, effectiveWeeks]);

  const togglePlot = (name: string) =>
    setPlotted((prev) => {
      if (name in prev) {
        const next = { ...prev };
        delete next[name];
        return next;
      }
      const used = new Set(Object.values(prev));
      const free = [...Array(MAX_PLOTTED).keys()].find((i) => !used.has(i));
      return free === undefined ? prev : { ...prev, [name]: free };
    });

  const chartSeries: ChartSeries[] = useMemo(() => {
    if (!ran) return [];
    const out: ChartSeries[] = [];
    const bench = ran.res.results.find((r) => r.strategy_name === BENCHMARK);
    if (bench) out.push({ result: bench, color: BENCHMARK_COLOR, benchmark: true });
    for (const r of ran.res.results) {
      if (r.strategy_name in plotted) out.push({ result: r, color: SERIES_COLORS[plotted[r.strategy_name]] });
    }
    return out;
  }, [ran, plotted]);
  const plotFull = Object.keys(plotted).length >= MAX_PLOTTED;

  // 적립식의 cagr 값은 입금 시점을 반영한 연환산 수익률(IRR)이다.
  const colLabel = (key: SortKey, label: string) =>
    key === "cagr" && ran?.res.invest_mode === "dca" ? "IRR" : label;

  const paramInfo = (name: string) => strategies.find((s) => s.name === name)?.params ?? [];

  const ranName = ran && tickers.find((t) => t.ticker === ran.res.ticker)?.name;
  const benchmark = ran?.res.results.find((r) => r.strategy_name === BENCHMARK);
  // 판정 기준은 롤링 승률이다. 오늘 기준 총수익률은 참고로만 보여 준다.
  const beating = rows.filter((r) => r.roll_win !== null && r.roll_win > 50).length;
  const beatingToday = benchmark
    ? rows.filter((r) => r.strategy_name !== BENCHMARK && r.total_return > benchmark.total_return).length
    : 0;

  const inputStyle: React.CSSProperties = {
    background: "#0f172a",
    border: `1px solid ${GRID}`,
    borderRadius: 6,
    color: INK,
    padding: "8px 12px",
    fontSize: 14,
    width: "100%",
  };
  const labelStyle: React.CSSProperties = { color: MUTED, fontSize: 13, marginBottom: 4, display: "block" };
  const modeButtonStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: "8px 12px",
    border: active ? "2px solid #3b82f6" : `1px solid ${GRID}`,
    borderRadius: 8,
    background: active ? "rgba(59, 130, 246, 0.1)" : "#0f172a",
    color: active ? "#3b82f6" : "#64748b",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  });

  return (
    <>
      <form onSubmit={handleRun} style={{ background: "#1e1e2e", borderRadius: 8, padding: 24, marginBottom: 24 }}>
        <h3 style={{ color: INK, marginBottom: 4 }}>전략 비교</h3>
        <p style={{ color: "#64748b", fontSize: 13, marginBottom: 16 }}>
          종목 하나에 등록된 모든 전략을 기본 파라미터로 최근 {YEARS}년(오늘 기준) 돌려 비교합니다.
          결과는 저장되지 않습니다.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginBottom: 16 }}>
          <div>
            <label style={labelStyle}>Ticker</label>
            <input
              list="auto-ticker-list"
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              placeholder="e.g. AAPL"
              style={inputStyle}
            />
            <datalist id="auto-ticker-list">
              {tickers.map((t) => (
                <option key={t.ticker} value={t.ticker}>{t.name ?? ""}</option>
              ))}
            </datalist>
            {tickerName && <p style={{ color: "#64748b", fontSize: 12, marginTop: 4 }}>{tickerName}</p>}
          </div>

          <div>
            <label style={labelStyle}>Investment Mode</label>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={() => setInvestMode("lump_sum")} style={modeButtonStyle(investMode === "lump_sum")}>
                거치식
              </button>
              <button type="button" onClick={() => setInvestMode("dca")} style={modeButtonStyle(investMode === "dca")}>
                적립식
              </button>
            </div>
          </div>

          <div>
            {investMode === "lump_sum" ? (
              <>
                <label style={labelStyle}>Initial Capital ({SYMBOL[currency]})</label>
                <input type="number" value={capital} min={unit.capitalMin} step={unit.capitalStep}
                  onChange={(e) => setCapital(Number(e.target.value))} style={inputStyle} />
              </>
            ) : (
              <>
                <label style={labelStyle}>Monthly Contribution ({SYMBOL[currency]})</label>
                <input type="number" value={monthlyContribution} min={unit.monthlyMin} step={unit.monthlyStep}
                  onChange={(e) => setMonthlyContribution(Number(e.target.value))} style={inputStyle} />
              </>
            )}
          </div>
        </div>

        <button
          type="submit"
          disabled={loading || !ticker}
          style={{
            background: loading ? GRID : "#3b82f6",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            padding: "10px 24px",
            fontSize: 15,
            fontWeight: 600,
            cursor: loading ? "wait" : "pointer",
          }}
        >
          {loading ? "비교 중..." : "전략 비교"}
        </button>
      </form>

      {error && (
        <div style={{ background: "#7f1d1d", color: INK, padding: "10px 16px", borderRadius: 6, fontSize: 14, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {ran && (
        <div style={{ background: "#1e1e2e", borderRadius: 8, padding: 24 }}>
          <h3 style={{ color: INK, margin: "0 0 4px" }}>
            {ran.res.ticker}
            {ranName && (
              <span style={{ color: MUTED, fontWeight: 400, fontSize: 15, marginLeft: 8 }}>{ranName}</span>
            )}
          </h3>
          <p style={{ color: MUTED, fontSize: 13, margin: "0 0 4px" }}>
            {ran.res.data_start} ~ {ran.res.data_end} · {ran.res.invest_mode === "dca" ? "적립식" : "거치식"} · 투자원금{" "}
            {fmtMoney(ran.res.total_invested, currencyOf(ran.res.ticker))}
          </p>
          {ran.res.data_start > ran.res.start_date && (
            <p style={{ color: "#f59e0b", fontSize: 12, margin: "0 0 4px" }}>
              데이터가 {ran.res.data_start}부터라 {YEARS}년보다 짧습니다.
            </p>
          )}
          {benchmark && (
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 16px", margin: "0 0 12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: MUTED }}>
                비교 구간
                <div style={{ display: "flex", background: "#0f172a", border: `1px solid ${GRID}`, borderRadius: 6, padding: 2 }}>
                  {WINDOW_OPTIONS.map((w) => {
                    const ok = windowAllowed(w.weeks, curvePoints);
                    const active = effectiveWeeks === w.weeks;
                    return (
                      <button
                        key={w.weeks}
                        type="button"
                        disabled={!ok}
                        onClick={() => setWindowWeeks(w.weeks)}
                        title={ok ? undefined : "데이터 기간의 절반보다 길어 구간이 대부분 겹칩니다"}
                        style={{
                          background: active ? "#3b82f6" : "transparent",
                          color: active ? "#fff" : ok ? MUTED : "#475569",
                          border: "none",
                          borderRadius: 4,
                          padding: "3px 10px",
                          fontSize: 12,
                          cursor: ok ? "pointer" : "not-allowed",
                        }}
                      >
                        {w.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              {effectiveWeeks ? (
                <span style={{ color: MUTED, fontSize: 13 }}>
                  {windowLabel} 구간 {windows}개 중 과반에서 B&H를 이긴 전략:{" "}
                  <span style={{ color: beating > 0 ? POSITIVE : INK, fontWeight: 600 }}>
                    {beating} / {ran.res.results.length - 1}
                  </span>
                  <span style={{ color: "#64748b", fontSize: 12, marginLeft: 8 }}>
                    (참고: 오늘 기준 총수익률로는 {beatingToday} / {ran.res.results.length - 1})
                  </span>
                </span>
              ) : (
                <span style={{ color: "#f59e0b", fontSize: 12 }}>데이터가 짧아 구간 비교를 할 수 없습니다.</span>
              )}
            </div>
          )}

          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", margin: "4px 0 8px", fontSize: 12, color: INK }}>
            {chartSeries.map((s) => (
              <span
                key={s.result.strategy_name}
                onMouseEnter={() => setHovered(s.result.strategy_name)}
                onMouseLeave={() => setHovered(null)}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "default" }}
              >
                <Swatch color={s.color} dashed={s.benchmark} />
                {s.result.display_name}
                {s.benchmark && <span style={{ color: MUTED }}>(기준)</span>}
              </span>
            ))}
          </div>
          <AutoReturnChart series={chartSeries} hovered={hovered} />
          <p style={{ color: "#64748b", fontSize: 12, margin: "4px 0 16px" }}>
            {ran.res.invest_mode === "dca" ? "그 시점까지 넣은 원금 대비 " : ""}누적 수익률 · 주 단위.
            표의 체크박스로 최대 {MAX_PLOTTED}개 전략을 그래프에 올릴 수 있습니다.
          </p>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${GRID}` }}>
                  <th style={{ color: MUTED, textAlign: "left", padding: "8px 4px 8px 10px", fontWeight: 600, width: 28 }} title="그래프 표시">📈</th>
                  <th style={{ color: MUTED, textAlign: "left", padding: "8px 10px", fontWeight: 600, width: 36 }}>#</th>
                  <th style={{ color: MUTED, textAlign: "left", padding: "8px 10px", fontWeight: 600 }}>전략</th>
                  {COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      onClick={() => setSortKey(c.key)}
                      title={c.title ? `${c.title} · 눌러서 정렬` : "눌러서 정렬"}
                      style={{
                        color: sortKey === c.key ? "#3b82f6" : MUTED,
                        textAlign: "right",
                        padding: "8px 10px",
                        fontWeight: 600,
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {colLabel(c.key, c.label)}{sortKey === c.key ? " ▾" : ""}
                    </th>
                  ))}
                  <th style={{ padding: "8px 10px" }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const isBenchmark = r.strategy_name === BENCHMARK;
                  const beats = r.roll_win !== null && r.roll_win > 50;
                  return (
                    <tr
                      key={r.strategy_name}
                      onMouseEnter={() => setHovered(r.strategy_name)}
                      onMouseLeave={() => setHovered(null)}
                      style={{
                        borderBottom: "1px solid #1e293b",
                        background: isBenchmark
                          ? "rgba(148, 163, 184, 0.08)"
                          : hovered === r.strategy_name
                            ? "rgba(59, 130, 246, 0.06)"
                            : undefined,
                      }}
                    >
                      <td style={{ padding: "8px 4px 8px 10px" }}>
                        {isBenchmark ? (
                          <Swatch color={BENCHMARK_COLOR} dashed />
                        ) : (
                          <label style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                            <input
                              type="checkbox"
                              checked={r.strategy_name in plotted}
                              disabled={!(r.strategy_name in plotted) && plotFull}
                              onChange={() => togglePlot(r.strategy_name)}
                              title={
                                !(r.strategy_name in plotted) && plotFull
                                  ? `그래프에는 최대 ${MAX_PLOTTED}개까지 올릴 수 있습니다`
                                  : "그래프 표시"
                              }
                            />
                            {r.strategy_name in plotted && <Swatch color={SERIES_COLORS[plotted[r.strategy_name]]} />}
                          </label>
                        )}
                      </td>
                      <td style={{ color: "#64748b", padding: "8px 10px" }}>{i + 1}</td>
                      <td style={{ color: INK, padding: "8px 10px" }}>
                        {r.display_name}
                        {isBenchmark && <span style={{ color: MUTED, fontSize: 11, marginLeft: 6 }}>기준</span>}
                        {beats && (
                          <span style={{ color: POSITIVE, fontSize: 11, marginLeft: 6 }} title={`${windowLabel} 구간 과반에서 B&H보다 높음`}>
                            ▲ B&H
                          </span>
                        )}
                        <div style={{ color: "#64748b", fontSize: 11, marginTop: 2 }}>
                          {Object.keys(r.params).length === 0
                            ? "파라미터 없음"
                            : Object.entries(r.params).map(([k, v], j) => {
                                const info = paramInfo(r.strategy_name).find((p) => p.name === k);
                                return (
                                  <span key={k} title={info?.description}>
                                    {j > 0 && " · "}
                                    {k.replace(/_/g, " ")} {fmtParam(v)}
                                  </span>
                                );
                              })}
                        </div>
                      </td>
                      {COLUMNS.map((c) => {
                        const v = r[c.key];
                        return (
                          <td
                            key={c.key}
                            style={{
                              textAlign: "right",
                              padding: "8px 10px",
                              fontVariantNumeric: "tabular-nums",
                              color: v === null ? "#64748b" : c.signed ? (v >= 0 ? POSITIVE : NEGATIVE) : INK,
                              fontWeight: c.key === sortKey ? 600 : 400,
                            }}
                          >
                            {v === null ? "—" : c.fmt(v)}
                          </td>
                        );
                      })}
                      <td style={{ padding: "6px 10px", textAlign: "right" }}>
                        <button
                          type="button"
                          onClick={() => openDetail(r)}
                          disabled={opening !== null}
                          style={{
                            background: "transparent",
                            border: `1px solid ${GRID}`,
                            borderRadius: 6,
                            color: opening === r.strategy_name ? MUTED : "#3b82f6",
                            padding: "4px 10px",
                            fontSize: 12,
                            cursor: opening !== null ? "wait" : "pointer",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {opening === r.strategy_name ? "여는 중..." : "상세 보기"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {ran.res.failed.length > 0 && (
            <p style={{ color: NEGATIVE, fontSize: 12, marginTop: 12 }}>
              실행 실패: {ran.res.failed.map((f) => `${f.display_name} (${f.error})`).join(", ")}
            </p>
          )}
          <p style={{ color: "#64748b", fontSize: 12, marginTop: 12 }}>
            모두 기본 파라미터 결과입니다. "상세 보기"는 그 전략을 같은 조건으로 다시 실행해 저장하고 결과 화면으로 이동합니다.
          </p>
        </div>
      )}
    </>
  );
}
