import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type {
  BacktestResult,
  OptimizeGoal,
  OptimizeGoalInfo,
  OptimizeJob,
  OptimizeResult,
  OptimizeRow,
  SegmentMetrics,
} from "../types";
import { getOptimizeJob, listOptimizeGoals, startOptimize } from "../api/client";
import { errMessage } from "../utils/error";
import { NEGATIVE, POSITIVE, SERIES_COLORS } from "../theme";
import { fmtParam, paramLabel } from "../utils/params";
import ScoreHeatmap, { type HeatCell } from "./ScoreHeatmap";

const MUTED = "#94a3b8";
const INK = "#e2e8f0";
const GRID = "#334155";
const POLL_MS = 1000;

type View = "score_robust" | "score_in" | "score_out";
const VIEWS: { key: View; label: string; hint: string }[] = [
  { key: "score_robust", label: "고원 점수", hint: "주변 조합과 평균낸 선택 구간 점수 — 추천의 기준" },
  { key: "score_in", label: "선택 구간", hint: "앞 60% 기간 점수 — 여기서만 보면 과최적화된다" },
  { key: "score_out", label: "검증 구간", hint: "뒤 40% 기간 점수 — 고를 때 보지 않은 기간" },
];

/** 목표별 점수 표기. 점수는 클수록 좋게 만들어져 있어 하락 방어는 부호를 되돌려 보여 준다. */
function fmtScore(goal: OptimizeGoal, v: number | null | undefined): string {
  if (v == null) return "—";
  switch (goal) {
    case "consistency":
      return `${v.toFixed(1)}점`;
    case "risk_adjusted":
      return v.toFixed(2);
    case "defense":
      return `노출 ${(-v).toFixed(0)}%`;
    case "trend":
      return `포착 ${v.toFixed(0)}%`;
    default:
      return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
  }
}

const pct = (v: number | null | undefined) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);
const paramsText = (p: Record<string, number>) =>
  Object.entries(p).map(([k, v]) => `${paramLabel(k)} ${fmtParam(v)}`).join(" · ");
const same = (a: Record<string, number> | null, b: Record<string, number>) =>
  !!a && Object.keys({ ...a, ...b }).every((k) => a[k] === b[k]);

interface Props {
  result: BacktestResult;
  /** 파라미터 비교에 변형으로 넣는다. 넣지 못하면 사유를 돌려준다. */
  onAdd: (params: Record<string, number>) => string | null;
}

/**
 * 투자 목표에 맞는 파라미터 찾기. 앞 60% 기간으로 고르고 뒤 40%로 검증하며, 한 점의 최고점이
 * 아니라 주변까지 고르게 좋은 값(고원)을 추천한다.
 */
