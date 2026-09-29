import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AutoStrategyResult, BacktestResult, SimulateResponse, StrategyInfo } from "../types";
import { listStrategies, runBacktest, simulateParams } from "../api/client";
import { errMessage } from "../utils/error";
import { NEGATIVE, POSITIVE, SERIES_COLORS } from "../theme";
import { WINDOW_OPTIONS, rollingExcess, rollingVsBenchmark, windowAllowed } from "../utils/rolling";
import { fmtParam, paramLabel } from "../utils/params";
import AutoReturnChart, { BENCHMARK_COLOR, Swatch, type ChartSeries } from "./AutoReturnChart";
import RegimeTable from "./RegimeTable";
import RollingExcessChart, { type ExcessSeries } from "./RollingExcessChart";
import ParamOptimizer from "./ParamOptimizer";

const MUTED = "#94a3b8";
const INK = "#e2e8f0";
const GRID = "#334155";
/**
 * 원래 결과 + 변형 3개 = 4선. SERIES_COLORS 앞 4색만 다크 배경에서 모든 쌍이
 * 색각이상 검증을 통과한다 (Auto 비교 그래프와 같은 상한).
 */
const MAX_VARIANTS = 3;

interface Variant {
  id: number;
  /** 색 번호. 변형을 지워도 남은 변형의 색이 바뀌지 않도록 변형에 붙인다. 원래 결과는 0. */
  color: number;
  params: Record<string, number>;
}

interface Props {
  result: BacktestResult;
  /** Auto 비교에서 들어왔는지. 변형을 저장해 이동할 때도 "비교로 돌아가기"를 유지한다. */
  fromAuto: boolean;
}

const pct = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
const sameParams = (a: Record<string, number>, b: Record<string, number>) =>
  Object.keys({ ...a, ...b }).every((k) => a[k] === b[k]);

/**
 * 결과 화면에서 파라미터를 바꿔 가며 같은 구간·같은 투자 방식으로 다시 돌려 비교한다.
 * 저장하지 않고 계산만 한다(/backtests/simulate). 마음에 드는 변형만 저장한다.
 */
