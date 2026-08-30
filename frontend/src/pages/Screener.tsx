import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listUniverses, scanStocks } from "../api/client";
import type { ScanRequest, ScanResponse, ScanRow, UniverseInfo } from "../types";
import { errMessage } from "../utils/error";
import { POSITIVE, NEGATIVE } from "../theme";

/**
 * 조건 기반 스크리너.
 *
 * questions.md는 "수익률 상위 종목을 알려줘"가 아니라 "이 조건들을 동시에 만족하는
 * 종목을 찾아줘"라고 묻는다. 그래서 전략 백테스트가 아니라 교집합을 구한다.
 *
 * 조건마다 통과 수를 함께 보여주는 것이 이 화면의 핵심이다. 결과가 9종목이라는
 * 사실만으로는 조건을 어떻게 손봐야 할지 알 수 없다. 어느 조건이 199를 41로
 * 줄였는지 보여야 그 조건을 풀지 조일지 판단할 수 있다.
 */

const MUTED = "#94a3b8";
const INK = "#e2e8f0";
const SURFACE = "#1e1e2e";
const GRID = "#334155";

/** questions.md의 대표 조합. 처음 여는 사람이 무엇부터 눌러야 할지 알려 준다. */
const PRESETS: { name: string; note: string; filters: ScanRequest }[] = [
  {
    name: "강한 종목 선별",
    note: "4장 1번 — 수급이 들어오고 거래가 늘어난 종목",
    filters: { above_ma20: true, turnover_ratio_min: 1, frgn_buy: true, orgn_buy: true },
  },
  {
    name: "과열 제외",
    note: "10장 — 이미 급등한 종목을 걸러낸 뒤 본다",
    filters: { above_ma20: true, frgn_buy: true, disparity_max: 10, return_5d_max: 8 },
  },
  {
    name: "조용한 매수",
    note: "11장 10번 — 관심은 덜한데 수급이 쌓이는 종목",
    filters: { frgn_buy: true, orgn_buy: true, prsn_not_crowded: true, return_20d_min: -5, disparity_max: 8 },
  },
  {
    name: "눌림목 후보",
    note: "10장 — 60일선 위에서 20일선 아래로 눌린 구간",
    filters: { above_ma60: true, frgn_buy: true, disparity_max: 0, from_high_min: -25 },
  },
];

const EMPTY: ScanRequest = {
  above_ma20: false,
  above_ma60: false,
  turnover_ratio_min: null,
  disparity_max: null,
  return_5d_max: null,
  return_20d_min: null,
  from_high_min: null,
  frgn_buy: false,
  orgn_buy: false,
  prsn_not_crowded: false,
};

const NUMERIC: { key: keyof ScanRequest; label: string; unit: string; hint: string }[] = [
  { key: "turnover_ratio_min", label: "거래대금 5일÷60일", unit: "배 이상", hint: "1.5면 최근 거래가 평소의 1.5배" },
  { key: "disparity_max", label: "20일선 이격도", unit: "% 이하", hint: "낮게 잡을수록 과열을 걷어낸다" },
  { key: "return_5d_max", label: "5일 상승률", unit: "% 이하", hint: "급등 직후를 피한다" },
  { key: "return_20d_min", label: "20일 수익률", unit: "% 이상", hint: "추세가 살아 있는 종목만" },
  { key: "from_high_min", label: "52주 고가 대비", unit: "% 이상", hint: "-25면 고점에서 25% 안쪽" },
];

const CHECKS: { key: keyof ScanRequest; label: string; korOnly?: boolean }[] = [
  { key: "above_ma20", label: "종가가 20일선 위" },
  { key: "above_ma60", label: "종가가 60일선 위" },
  { key: "frgn_buy", label: "외국인 20일 순매수", korOnly: true },
  { key: "orgn_buy", label: "기관 20일 순매수", korOnly: true },
  { key: "prsn_not_crowded", label: "개인 쏠림 아님", korOnly: true },
];

const pct = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);
const sign = (v: number | null) => (v === null ? INK : v >= 0 ? POSITIVE : NEGATIVE);
const shares = (v: number | null) =>
  v === null ? "—" : `${v > 0 ? "+" : ""}${Math.round(v / 10_000).toLocaleString()}만`;