export default function ParamOptimizer({ result, onAdd }: Props) {
  const [goals, setGoals] = useState<OptimizeGoalInfo[]>([]);
  const [goal, setGoal] = useState<OptimizeGoal>("consistency");
  const [maxMdd, setMaxMdd] = useState<number | "">("");
  const [minEntries, setMinEntries] = useState(1);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<OptimizeJob | null>(null);
  const [startError, setStartError] = useState("");
  const [view, setView] = useState<View>("score_robust");
  const [axisX, setAxisX] = useState(0);
  const [axisY, setAxisY] = useState(1);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    listOptimizeGoals().then((r) => setGoals(r.data)).catch(() => {});
  }, []);

  // 작업이 끝날 때까지 진행률을 폴링한다. 상태는 콜백 안에서만 바꾼다.
  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    const tick = () =>
      getOptimizeJob(jobId)
        .then((r) => {
          if (stopped) return;
          setJob(r.data);
          if (r.data.status === "running") timer = window.setTimeout(tick, POLL_MS);
        })
        .catch((err: unknown) => {
          if (!stopped) setJob({ id: jobId, status: "error", done: 0, total: 0, result: null, error: errMessage(err) });
        });
    let timer = window.setTimeout(tick, 300);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [jobId]);

  const run = async () => {
    setStartError("");
    setNotice("");
    setJob(null);
    try {
      const r = await startOptimize({
        ticker: result.ticker,
        strategy_name: result.strategy_name,
        start_date: result.start_date,
        end_date: result.end_date,
        invest_mode: result.invest_mode,
        initial_capital: result.initial_capital,
        monthly_contribution: result.monthly_contribution,
        original_params: result.params,
        goal,
        min_trades: minEntries,
        max_mdd: goal === "risk_adjusted" && maxMdd !== "" ? Number(maxMdd) : null,
      });
      setJobId(r.data.id);
    } catch (err: unknown) {
      setStartError(errMessage(err));
    }
  };

  const running = job?.status === "running" || (!!jobId && !job);
  const res: OptimizeResult | null = job?.status === "done" ? job.result : null;
  const g = res?.goal ?? goal;

  const add = (p: Record<string, number>) => {
    const why = onAdd(p);
    setNotice(why ?? `비교에 추가했습니다: ${paramsText(p)}`);
  };

  const input: React.CSSProperties = {
    background: "#0f172a",
    border: `1px solid ${GRID}`,
    borderRadius: 6,
    color: INK,
    padding: "6px 10px",
    fontSize: 13,
    width: 80,
  };
  const chip = (active: boolean): React.CSSProperties => ({
    background: active ? "rgba(59, 130, 246, 0.12)" : "#0f172a",
    border: active ? "1px solid #3b82f6" : `1px solid ${GRID}`,
    color: active ? "#93c5fd" : MUTED,
    borderRadius: 6,
    padding: "6px 12px",
    fontSize: 13,
    cursor: "pointer",
  });

  return (
    <div style={{ marginTop: 24, borderTop: `1px solid ${GRID}`, paddingTop: 18 }}>
      <h4 style={{ color: INK, margin: "0 0 4px", fontSize: 15 }}>목표에 맞는 값 찾기</h4>
      <p style={{ color: "#64748b", fontSize: 12, margin: "0 0 12px" }}>
        파라미터 범위를 훑어 목표 점수가 좋은 값을 찾습니다. 앞 60% 기간으로 고르고 뒤 40% 기간으로 확인하며,
        한 점만 튀는 값보다 주변까지 고르게 좋은 값(고원)을 추천합니다. 저장하지 않습니다.
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
        {goals.map((x) => (
          <button key={x.key} type="button" onClick={() => setGoal(x.key)} style={chip(goal === x.key)} title={x.description}>
            {x.label}
          </button>
        ))}
      </div>
      <p style={{ color: MUTED, fontSize: 12, margin: "0 0 10px", minHeight: 16 }}>
        {goals.find((x) => x.key === goal)?.description}
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14, marginBottom: 12 }}>
        <label style={{ color: MUTED, fontSize: 12 }} title="선택 구간에서 최소 몇 번은 들어가야 후보로 인정">
          최소 진입{" "}
          <input type="number" min={0} max={50} value={minEntries} onChange={(e) => setMinEntries(Number(e.target.value))} style={input} />
          회
        </label>
        {goal === "risk_adjusted" && (
          <label style={{ color: MUTED, fontSize: 12 }}>
            최대 낙폭 한도{" "}
            <input
              type="number"
              min={1}
              max={100}
              placeholder="없음"
              value={maxMdd}
              onChange={(e) => setMaxMdd(e.target.value === "" ? "" : Number(e.target.value))}
              style={input}
            />
            %
          </label>
        )}
        <button
          type="button"
          onClick={run}
          disabled={running}
          style={{
            background: running ? GRID : "#3b82f6",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            padding: "8px 18px",
            fontSize: 14,
            fontWeight: 600,
            cursor: running ? "wait" : "pointer",
          }}
        >
          {running ? "찾는 중…" : "최적값 찾기"}
        </button>
      </div>

      {running && job && job.total > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ color: MUTED, fontSize: 12, marginBottom: 4 }}>
            조합 {job.done}/{job.total} 계산 중 (조합당 0.1~0.2초)
          </div>
          <div style={{ height: 6, background: "#0f172a", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${(job.done / job.total) * 100}%`, background: "#3b82f6", transition: "width .3s" }} />
          </div>
        </div>
      )}
      {(startError || job?.status === "error") && (
        <p style={{ color: NEGATIVE, fontSize: 13 }}>{startError || job?.error}</p>
      )}
      {notice && <p style={{ color: MUTED, fontSize: 12 }}>{notice}</p>}

      {res && (
        <OptimizeView
          res={res}
          goal={g}
          view={view}
          setView={setView}
          axisX={axisX}
          axisY={axisY}
          setAxisX={setAxisX}
          setAxisY={setAxisY}
          onAdd={add}
        />
      )}
    </div>
  );
}

interface ViewProps {
  res: OptimizeResult;
  goal: OptimizeGoal;
  view: View;
  setView: (v: View) => void;
  axisX: number;
  axisY: number;
  setAxisX: (i: number) => void;
  setAxisY: (i: number) => void;
  onAdd: (p: Record<string, number>) => void;
}

function OptimizeView({ res, goal, view, setView, axisX, axisY, setAxisX, setAxisY, onAdd }: ViewProps) {
  const find = (p: Record<string, number> | null) => (p ? res.results.find((r) => same(r.params, p)) ?? null : null);
  const picks = [
    { key: "rec", symbol: "★", label: "안정 추천", row: find(res.recommended), hint: "주변 조합까지 고르게 좋은 값" },
    { key: "peak", symbol: "▲", label: "최고점", row: find(res.peak), hint: "선택 구간 한 점의 최고 점수" },
    { key: "orig", symbol: "○", label: "원래 값", row: find(res.original), hint: "지금 결과의 파라미터" },
  ];
  const axes = res.axes;
  const dims = axes.length;

  return (
    <div>
      <p style={{ color: MUTED, fontSize: 12, margin: "4px 0 12px" }}>
        {res.goal_label} · {res.mode === "grid" ? `격자 전체 ${res.evaluated}조합` : `격자 ${res.grid_size.toLocaleString()}조합 중 ${res.evaluated}개 (무작위 + 상위 근처 정밀)`} ·
        선택 구간 {res.start_date} ~ {res.split_date} · 검증 구간 ~ {res.end_date}
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 12, marginBottom: 16 }}>
        {picks.map((p) => (
          <PickCard
            key={p.key}
            symbol={p.symbol}
            label={p.label}
            hint={p.hint}
            row={p.row}
            goal={goal}
            res={res}
            onAdd={p.key === "orig" ? undefined : onAdd}
          />
        ))}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div style={{ display: "flex", background: "#0f172a", border: `1px solid ${GRID}`, borderRadius: 6, padding: 2 }}>
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              title={v.hint}
              onClick={() => setView(v.key)}
              style={{
                background: view === v.key ? "#3b82f6" : "transparent",
                color: view === v.key ? "#fff" : MUTED,
                border: "none",
                borderRadius: 4,
                padding: "4px 12px",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {v.label}
            </button>
          ))}
        </div>
        {dims >= 3 && (
          <span style={{ color: MUTED, fontSize: 12 }}>
            가로{" "}
            <select value={axisX} onChange={(e) => setAxisX(Number(e.target.value))} style={selectStyle}>
              {axes.map((a, i) => <option key={a.name} value={i} disabled={i === axisY}>{paramLabel(a.name)}</option>)}
            </select>{" "}
            세로{" "}
            <select value={axisY} onChange={(e) => setAxisY(Number(e.target.value))} style={selectStyle}>
              {axes.map((a, i) => <option key={a.name} value={i} disabled={i === axisX}>{paramLabel(a.name)}</option>)}
            </select>
            <span style={{ color: "#64748b", marginLeft: 6 }}>나머지 파라미터는 칸마다 가장 좋은 조합의 점수</span>
          </span>
        )}
      </div>

      {dims === 1 ? (
        <OneParamChart res={res} goal={goal} />
      ) : (
        <Heatmap res={res} goal={goal} view={view} xi={dims >= 3 ? axisX : 0} yi={dims >= 3 ? axisY : 1} picks={picks} />
      )}

      <TopTable res={res} goal={goal} onAdd={onAdd} />
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  background: "#0f172a",
  border: `1px solid ${GRID}`,
  borderRadius: 4,
  color: INK,
  fontSize: 12,
  padding: "2px 6px",
};

function PickCard({ symbol, label, hint, row, goal, res, onAdd }: {
  symbol: string; label: string; hint: string; row: OptimizeRow | null; goal: OptimizeGoal; res: OptimizeResult;
  onAdd?: (p: Record<string, number>) => void;
}) {
  if (!row) {
    return (
      <div style={card}>
        <div style={{ color: INK, fontWeight: 600 }}>{symbol} {label}</div>
        <p style={{ color: "#64748b", fontSize: 12 }}>조건을 만족하는 조합이 없습니다. 최소 진입이나 한도를 완화해 보세요.</p>
      </div>
    );
  }
  const i = row.in_sample;
  const o = row.out_of_sample;
  const bi = res.benchmark.in_sample;
  const bo = res.benchmark.out_of_sample;
  // 검증 구간에서 점수가 크게 떨어지면 선택 구간에 맞춰진 값일 가능성이 높다.
  const dropped = row.score_in != null && row.score_out != null &&
    row.score_out < row.score_in - Math.max(Math.abs(row.score_in) * 0.5, 1e-9);
  const conc = row.full?.concentration;
  return (
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span style={{ color: INK, fontWeight: 600 }} title={hint}>{symbol} {label}</span>
        {onAdd && (
          <button type="button" onClick={() => onAdd(row.params)} style={addBtn}>비교에 추가</button>
        )}
      </div>
      <div style={{ color: INK, fontSize: 13, margin: "4px 0 8px" }}>{paramsText(row.params)}</div>
      <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ color: "#64748b" }}>
            <td />
            <td style={{ textAlign: "right" }}>선택 구간</td>
            <td style={{ textAlign: "right" }}>검증 구간</td>
          </tr>
        </thead>
        <tbody style={{ color: INK }}>
          <tr>
            <td style={{ color: MUTED }}>목표 점수</td>
            <td style={num}>{fmtScore(goal, row.score_in)}</td>
            <td style={{ ...num, color: dropped ? NEGATIVE : INK, fontWeight: 600 }}>{fmtScore(goal, row.score_out)}</td>
          </tr>
          <tr>
            <td style={{ color: MUTED }}>CAGR</td>
            <td style={num}>{pct(i?.cagr)} <span style={{ color: "#64748b" }}>/ B&H {pct(bi?.cagr)}</span></td>
            <td style={num}>{pct(o?.cagr)} <span style={{ color: "#64748b" }}>/ {pct(bo?.cagr)}</span></td>
          </tr>
          <tr>
            <td style={{ color: MUTED }}>MDD</td>
            <td style={num}>-{i?.max_drawdown.toFixed(1)}%</td>
            <td style={num}>-{o?.max_drawdown.toFixed(1) ?? "—"}%</td>
          </tr>
          <tr>
            <td style={{ color: MUTED }}>진입</td>
            <td style={num}>{i?.entries ?? "—"}회</td>
            <td style={num}>{o?.entries ?? "—"}회</td>
          </tr>
        </tbody>
      </table>
      {(dropped || row.excluded || (conc != null && conc > res.concentration_warn)) && (
        <div style={{ marginTop: 8, fontSize: 11, lineHeight: 1.5 }}>
          {dropped && <div style={{ color: NEGATIVE }}>⚠ 검증 구간에서 점수가 크게 떨어짐 — 선택 구간에 맞춰진 값일 수 있음</div>}
          {conc != null && conc > res.concentration_warn && (
            <div style={{ color: "#f59e0b" }}>⚠ 수익의 {conc.toFixed(0)}%가 추세 구간 하나에서 나옴</div>
          )}
          {row.excluded && <div style={{ color: "#64748b" }}>추천 제외: {row.excluded}</div>}
        </div>
      )}
    </div>
  );
}

function Heatmap({ res, goal, view, xi, yi, picks }: {
  res: OptimizeResult; goal: OptimizeGoal; view: View; xi: number; yi: number;
  picks: { symbol: string; label: string; row: OptimizeRow | null }[];
}) {
  const ax = res.axes[xi];
  const ay = res.axes[yi];
  // 3개 이상이면 칸(두 파라미터 값)마다 나머지 파라미터 중 가장 좋은 조합을 대표로 쓴다.
  const cells = useMemo(() => {
    const m = new Map<string, OptimizeRow>();
    for (const r of res.results) {
      const k = `${r.params[ax.name]}|${r.params[ay.name]}`;
      const cur = m.get(k);
      const v = r[view];
      const better = (a: OptimizeRow, b: OptimizeRow) => {
        if (!!a.excluded !== !!b.excluded) return !a.excluded;
        return (a[view] ?? -Infinity) > (b[view] ?? -Infinity);
      };
      if (!cur || (v != null && better(r, cur))) m.set(k, r);
    }
    return m;
  }, [res, ax.name, ay.name, view]);

  const cell = (x: number, y: number): HeatCell | null => {
    const r = cells.get(`${x}|${y}`);
    if (!r) return null;
    const v = r[view];
    const others = Object.entries(r.params).filter(([k]) => k !== ax.name && k !== ay.name);
    return {
      value: v,
      excluded: r.excluded,
      detail: [
        `${VIEWS.find((w) => w.key === view)!.label} ${fmtScore(goal, v)}`,
        `선택 ${fmtScore(goal, r.score_in)} → 검증 ${fmtScore(goal, r.score_out)}`,
        `CAGR ${pct(r.full?.cagr)}`,
        others.length ? others.map(([k, val]) => `${paramLabel(k)} ${fmtParam(val)}`).join(" · ") : "",
        r.excluded ? `제외: ${r.excluded}` : "",
      ].filter(Boolean).join(" · "),
    };
  };

  return (
    <ScoreHeatmap
      xName={ax.name}
      xValues={ax.values}
      yName={ay.name}
      yValues={ay.values}
      cell={cell}
      fmt={(v) => fmtScore(goal, v)}
      markers={picks
        .filter((p) => p.row)
        .map((p) => ({ x: p.row!.params[ax.name], y: p.row!.params[ay.name], symbol: p.symbol, label: p.label }))}
    />
  );
}

function OneParamChart({ res, goal }: { res: OptimizeResult; goal: OptimizeGoal }) {
  const ax = res.axes[0];
  const data = [...res.results]
    .sort((a, b) => a.params[ax.name] - b.params[ax.name])
    .map((r) => ({ x: r.params[ax.name], in: r.score_in, out: r.score_out, robust: r.score_robust }));
  const rec = res.recommended?.[ax.name];
  const orig = res.original[ax.name];
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
        <CartesianGrid stroke={GRID} strokeOpacity={0.5} vertical={false} />
        <XAxis dataKey="x" type="number" domain={["dataMin", "dataMax"]} tick={{ fill: MUTED, fontSize: 11 }} stroke={GRID}
          label={{ value: paramLabel(ax.name), fill: MUTED, fontSize: 12, position: "insideBottom", offset: -4 }} />
        <YAxis tick={{ fill: MUTED, fontSize: 11 }} stroke={GRID} tickFormatter={(v: number) => fmtScore(goal, v)} width={70} />
        <Tooltip
          contentStyle={{ background: "#0f172a", border: `1px solid ${GRID}` }}
          labelStyle={{ color: INK }}
          itemStyle={{ color: INK }}
          labelFormatter={(v) => `${paramLabel(ax.name)} ${fmtParam(Number(v))}`}
          formatter={(v, name) => [fmtScore(goal, Number(v)), String(name)] as [string, string]}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: INK }} />
        {rec != null && <ReferenceLine x={rec} stroke={INK} strokeDasharray="4 3" label={{ value: "★", fill: INK, position: "top" }} />}
        <ReferenceLine x={orig} stroke={MUTED} strokeDasharray="2 3" label={{ value: "○", fill: MUTED, position: "top" }} />
        <Line dataKey="in" name="선택 구간" stroke={SERIES_COLORS[2]} strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line dataKey="robust" name="고원 점수" stroke={SERIES_COLORS[1]} strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line dataKey="out" name="검증 구간" stroke={SERIES_COLORS[0]} strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function TopTable({ res, goal, onAdd }: { res: OptimizeResult; goal: OptimizeGoal; onAdd: (p: Record<string, number>) => void }) {
  const rows = res.results.filter((r) => r.score_robust != null && !r.excluded).slice(0, 10);
  const th: React.CSSProperties = { color: MUTED, fontWeight: 600, padding: "7px 8px", whiteSpace: "nowrap", textAlign: "right" };
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ color: INK, fontSize: 13, fontWeight: 600, marginBottom: 6 }}>고원 점수 상위 10개</div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${GRID}` }}>
              <th style={{ ...th, textAlign: "left" }}>파라미터</th>
              <th style={th}>고원</th>
              <th style={th}>선택</th>
              <th style={th}>검증</th>
              <th style={th}>CAGR 선택/검증</th>
              <th style={th}>MDD</th>
              <th style={th}>진입</th>
              <th style={th} title="수익 중 가장 큰 추세 구간 하나의 비중">집중도</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const dropped = r.score_in != null && r.score_out != null && r.score_out < r.score_in - Math.abs(r.score_in) * 0.5;
              const conc = r.full?.concentration;
              return (
                <tr key={JSON.stringify(r.params)} style={{ borderBottom: "1px solid #1e293b" }}>
                  <td style={{ padding: "6px 8px", color: INK }}>
                    {paramsText(r.params)}
                    {same(res.recommended, r.params) && <b style={{ marginLeft: 6 }}>★</b>}
                    {same(res.original, r.params) && <span style={{ color: MUTED, marginLeft: 6 }}>○</span>}
                  </td>
                  <td style={{ ...num, color: INK, fontWeight: 600 }}>{fmtScore(goal, r.score_robust)}</td>
                  <td style={{ ...num, color: INK }}>{fmtScore(goal, r.score_in)}</td>
                  <td style={{ ...num, color: dropped ? NEGATIVE : INK }}>{fmtScore(goal, r.score_out)}</td>
                  <td style={num}>
                    <span style={{ color: signed(r.in_sample) }}>{pct(r.in_sample?.cagr)}</span>
                    <span style={{ color: "#64748b" }}> / </span>
                    <span style={{ color: signed(r.out_of_sample) }}>{pct(r.out_of_sample?.cagr)}</span>
                  </td>
                  <td style={{ ...num, color: INK }}>-{r.full?.max_drawdown.toFixed(1)}%</td>
                  <td style={{ ...num, color: INK }}>{r.full?.entries}</td>
                  <td style={{ ...num, color: conc != null && conc > res.concentration_warn ? "#f59e0b" : INK }}>
                    {conc == null ? "—" : `${conc.toFixed(0)}%`}
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right" }}>
                    {!same(res.original, r.params) && (
                      <button type="button" onClick={() => onAdd(r.params)} style={addBtn}>비교에 추가</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ color: "#64748b", fontSize: 11, margin: "6px 0 0" }}>
        검증 점수가 선택 점수의 절반 넘게 떨어지면 빨간색입니다. 집중도가 {res.concentration_warn}%를 넘으면 수익이 추세 구간 하나에 몰린 값입니다.
      </p>
    </div>
  );
}

const signed = (m: SegmentMetrics | null) => (m == null ? MUTED : m.cagr >= 0 ? POSITIVE : NEGATIVE);
const num: React.CSSProperties = { textAlign: "right", padding: "3px 8px", fontVariantNumeric: "tabular-nums" };
const card: React.CSSProperties = { background: "#0f172a", border: `1px solid ${GRID}`, borderRadius: 8, padding: 12 };
const addBtn: React.CSSProperties = {
  background: "transparent",
  border: `1px solid ${GRID}`,
  borderRadius: 6,
  color: "#3b82f6",
  padding: "2px 8px",
  fontSize: 12,
  cursor: "pointer",
  whiteSpace: "nowrap",
};