export default function ParamCompare({ result, fromAuto }: Props) {
  const navigate = useNavigate();
  const [info, setInfo] = useState<StrategyInfo | null>(null);
  const [draft, setDraft] = useState<Record<string, number>>(result.params);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [nextId, setNextId] = useState(1);
  // 응답을 만든 요청(변형 목록)과 함께 들고 있어, 로딩 여부를 effect 안 setState 없이 파생한다.
  const [fetched, setFetched] = useState<{ key: string; sim: SimulateResponse | null; error: string } | null>(null);
  const [actionError, setActionError] = useState("");
  const [windowWeeks, setWindowWeeks] = useState(52);
  const [hovered, setHovered] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    listStrategies()
      .then((r) => setInfo(r.data.find((s) => s.name === result.strategy_name) ?? null))
      .catch(() => {});
  }, [result.strategy_name]);

  // 원래 파라미터와 변형 전부를 한 번에 다시 계산한다. 시세를 한 번만 읽어 빠르다(0.3초 안팎).
  const requestKey = JSON.stringify(variants.map((v) => v.params));
  useEffect(() => {
    let cancelled = false;
    const key = JSON.stringify(variants.map((v) => v.params));
    simulateParams({
      ticker: result.ticker,
      strategy_name: result.strategy_name,
      start_date: result.start_date,
      end_date: result.end_date,
      invest_mode: result.invest_mode,
      initial_capital: result.initial_capital,
      monthly_contribution: result.monthly_contribution,
      param_sets: [result.params, ...variants.map((v) => v.params)],
    })
      .then((r) => {
        if (!cancelled) setFetched({ key, sim: r.data, error: "" });
      })
      .catch((err: unknown) => {
        if (!cancelled) setFetched((prev) => ({ key, sim: prev?.sim ?? null, error: errMessage(err) }));
      });
    return () => {
      cancelled = true;
    };
  }, [result, variants]);

  const loading = fetched?.key !== requestKey;
  // 새 요청을 계산하는 동안에는 직전 결과를 그대로 보여 준다. 줄 수가 맞지 않으면 아래에서 거른다.
  const sim = fetched?.sim ?? null;
  const error = actionError || (fetched?.key === requestKey ? fetched.error : "");
  const schema = info?.params ?? [];
  const dca = result.invest_mode === "dca";

  const curvePoints = sim?.benchmark.curve.length ?? 0;
  // 고른 길이가 이 기간에 너무 길면 쓸 수 있는 가장 긴 길이로 계산한다. 표와 그래프가 같이 쓴다.
  const weeks = windowAllowed(windowWeeks, curvePoints)
    ? windowWeeks
    : [...WINDOW_OPTIONS].reverse().find((w) => windowAllowed(w.weeks, curvePoints))?.weeks;

  // 줄 목록: 원래 결과 + 변형. 응답은 param_sets 순서 그대로다.
  const rows = useMemo(() => {
    if (!sim || sim.results.length !== variants.length + 1) return [];
    const entries = [{ key: "orig", label: "원래", color: 0, variant: null as Variant | null }].concat(
      variants.map((v, i) => ({ key: `v${v.id}`, label: `변형 ${i + 1}`, color: v.color, variant: v }))
    );
    return entries.map((e, i) => {
      const r = sim.results[i];
      const stats = weeks ? rollingVsBenchmark(r.curve, sim.benchmark.curve, weeks) : null;
      return { ...e, r, stats };
    });
  }, [sim, variants, weeks]);

  const windowLabel = WINDOW_OPTIONS.find((w) => w.weeks === weeks)?.label ?? "";

  const excessSeries: ExcessSeries[] = useMemo(() => {
    if (!sim || !weeks) return [];
    return rows.map((row) => ({
      key: row.key,
      label: row.label,
      color: SERIES_COLORS[row.color],
      points: rollingExcess(row.r.curve, sim.benchmark.curve, weeks),
      winRate: row.stats?.winRate ?? null,
    }));
  }, [sim, rows, weeks]);

  // 그래프는 선마다 dataKey가 달라야 한다. 모두 같은 전략이라 줄 key로 이름을 바꿔 넘긴다.
  const chartSeries: ChartSeries[] = useMemo(() => {
    if (!sim) return [];
    const out: ChartSeries[] = [{ result: sim.benchmark, color: BENCHMARK_COLOR, benchmark: true }];
    for (const row of rows) {
      const renamed: AutoStrategyResult = { ...row.r, strategy_name: row.key, display_name: row.label };
      out.push({ result: renamed, color: SERIES_COLORS[row.color] });
    }
    return out;
  }, [sim, rows]);

  /** 변형으로 넣을 수 없는 사유. 직접 입력과 "목표에 맞는 값 찾기"가 같은 규칙을 쓴다. */
  const rejectReason = (params: Record<string, number>): string => {
    for (const p of schema) {
      const v = params[p.name];
      if (v === undefined || Number.isNaN(v)) return `${paramLabel(p.name)} 값을 입력하세요`;
      if (v < p.min || v > p.max) return `${paramLabel(p.name)}은(는) ${fmtParam(p.min)}–${fmtParam(p.max)} 범위여야 합니다`;
    }
    if (sameParams(params, result.params)) return "원래 결과와 같은 값입니다";
    if (variants.some((v) => sameParams(v.params, params))) return "이미 추가한 변형입니다";
    if (variants.length >= MAX_VARIANTS) return `변형은 최대 ${MAX_VARIANTS}개까지 비교할 수 있습니다 — 하나를 삭제하세요`;
    return "";
  };
  const draftError = rejectReason(draft);

  const addParams = (params: Record<string, number>): string | null => {
    const why = rejectReason(params);
    if (why) return why;
    const used = new Set([0, ...variants.map((v) => v.color)]);
    const color = [1, 2, 3].find((c) => !used.has(c)) ?? 1;
    setVariants((prev) => [...prev, { id: nextId, color, params: { ...params } }]);
    setNextId((n) => n + 1);
    return null;
  };
  const addVariant = () => {
    addParams(draft);
  };

  const saveVariant = async (params: Record<string, number>, key: string) => {
    setSaving(key);
    setActionError("");
    try {
      const res = await runBacktest({
        ticker: result.ticker,
        strategy_name: result.strategy_name,
        params,
        start_date: result.start_date,
        end_date: result.end_date,
        invest_mode: result.invest_mode,
        initial_capital: result.initial_capital,
        monthly_contribution: result.monthly_contribution,
      });
      navigate(`/results/${res.data.id}`, { state: { ...res.data, fromAuto } });
    } catch (err: unknown) {
      setActionError(errMessage(err));
      setSaving(null);
    }
  };

  if (schema.length === 0 && info) return null; // 파라미터가 없는 전략(Buy & Hold)은 비교할 것이 없다

  const input: React.CSSProperties = {
    background: "#0f172a",
    border: `1px solid ${GRID}`,
    borderRadius: 6,
    color: INK,
    padding: "6px 10px",
    fontSize: 14,
    width: "100%",
  };
  const th: React.CSSProperties = { color: MUTED, fontWeight: 600, padding: "8px 10px", whiteSpace: "nowrap" };
  const num: React.CSSProperties = { textAlign: "right", padding: "8px 10px", fontVariantNumeric: "tabular-nums" };
  const signed = (v: number) => (v >= 0 ? POSITIVE : NEGATIVE);
  const smallBtn = (color: string): React.CSSProperties => ({
    background: "transparent",
    border: `1px solid ${GRID}`,
    borderRadius: 6,
    color,
    padding: "3px 10px",
    fontSize: 12,
    cursor: "pointer",
    whiteSpace: "nowrap",
  });

  return (
    <div style={{ background: "#1e1e2e", borderRadius: 8, padding: 20, marginBottom: 24 }}>
      <h3 style={{ color: INK, margin: "0 0 4px", fontSize: 16 }}>파라미터 비교</h3>
      <p style={{ color: "#64748b", fontSize: 12, margin: "0 0 14px" }}>
        값을 바꿔 같은 구간·같은 투자 방식으로 다시 계산합니다. 저장하지 않으며, 마음에 드는 변형만 저장할 수 있습니다.
        같은 데이터로 고른 값은 실제보다 좋아 보이기 쉬우니, 주변 값에서도 결과가 비슷한지 함께 보세요.
      </p>

      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 6 }}>
        {schema.map((p) => (
          <label key={p.name} style={{ flex: "1 1 150px", maxWidth: 220 }} title={p.description}>
            <span style={{ display: "block", color: MUTED, fontSize: 12, marginBottom: 4 }}>
              {paramLabel(p.name)}{" "}
              <span style={{ color: "#64748b" }}>
                ({fmtParam(p.min)}–{fmtParam(p.max)})
              </span>
            </span>
            <input
              type="number"
              value={Number.isNaN(draft[p.name]) ? "" : (draft[p.name] ?? p.default)}
              min={p.min}
              max={p.max}
              step={p.type === "float" ? 0.1 : 1}
              onChange={(e) => setDraft((d) => ({ ...d, [p.name]: e.target.value === "" ? NaN : Number(e.target.value) }))}
              style={{
                ...input,
                borderColor: draft[p.name] !== result.params[p.name] ? "#f59e0b" : GRID,
              }}
            />
          </label>
        ))}
        <button
          type="button"
          onClick={addVariant}
          disabled={!!draftError}
          title={draftError || undefined}
          style={{
            background: draftError ? GRID : "#3b82f6",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            padding: "8px 16px",
            fontSize: 14,
            fontWeight: 600,
            cursor: draftError ? "not-allowed" : "pointer",
          }}
        >
          비교에 추가
        </button>
        <button type="button" onClick={() => setDraft(result.params)} style={smallBtn(MUTED)}>
          원래 값으로
        </button>
      </div>
      <p style={{ color: "#64748b", fontSize: 12, minHeight: 16, margin: "0 0 12px" }}>
        {draftError && !sameParams(draft, result.params) ? draftError : "원래 값과 다른 칸은 주황 테두리로 표시됩니다."}
      </p>

      {error && <p style={{ color: NEGATIVE, fontSize: 13 }}>{error}</p>}

      {sim && rows.length > 0 && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 16px", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: MUTED }}>
              비교 구간
              <div style={{ display: "flex", background: "#0f172a", border: `1px solid ${GRID}`, borderRadius: 6, padding: 2 }}>
                {WINDOW_OPTIONS.map((w) => {
                  const ok = windowAllowed(w.weeks, curvePoints);
                  const active = windowWeeks === w.weeks;
                  return (
                    <button
                      key={w.weeks}
                      type="button"
                      disabled={!ok}
                      onClick={() => setWindowWeeks(w.weeks)}
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
            {loading && <span style={{ color: MUTED, fontSize: 12 }}>계산 중…</span>}
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", margin: "4px 0 8px", fontSize: 12, color: INK }}>
            {chartSeries.map((s) => (
              <span
                key={s.result.strategy_name}
                onMouseEnter={() => setHovered(s.result.strategy_name)}
                onMouseLeave={() => setHovered(null)}
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <Swatch color={s.color} dashed={s.benchmark} />
                {s.benchmark ? "Buy & Hold" : s.result.display_name}
                {s.benchmark && <span style={{ color: MUTED }}>(기준)</span>}
              </span>
            ))}
          </div>
          <AutoReturnChart series={chartSeries} hovered={hovered} regions={sim.regimes} />
          <p style={{ color: "#64748b", fontSize: 12, margin: "4px 0 12px" }}>
            {dca ? "그 시점까지 넣은 원금 대비 " : ""}누적 수익률 · 주 단위 · 배경 초록은 상승 구간, 빨강은 하락 구간
          </p>

          {excessSeries.length > 0 && (
            <>
              <h4 style={{ color: INK, margin: "8px 0 2px", fontSize: 14 }}>{windowLabel} 롤링 초과수익 (B&H 대비)</h4>
              <p style={{ color: "#64748b", fontSize: 12, margin: "0 0 6px" }}>
                각 날짜로 끝나는 {windowLabel} 동안의 전략 수익률 − B&H 수익률. 점선(0) 위면 그 {windowLabel}은 B&H를 이겼습니다.
                0선 위에 있던 비율이 아래 표의 B&H 승률, 선의 중앙값이 초과 중앙값입니다.
              </p>
              <RollingExcessChart
                series={excessSeries}
                range={[sim.benchmark.curve[0].date, sim.benchmark.curve[curvePoints - 1].date]}
                hovered={hovered}
                regions={sim.regimes}
              />
              <p style={{ color: "#64748b", fontSize: 12, margin: "4px 0 12px" }}>
                첫 {windowLabel}이 끝나기 전은 비어 있습니다 · 비교 구간을 바꾸면 다시 계산됩니다
              </p>
            </>
          )}

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${GRID}` }}>
                  <th style={{ ...th, textAlign: "left" }}>구분</th>
                  <th style={{ ...th, textAlign: "left" }}>파라미터</th>
                  <th style={{ ...th, textAlign: "right" }} title={`${windowLabel}씩 잘라 본 구간 중 B&H보다 수익이 높았던 비율`}>
                    B&H 승률
                  </th>
                  <th style={{ ...th, textAlign: "right" }}>초과 중앙값</th>
                  <th style={{ ...th, textAlign: "right" }}>총수익률</th>
                  <th style={{ ...th, textAlign: "right" }}>{dca ? "IRR" : "CAGR"}</th>
                  <th style={{ ...th, textAlign: "right" }}>Sharpe</th>
                  <th style={{ ...th, textAlign: "right" }}>MDD</th>
                  <th style={{ ...th, textAlign: "right" }}>거래</th>
                  <th style={th} />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.key}
                    onMouseEnter={() => setHovered(row.key)}
                    onMouseLeave={() => setHovered(null)}
                    style={{
                      borderBottom: "1px solid #1e293b",
                      background: hovered === row.key ? "rgba(59, 130, 246, 0.06)" : undefined,
                    }}
                  >
                    <td style={{ padding: "8px 10px", color: INK, whiteSpace: "nowrap" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <Swatch color={SERIES_COLORS[row.color]} />
                        {row.label}
                      </span>
                    </td>
                    <td style={{ padding: "8px 10px", color: MUTED, fontSize: 12 }}>
                      {Object.entries(row.r.params).map(([k, v], j) => {
                        const changed = row.variant !== null && result.params[k] !== v;
                        return (
                          <span key={k}>
                            {j > 0 && " · "}
                            {paramLabel(k)}{" "}
                            <span style={{ color: changed ? "#f59e0b" : INK, fontWeight: changed ? 600 : 400 }}>
                              {fmtParam(v)}
                            </span>
                          </span>
                        );
                      })}
                    </td>
                    <td style={{ ...num, color: INK, fontWeight: 600 }}>
                      {row.stats ? `${row.stats.winRate.toFixed(0)}%` : "—"}
                    </td>
                    <td style={{ ...num, color: row.stats ? signed(row.stats.medianExcess) : "#64748b" }}>
                      {row.stats ? `${row.stats.medianExcess > 0 ? "+" : ""}${row.stats.medianExcess.toFixed(1)}%p` : "—"}
                    </td>
                    <td style={{ ...num, color: signed(row.r.total_return) }}>{pct(row.r.total_return)}</td>
                    <td style={{ ...num, color: signed(row.r.cagr) }}>{pct(row.r.cagr)}</td>
                    <td style={{ ...num, color: INK }}>{row.r.sharpe_ratio.toFixed(2)}</td>
                    <td style={{ ...num, color: INK }}>-{row.r.max_drawdown.toFixed(1)}%</td>
                    <td style={{ ...num, color: INK }}>{row.r.trades_count}</td>
                    <td style={{ padding: "6px 10px", textAlign: "right", whiteSpace: "nowrap" }}>
                      {row.variant && (
                        <>
                          <button
                            type="button"
                            onClick={() => saveVariant(row.r.params, row.key)}
                            disabled={saving !== null}
                            style={{ ...smallBtn("#3b82f6"), marginRight: 6 }}
                          >
                            {saving === row.key ? "저장 중…" : "저장"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setVariants((prev) => prev.filter((v) => v.id !== row.variant!.id))}
                            style={smallBtn(MUTED)}
                          >
                            삭제
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                <tr style={{ background: "rgba(148, 163, 184, 0.08)" }}>
                  <td style={{ padding: "8px 10px", color: INK, whiteSpace: "nowrap" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <Swatch color={BENCHMARK_COLOR} dashed />
                      Buy & Hold
                    </span>
                  </td>
                  <td style={{ padding: "8px 10px", color: "#64748b", fontSize: 12 }}>기준</td>
                  <td style={{ ...num, color: "#64748b" }}>—</td>
                  <td style={{ ...num, color: "#64748b" }}>—</td>
                  <td style={{ ...num, color: signed(sim.benchmark.total_return) }}>{pct(sim.benchmark.total_return)}</td>
                  <td style={{ ...num, color: signed(sim.benchmark.cagr) }}>{pct(sim.benchmark.cagr)}</td>
                  <td style={{ ...num, color: INK }}>{sim.benchmark.sharpe_ratio.toFixed(2)}</td>
                  <td style={{ ...num, color: INK }}>-{sim.benchmark.max_drawdown.toFixed(1)}%</td>
                  <td style={{ ...num, color: INK }}>{sim.benchmark.trades_count}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>

          <RegimeTable
            regimes={sim.regimes}
            threshold={sim.regime_threshold}
            rows={rows.map((row) => ({ key: row.key, label: row.label, color: SERIES_COLORS[row.color], r: row.r }))}
          />
        </>
      )}

      <ParamOptimizer result={result} onAdd={addParams} />
    </div>
  );
}