export default function Screener() {
  const [universes, setUniverses] = useState<UniverseInfo[]>([]);
  const [universe, setUniverse] = useState("kospi200");
  const [filters, setFilters] = useState<ScanRequest>(PRESETS[0].filters);
  const [result, setResult] = useState<ScanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    listUniverses()
      .then((r) => setUniverses(r.data))
      .catch(() => setUniverses([]));
  }, []);

  const run = async (next: ScanRequest = filters, uni: string = universe) => {
    setLoading(true);
    setError("");
    try {
      const { data } = await scanStocks({ ...next, universe: uni || null, limit: 100 });
      setResult(data);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setLoading(false);
    }
  };

  // 첫 진입에서 한 번 돌려 빈 화면을 보여주지 않는다.
  useEffect(() => {
    run(PRESETS[0].filters, "kospi200");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyPreset = (p: (typeof PRESETS)[number]) => {
    const next = { ...EMPTY, ...p.filters };
    setFilters(next);
    run(next);
  };

  const setNum = (key: keyof ScanRequest, raw: string) => {
    const v = raw.trim() === "" ? null : Number(raw);
    setFilters((f) => ({ ...f, [key]: Number.isNaN(v as number) ? null : v }));
  };

  // 수급 조건은 한국 종목에만 데이터가 있다. 미국 지수를 고르면 켜도 결과가 0이 된다.
  const koreanUniverse = universe === "kospi200";

  const card: React.CSSProperties = { background: SURFACE, borderRadius: 8, padding: 20, marginBottom: 20 };
  const input: React.CSSProperties = {
    background: "#0f172a", border: `1px solid ${GRID}`, borderRadius: 6,
    color: INK, padding: "6px 10px", fontSize: 13, width: 90,
  };

  return (
    <div>
      <h2 style={{ color: INK, marginBottom: 4 }}>Screener</h2>
      <p style={{ color: MUTED, fontSize: 14, marginBottom: 20 }}>
        조건을 동시에 만족하는 종목을 찾는다. 백테스트는 하지 않고 오늘의 상태만 본다.
      </p>

      <div style={card}>
        <div style={{ color: MUTED, fontSize: 12, marginBottom: 8 }}>자주 쓰는 조합</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
          {PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => applyPreset(p)}
              title={p.note}
              style={{
                background: "transparent", color: INK, border: `1px solid ${GRID}`,
                borderRadius: 6, padding: "8px 14px", fontSize: 13, cursor: "pointer",
              }}
            >
              {p.name}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div>
            <div style={{ color: MUTED, fontSize: 12, marginBottom: 8 }}>대상</div>
            <select
              value={universe}
              onChange={(e) => {
                setUniverse(e.target.value);
                run(filters, e.target.value);
              }}
              style={{ ...input, width: 160 }}
            >
              <option value="">전체 캐시</option>
              {universes.map((u) => (
                <option key={u.key} value={u.key}>{u.label}</option>
              ))}
            </select>
          </div>

          <div>
            <div style={{ color: MUTED, fontSize: 12, marginBottom: 8 }}>켜고 끄는 조건</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {CHECKS.map((c) => (
                <label
                  key={c.key}
                  style={{
                    color: c.korOnly && !koreanUniverse ? "#64748b" : INK,
                    fontSize: 13, display: "flex", gap: 8, alignItems: "center",
                  }}
                  title={c.korOnly ? "수급 데이터는 국내 종목에만 있습니다" : undefined}
                >
                  <input
                    type="checkbox"
                    checked={Boolean(filters[c.key])}
                    onChange={(e) => setFilters((f) => ({ ...f, [c.key]: e.target.checked }))}
                  />
                  {c.label}
                  {c.korOnly && <span style={{ color: "#475569", fontSize: 11 }}>국내</span>}
                </label>
              ))}
            </div>
          </div>

          <div>
            <div style={{ color: MUTED, fontSize: 12, marginBottom: 8 }}>기준값 (비우면 끔)</div>
            <div style={{ display: "grid", gridTemplateColumns: "auto auto auto", gap: "6px 10px", alignItems: "center" }}>
              {NUMERIC.map((n) => (
                <Fragment key={n.key}>
                  <span style={{ color: INK, fontSize: 13 }} title={n.hint}>{n.label}</span>
                  <input
                    style={input}
                    value={filters[n.key] === null || filters[n.key] === undefined ? "" : String(filters[n.key])}
                    onChange={(e) => setNum(n.key, e.target.value)}
                    placeholder="—"
                  />
                  <span style={{ color: MUTED, fontSize: 12 }}>{n.unit}</span>
                </Fragment>
              ))}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 20, display: "flex", gap: 10, alignItems: "center" }}>
          <button
            type="button"
            onClick={() => run()}
            disabled={loading}
            style={{
              background: loading ? "#334155" : "#3b82f6", color: loading ? MUTED : "#fff",
              border: "none", borderRadius: 6, padding: "9px 20px", fontSize: 14,
              fontWeight: 600, cursor: loading ? "default" : "pointer",
            }}
          >
            {loading ? "검색 중…" : "검색"}
          </button>
          <button
            type="button"
            onClick={() => { setFilters(EMPTY); run(EMPTY); }}
            style={{ background: "none", border: "none", color: "#3b82f6", fontSize: 13, cursor: "pointer" }}
          >
            조건 모두 끄기
          </button>
          {error && <span style={{ color: NEGATIVE, fontSize: 13 }}>{error}</span>}
        </div>
      </div>

      {result && (
        <>
          <div style={card}>
            <h3 style={{ color: INK, margin: "0 0 4px" }}>
              {result.total}종목 → <span style={{ color: POSITIVE }}>{result.matched}종목</span>
            </h3>
            <p style={{ color: MUTED, fontSize: 13, marginBottom: 12 }}>
              조건을 하나씩 더할 때 남는 수. 어느 조건이 실제로 걸렀는지 보고 조절한다.
            </p>
            {result.funnel.length === 0 ? (
              <p style={{ color: "#64748b", fontSize: 13 }}>조건이 없어 전부 통과했다.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <tbody>
                  {result.funnel.map((f) => (
                    <tr key={f.key} style={{ borderBottom: "1px solid #1e293b" }}>
                      <td style={{ color: INK, padding: "7px 12px 7px 0" }}>{f.label}</td>
                      <td style={{ color: MUTED, padding: "7px 12px", width: 70 }}>{f.value}</td>
                      <td style={{ color: "#64748b", padding: "7px 12px", width: 110 }}>
                        단독 {f.passed}종목
                      </td>
                      <td style={{ padding: "7px 0", width: 260 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ flex: 1, height: 6, background: "#0f172a", borderRadius: 3, overflow: "hidden" }}>
                            <div style={{
                              height: "100%",
                              width: `${result.total ? (f.remaining / result.total) * 100 : 0}%`,
                              background: "#3b82f6",
                            }} />
                          </div>
                          <span style={{ color: INK, fontWeight: 600, width: 46, textAlign: "right" }}>
                            {f.remaining}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div style={card}>
            <h3 style={{ color: INK, margin: "0 0 12px" }}>결과</h3>
            {result.rows.length === 0 ? (
              <p style={{ color: "#64748b", fontSize: 13 }}>
                조건을 만족하는 종목이 없다. 위 표에서 어느 조건이 걸렀는지 보고 완화해 보라.
              </p>
            ) : (
              <div style={{ maxHeight: 520, overflowY: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${GRID}` }}>
                      {["종목", "업종", "종가", "이격도", "거래대금", "5일", "20일", "외국인", "기관"].map((h) => (
                        <th key={h} style={{ color: MUTED, textAlign: "left", padding: "8px 10px", fontWeight: 600 }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((r: ScanRow) => (
                      <tr key={r.ticker} style={{ borderBottom: "1px solid #1e293b" }}>
                        <td style={{ padding: "8px 10px" }}>
                          <Link to={`/data/${encodeURIComponent(r.ticker)}`} style={{ color: "#3b82f6", textDecoration: "none", fontWeight: 600 }}>
                            {r.name || r.ticker}
                          </Link>
                          <div style={{ color: "#475569", fontSize: 11 }}>{r.ticker}</div>
                        </td>
                        <td style={{ color: MUTED, padding: "8px 10px", maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {r.industry ?? "—"}
                        </td>
                        <td style={{ color: INK, padding: "8px 10px" }}>{r.close.toLocaleString()}</td>
                        <td style={{ color: sign(r.disparity_20), padding: "8px 10px" }}>{pct(r.disparity_20)}</td>
                        <td style={{ color: INK, padding: "8px 10px" }}>
                          {r.turnover_ratio === null ? "—" : `${r.turnover_ratio.toFixed(2)}×`}
                        </td>
                        <td style={{ color: sign(r.return_5d), padding: "8px 10px" }}>{pct(r.return_5d)}</td>
                        <td style={{ color: sign(r.return_20d), padding: "8px 10px" }}>{pct(r.return_20d)}</td>
                        <td style={{ color: sign(r.frgn_ntby_20d), padding: "8px 10px" }}>{shares(r.frgn_ntby_20d)}</td>
                        <td style={{ color: sign(r.orgn_ntby_20d), padding: "8px 10px" }}>{shares(r.orgn_ntby_20d)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
