import { Fragment, useState, useEffect } from "react";
import { MacroPreview, StockPreview } from "../components/DataPreview";
import type {
  BulkFetchStatus,
  MacroCatalogItem,
  MacroSeriesInfo,
  TickerInfo,
  UniverseInfo,
} from "../types";
import {
  fetchMacroSeries,
  fetchStockData,
  getBulkFetchStatus,
  listMacroCatalog,
  listMacroSeries,
  listTickers,
  listUniverses,
  refreshCachedData,
  startBulkFetch,
  startBulkFundamentals,
  syncUniverses,
} from "../api/client";
import { errMessage } from "../utils/error";

const FREQ_LABEL: Record<string, string> = {
  daily: "일",
  weekly: "주",
  monthly: "월",
  quarterly: "분기",
};

/** YYYY-MM-DD (로컬 시간대 기준). toISOString은 UTC라 새벽에 하루가 밀린다. */
function isoDay(d: Date): string {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

const today = isoDay(new Date());
const REFRESH_START = "2000-01-01";

/** 지수 배지 색. 편입 여부는 배지 유무로도 드러나므로 색은 구분용일 뿐이다. */
const BADGE: Record<string, string> = {
  sp500: "#8b5cf6",
  nasdaq100: "#0891b2",
};

/** S&P 500 일괄 수집 구간. 503종목 26년치는 650MB가 넘어 5년으로 잡는다. */
const BULK_YEARS = 5;
const bulkStart = isoDay(new Date(new Date().setFullYear(new Date().getFullYear() - BULK_YEARS)));

export default function DataManager() {
  const [tab, setTab] = useState<"stocks" | "macro">("stocks");

  const [tickers, setTickers] = useState<TickerInfo[]>([]);
  const [ticker, setTicker] = useState("AAPL");
  const [startDate, setStartDate] = useState("2000-01-01");
  // yfinance의 end는 미포함 경계다. 오늘을 넣으면 어제 종가까지 받아지므로
  // 마감된 세션만 들어온다 — 미완성인 당일 봉이 섞이지 않는다.
  const [endDate, setEndDate] = useState(today);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const [catalog, setCatalog] = useState<MacroCatalogItem[]>([]);
  // 어느 지표를 받는 중인지. 버튼마다 상태를 따로 보여줘야 해서 boolean으로는 부족하다.
  const [fetchingSeries, setFetchingSeries] = useState("");
  // 설명을 붙일 지표. 버튼 여덟 개에 설명을 모두 달면 격자가 읽히지 않으므로
  // 가리키는 것 하나만 아래에 펼친다.
  const [hoverSeries, setHoverSeries] = useState("");
  const [macro, setMacro] = useState<MacroSeriesInfo[]>([]);

  // 목록에서 펼쳐 둔 행. 전체 분석은 상세 페이지가 맡고 여기서는 요약만 보여준다.
  const [refreshing, setRefreshing] = useState(false);
  const [bulk, setBulk] = useState<BulkFetchStatus | null>(null);
  const [universes, setUniverses] = useState<UniverseInfo[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [query, setQuery] = useState("");
  // 비어 있으면 전체를 보여준다. 칩을 켤수록 좁혀지는 것이 아니라 넓어지는 OR 조건이다.
  const [indexFilter, setIndexFilter] = useState<string[]>([]);
  const [sector, setSector] = useState("");
  const [openTicker, setOpenTicker] = useState("");
  const [openSeries, setOpenSeries] = useState("");

  const loadTickers = () => {
    listTickers().then((r) => setTickers(r.data));
  };

  useEffect(() => {
    listUniverses()
      .then((r) => setUniverses(r.data))
      .catch(() => setUniverses([]));
  }, []);

  // 진행 중인 작업이 있으면 이어받는다. 새로고침해도 진행률이 끊기지 않아야 한다.
  useEffect(() => {
    getBulkFetchStatus()
      .then((r) => setBulk(r.data.started_at ? r.data : null))
      .catch(() => setBulk(null));
  }, []);

  useEffect(() => {
    if (!bulk?.running) return;
    const id = setInterval(() => {
      getBulkFetchStatus()
        .then((r) => {
          setBulk(r.data);
          if (!r.data.running) loadTickers();
        })
        .catch(() => undefined);
    }, 2000);
    return () => clearInterval(id);
  }, [bulk?.running]);

  const handleSync = async () => {
    setSyncing(true);
    setMessage("");
    try {
      const { data } = await syncUniverses();
      const parts = Object.entries(data).map(([key, val]) => {
        const label = universes.find((u) => u.key === key)?.label ?? key;
        return typeof val === "number" ? `${label} ${val}종목` : `${label} ${val}`;
      });
      setMessage(`편입 정보 갱신 완료 · ${parts.join(" · ")}`);
      loadTickers();
    } catch (e) {
      setMessage(`동기화 실패: ${errMessage(e)}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleBulkFundamentals = async (universe: string) => {
    if (starting || bulk?.running) return;
    setStarting(true);
    try {
      const { data } = await startBulkFundamentals(universe);
      setBulk(data);
    } catch {
      /* 진행 중인 작업이 있으면 409. 아래 진행률이 그 작업을 이미 보여준다. */
    } finally {
      setStarting(false);
    }
  };

  const handleBulk = async (universe: string) => {
    if (starting || bulk?.running) return;
    setStarting(true);
    setMessage("");
    try {
      const { data } = await startBulkFetch(universe, bulkStart, today);
      setBulk(data);
    } catch (e) {
      setMessage(`일괄 수집 실패: ${errMessage(e)}`);
    } finally {
      setStarting(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setMessage(`전체 업데이트 중… ${tickers.length}개 종목 (${REFRESH_START} ~ ${today})`);
    try {
      const { data } = await refreshCachedData(REFRESH_START, today);
      const failed = data.filter((r) => r.error);
      const added = data.reduce((sum, r) => sum + r.added, 0);
      const head = `${data.length - failed.length}/${data.length}개 완료 · 신규 ${added.toLocaleString()}행`;
      setMessage(
        failed.length === 0
          ? head
          : `${head} · 실패: ${failed.map((r) => `${r.ticker}(${r.error})`).join(", ")}`
      );
      loadTickers();
    } catch (e) {
      setMessage(`업데이트 실패: ${errMessage(e)}`);
    } finally {
      setRefreshing(false);
    }
  };

  // 카탈로그를 묶음별로 나눈다. 서버가 category를 주지 않던 시절 응답도 있으므로
  // 없으면 "기타"로 모은다.
  const grouped = catalog.reduce<Record<string, MacroCatalogItem[]>>((acc, c) => {
    const key = c.category ?? "기타";
    (acc[key] ??= []).push(c);
    return acc;
  }, {});
  // 서버가 준 순서를 그대로 쓰되, 중복은 뺀다.
  const CATEGORY_ORDER = [...new Set(catalog.map((c) => c.category ?? "기타"))];
  const cachedIds = new Set(macro.map((m) => m.series_id));
  const hoverItem = catalog.find((c) => c.series_id === hoverSeries);

  const loadMacro = () => {
    listMacroSeries().then((r) => setMacro(r.data));
  };

  useEffect(() => {
    loadTickers();
    loadMacro();
    listMacroCatalog().then((r) => setCatalog(r.data));
  }, []);

  const handleFetchMacro = async (id: string) => {
    if (fetchingSeries) return;
    setFetchingSeries(id);
    setMessage("");
    try {
      const res = await fetchMacroSeries(id);
      setMessage(`${res.data.name} — ${res.data.count.toLocaleString()}개 관측치 저장됨`);
      loadMacro();
    } catch (err: unknown) {
      setMessage(`Error: ${errMessage(err)}`);
    } finally {
      setFetchingSeries("");
    }
  };

  /** 카탈로그 전체를 차례로 받는다. FRED는 키가 없어 병렬로 몰아치지 않는다. */
  const handleFetchAllMacro = async () => {
    if (fetchingSeries) return;
    setMessage("");
    let saved = 0;
    for (const item of catalog) {
      setFetchingSeries(item.series_id);
      try {
        const res = await fetchMacroSeries(item.series_id);
        saved += res.data.count;
      } catch (err: unknown) {
        setMessage(`Error: ${item.name} — ${errMessage(err)}`);
        break;
      }
    }
    setFetchingSeries("");
    loadMacro();
    if (saved > 0) setMessage(`${catalog.length}개 지표 · 관측치 ${saved.toLocaleString()}개 저장됨`);
  };

  const handleFetch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticker) return;
    setLoading(true);
    setMessage("");
    try {
      const res = await fetchStockData(ticker.toUpperCase(), startDate, endDate);
      setMessage(`Fetched ${res.data.length} records for ${ticker.toUpperCase()}`);
      loadTickers();
    } catch (err: unknown) {
      setMessage(`Error: ${errMessage(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: 6,
    color: "#e2e8f0",
    padding: "8px 12px",
    fontSize: 14,
  };

  // 표 안에서 펼침을 토글하는 버튼. 링크처럼 보이되 키보드로도 접근된다.
  const rowToggle: React.CSSProperties = {
    background: "none",
    border: "none",
    padding: 0,
    color: "#3b82f6",
    font: "inherit",
    fontWeight: 600,
    cursor: "pointer",
  };

  const toggleIndex = (key: string) =>
    setIndexFilter((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );

  // 섹터는 미국 종목만 채워진다 — 한국은 네이버 업종(산업 수준)만 있고
  // 이를 GICS 섹터로 올리려면 손으로 만든 매핑표가 필요하다.
  const sectors = [...new Set(tickers.map((t) => t.sector).filter(Boolean))].sort() as string[];

  // 한국 종목은 KRX 업종(KSIC)을 보여준다 — 코스피 200을 산출하는 쪽의 기준이다.
  // GICS 계열 값(industry)은 시장 간 비교용으로 함께 두고 툴팁에 띄운다.
  const shownIndustry = (t: TickerInfo) => t.industry_krx ?? t.industry;
  const otherIndustry = (t: TickerInfo) => (t.industry_krx ? t.industry : null);

  const q = query.trim().toLowerCase();
  const visible = tickers.filter((t) => {
    const matchesQuery =
      !q ||
      t.ticker.toLowerCase().includes(q) ||
      (t.name ?? "").toLowerCase().includes(q) ||
      (t.industry ?? "").toLowerCase().includes(q) ||
      (t.industry_krx ?? "").toLowerCase().includes(q);
    const matchesIndex =
      indexFilter.length === 0 ||
      indexFilter.some((k) => (k === "none" ? t.universes.length === 0 : t.universes.includes(k)));
    const matchesSector = !sector || t.sector === sector;
    return matchesQuery && matchesIndex && matchesSector;
  });

  const chipStyle = (active: boolean): React.CSSProperties => ({
    background: active ? "#334155" : "transparent",
    color: active ? "#e2e8f0" : "#94a3b8",
    border: `1px solid ${active ? "#475569" : "#334155"}`,
    borderRadius: 999,
    padding: "4px 12px",
    fontSize: 12,
    cursor: "pointer",
  });

  const tabStyle = (active: boolean): React.CSSProperties => ({
    background: active ? "#334155" : "transparent",
    color: active ? "#e2e8f0" : "#94a3b8",
    border: "1px solid #334155",
    borderRadius: 6,
    padding: "8px 20px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  });

  return (
    <div>
      <h2 style={{ color: "#e2e8f0", marginBottom: 16 }}>Data Manager</h2>

      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <button style={tabStyle(tab === "stocks")} onClick={() => { setTab("stocks"); setMessage(""); }}>
          종목 ({tickers.length})
        </button>
        <button style={tabStyle(tab === "macro")} onClick={() => { setTab("macro"); setMessage(""); }}>
          지표 ({macro.length})
        </button>
      </div>

      {tab === "macro" ? (
        <>
          <div style={{ background: "#1e1e2e", borderRadius: 8, padding: 24, marginBottom: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
              <h3 style={{ color: "#e2e8f0", margin: 0 }}>지표 받기</h3>
              <button
                type="button"
                onClick={handleFetchAllMacro}
                disabled={!!fetchingSeries || catalog.length === 0}
                style={{
                  background: "transparent",
                  color: fetchingSeries ? "#64748b" : "#94a3b8",
                  border: "1px solid #334155", borderRadius: 6, padding: "6px 14px",
                  fontSize: 12, cursor: fetchingSeries ? "default" : "pointer",
                }}
              >
                전체 받기 ({catalog.length})
              </button>
            </div>
            <p style={{ color: "#64748b", fontSize: 13, margin: "6px 0 16px" }}>
              FRED는 API 키가 필요 없다. 이미 받은 지표는 다시 눌러 갱신한다.
            </p>

            {CATEGORY_ORDER.filter((c) => grouped[c]?.length).map((category) => (
              <div key={category} style={{ marginBottom: 14 }}>
                <div style={{ color: "#64748b", fontSize: 12, marginBottom: 6 }}>{category}</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {grouped[category].map((c) => {
                    const cached = cachedIds.has(c.series_id);
                    const busy = fetchingSeries === c.series_id;
                    return (
                      <button
                        key={c.series_id}
                        type="button"
                        onClick={() => handleFetchMacro(c.series_id)}
                        onMouseEnter={() => setHoverSeries(c.series_id)}
                        onMouseLeave={() => setHoverSeries("")}
                        onFocus={() => setHoverSeries(c.series_id)}
                        onBlur={() => setHoverSeries("")}
                        disabled={!!fetchingSeries}
                        title={c.description}
                        style={{
                          background: busy ? "#334155" : "transparent",
                          // 이미 받은 지표는 테두리를 죽인다. 받아야 할 것이 무엇인지가
                          // 이 화면에서 알고 싶은 것이지, 무엇을 받았는지가 아니다.
                          border: `1px solid ${cached ? "#334155" : "#3b82f6"}`,
                          borderRadius: 6,
                          padding: "8px 14px",
                          textAlign: "left",
                          cursor: fetchingSeries ? "default" : "pointer",
                          minWidth: 150,
                        }}
                      >
                        <div style={{ color: fetchingSeries && !busy ? "#64748b" : "#e2e8f0", fontSize: 13, fontWeight: 600 }}>
                          {cached && <span style={{ color: "#10b981" }}>✓ </span>}
                          {c.name}
                        </div>
                        <div style={{ color: "#64748b", fontSize: 11, marginTop: 2 }}>
                          {busy ? "받는 중…" : `${c.series_id} · ${FREQ_LABEL[c.frequency] ?? c.frequency}`}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {hoverItem && (
              <p style={{ color: "#94a3b8", fontSize: 13, margin: "12px 0 0", minHeight: 20 }}>
                <span style={{ color: "#e2e8f0" }}>{hoverItem.name}</span> · {hoverItem.unit} —{" "}
                {hoverItem.description}
              </p>
            )}
          </div>

          {message && (
            <div
              style={{
                background: message.startsWith("Error") ? "#7f1d1d" : "#14532d",
                color: "#e2e8f0",
                padding: "10px 16px",
                borderRadius: 6,
                marginBottom: 24,
                fontSize: 14,
              }}
            >
              {message}
            </div>
          )}

          <div style={{ background: "#1e1e2e", borderRadius: 8, padding: 24 }}>
            <h3 style={{ color: "#e2e8f0", marginBottom: 12 }}>저장된 지표</h3>
            {macro.length === 0 ? (
              <p style={{ color: "#64748b" }}>
                아직 받은 지표가 없습니다. 위에서 선택해 받아오세요. FRED는 API 키가 필요 없습니다.
              </p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #334155" }}>
                    {["지표", "코드", "주기", "단위", "시작", "종료", "관측치"].map((h) => (
                      <th key={h} style={{ color: "#94a3b8", textAlign: "left", padding: "8px 12px", fontWeight: 600 }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {macro.map((m) => (
                    <Fragment key={m.series_id}>
                    <tr style={{ borderBottom: "1px solid #1e293b" }}>
                      <td style={{ padding: "8px 12px", fontWeight: 600 }}>
                        <button
                          type="button"
                          style={rowToggle}
                          aria-expanded={openSeries === m.series_id}
                          onClick={() => setOpenSeries(openSeries === m.series_id ? "" : m.series_id)}
                        >
                          {m.name} {openSeries === m.series_id ? "▾" : "▸"}
                        </button>
                      </td>
                      <td style={{ color: "#64748b", padding: "8px 12px", fontSize: 12 }}>{m.series_id}</td>
                      <td style={{ color: "#94a3b8", padding: "8px 12px" }}>
                        {FREQ_LABEL[m.frequency] ?? m.frequency}
                      </td>
                      <td style={{ color: "#94a3b8", padding: "8px 12px" }}>{m.unit}</td>
                      <td style={{ color: "#e2e8f0", padding: "8px 12px" }}>{m.start_date}</td>
                      <td style={{ color: "#e2e8f0", padding: "8px 12px" }}>{m.end_date}</td>
                      <td style={{ color: "#e2e8f0", padding: "8px 12px" }}>{m.count.toLocaleString()}</td>
                    </tr>
                    {openSeries === m.series_id && (
                      <tr>
                        <td colSpan={7} style={{ padding: 0 }}>
                          <MacroPreview seriesId={m.series_id} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : (
        <>
      <form
        onSubmit={handleFetch}
        style={{
          background: "#1e1e2e",
          borderRadius: 8,
          padding: 24,
          marginBottom: 24,
          display: "flex",
          gap: 12,
          alignItems: "flex-end",
          flexWrap: "wrap",
        }}
      >
        <div>
          <label style={{ color: "#94a3b8", fontSize: 13, display: "block", marginBottom: 4 }}>
            Ticker
          </label>
          <input
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            placeholder="e.g. AAPL"
            style={{ ...inputStyle, width: 120 }}
          />
        </div>
        <div>
          <label style={{ color: "#94a3b8", fontSize: 13, display: "block", marginBottom: 4 }}>
            Start Date
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={inputStyle}
          />
        </div>
        <div>
          <label style={{ color: "#94a3b8", fontSize: 13, display: "block", marginBottom: 4 }}>
            End Date
          </label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            style={inputStyle}
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          style={{
            background: loading ? "#334155" : "#3b82f6",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            padding: "9px 20px",
            fontSize: 14,
            fontWeight: 600,
            cursor: loading ? "wait" : "pointer",
          }}
        >
          {loading ? "Fetching..." : "Fetch Data"}
        </button>
      </form>

      {message && (
        <div
          style={{
            background: message.startsWith("Error") ? "#7f1d1d" : "#14532d",
            color: "#e2e8f0",
            padding: "10px 16px",
            borderRadius: 6,
            marginBottom: 24,
            fontSize: 14,
          }}
        >
          {message}
        </div>
      )}

      <div style={{ background: "#1e1e2e", borderRadius: 8, padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
          <h3 style={{ color: "#e2e8f0", margin: 0 }}>Cached Data</h3>
          {tickers.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ color: "#64748b", fontSize: 12 }}>
                {REFRESH_START} ~ {today}
              </span>
              <button
                type="button"
                onClick={handleRefresh}
                disabled={refreshing || bulk?.running}
                style={{
                  background: refreshing ? "#334155" : "#3b82f6",
                  color: refreshing ? "#94a3b8" : "#fff",
                  border: "none",
                  borderRadius: 6,
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: refreshing || bulk?.running ? "default" : "pointer",
                }}
              >
                {refreshing ? "업데이트 중…" : `전체 업데이트 (${tickers.length})`}
              </button>
            </div>
          )}
        </div>
        {universes.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            <span style={{ color: "#64748b", fontSize: 12 }}>
              지수 일괄 수집 {BULK_YEARS}년치 ({bulkStart} ~ {today})
              <span title="한국 종목은 시세를 받은 뒤 외국인·기관·개인 매매동향을 같은 5년 구간으로 이어서 받습니다. 처음에는 2시간 이상 걸리고, 두 번째부터는 빠릅니다. 증권사 API 키가 없으면 건너뜁니다.">
                {" "}· 국내 종목은 수급 포함
              </span>
            </span>
            {universes.map((u) => (
              <button
                key={u.key}
                type="button"
                onClick={() => handleBulk(u.key)}
                disabled={bulk?.running || refreshing || starting}
                style={{
                  background: "transparent",
                  color: bulk?.running || refreshing || starting ? "#64748b" : "#e2e8f0",
                  border: "1px solid #334155",
                  borderRadius: 6,
                  padding: "6px 14px",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: bulk?.running || refreshing || starting ? "default" : "pointer",
                }}
              >
                {u.label}
              </button>
            ))}

            <span style={{ color: "#334155" }}>|</span>
            <span style={{ color: "#64748b", fontSize: 12 }}>
              재무만
              <span title="한국 종목은 한국투자증권에서 분기 30개·연간 23개를, 그 외는 yfinance에서 5개씩 받습니다. 종목당 여섯 번 호출하고 0.6초씩 쉬므로 200종목에 12분쯤 걸립니다.">
                {" "}(종목당 6호출)
              </span>
            </span>
            {universes.map((u) => (
              <button
                key={`fund-${u.key}`}
                type="button"
                onClick={() => handleBulkFundamentals(u.key)}
                disabled={bulk?.running || refreshing || starting}
                style={{
                  background: "transparent",
                  color: bulk?.running || refreshing || starting ? "#64748b" : "#94a3b8",
                  border: "1px solid #334155",
                  borderRadius: 6,
                  padding: "6px 12px",
                  fontSize: 12,
                  cursor: bulk?.running || refreshing || starting ? "default" : "pointer",
                }}
              >
                {u.label}
              </button>
            ))}

            <span style={{ color: "#334155" }}>|</span>
            <button
              type="button"
              onClick={handleSync}
              disabled={syncing || bulk?.running}
              title="시세는 받지 않고 구성종목·회사 이름만 갱신합니다"
              style={{
                background: "transparent",
                color: syncing || bulk?.running ? "#64748b" : "#94a3b8",
                border: "1px solid #334155",
                borderRadius: 6,
                padding: "6px 14px",
                fontSize: 12,
                cursor: syncing || bulk?.running ? "default" : "pointer",
              }}
            >
              {syncing ? "동기화 중…" : "편입 정보 동기화"}
            </button>
          </div>
        )}

        {bulk && (() => {
          const [phaseDone, phaseTotal] =
            bulk.phase === "flows"
              ? [bulk.flow_done, bulk.flow_total]
              : bulk.phase === "fundamentals"
                ? [bulk.fund_done, bulk.fund_total]
                : [bulk.done, bulk.total];
          const progress = phaseTotal > 0 ? phaseDone / phaseTotal : 0;
          return (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>
              <span>
                {bulk.universe} {bulk.running ? "수집 중" : "수집 완료"}
                {bulk.phase === "flows" ? (
                  <> · 수급 {bulk.flow_done}/{bulk.flow_total}종목 · 신규 {bulk.flow_added.toLocaleString()}일</>
                ) : bulk.phase === "fundamentals" || (!bulk.running && bulk.fund_total > 0) ? (
                  <> · 재무 {bulk.fund_done}/{bulk.fund_total}종목 · 신규 {bulk.fund_added.toLocaleString()}기간</>
                ) : (
                  <> · 시세 {bulk.done}/{bulk.total}종목 · 신규 {bulk.added.toLocaleString()}행</>
                )}
                {bulk.flow_added > 0 && bulk.phase !== "flows" && ` · 수급 ${bulk.flow_added.toLocaleString()}일`}
                {bulk.failed.length > 0 && ` · 실패 ${bulk.failed.length}건`}
              </span>
              <span>{Math.min(100, Math.round(progress * 100))}%</span>
            </div>
            <div style={{ height: 6, background: "#0f172a", borderRadius: 3, overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${Math.min(100, progress * 100)}%`,
                  background: bulk.running ? "#3b82f6" : "#10b981",
                  transition: "width .3s",
                }}
              />
            </div>
            {bulk.failed.length > 0 && (
              <p style={{ color: "#64748b", fontSize: 11, marginTop: 6 }}>
                실패: {bulk.failed.slice(0, 3).join(", ")}
                {bulk.failed.length > 3 && ` 외 ${bulk.failed.length - 3}건`}
              </p>
            )}
          </div>
          );
        })()}

        {tickers.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="티커 또는 회사 이름 검색"
              style={{
                background: "#0f172a",
                border: "1px solid #334155",
                borderRadius: 6,
                color: "#e2e8f0",
                padding: "7px 12px",
                fontSize: 13,
                width: 240,
              }}
            />
            <select
              value={sector}
              onChange={(e) => setSector(e.target.value)}
              style={{
                background: "#0f172a",
                border: "1px solid #334155",
                borderRadius: 6,
                color: sector ? "#e2e8f0" : "#94a3b8",
                padding: "7px 10px",
                fontSize: 13,
              }}
            >
              <option value="">전체 섹터 (GICS)</option>
              {sectors.map((sc) => (
                <option key={sc} value={sc}>{sc}</option>
              ))}
            </select>
            {[...universes.map((u) => ({ key: u.key, label: u.label })), { key: "none", label: "미분류" }].map((c) => (
              <button key={c.key} type="button" onClick={() => toggleIndex(c.key)}
                      aria-pressed={indexFilter.includes(c.key)} style={chipStyle(indexFilter.includes(c.key))}>
                {c.label}
              </button>
            ))}
            {(q || indexFilter.length > 0 || sector) && (
              <button
                type="button"
                onClick={() => { setQuery(""); setIndexFilter([]); setSector(""); }}
                style={{ background: "none", border: "none", color: "#3b82f6", fontSize: 12, cursor: "pointer" }}
              >
                초기화
              </button>
            )}
            <span style={{ color: "#64748b", fontSize: 12, marginLeft: "auto" }}>
              {visible.length === tickers.length
                ? `${tickers.length}개`
                : `${visible.length} / ${tickers.length}개`}
            </span>
          </div>
        )}

        {tickers.length === 0 ? (
          <p style={{ color: "#64748b" }}>No data cached yet. Fetch some stock data above.</p>
        ) : (
          <div style={{ maxHeight: 460, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #334155" }}>
                {["Ticker", "Name", "업종", "Index", "Start", "End", "Records"].map((h) => (
                  <th
                    key={h}
                    style={{ color: "#94a3b8", textAlign: "left", padding: "8px 12px", fontWeight: 600 }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((t) => (
                <Fragment key={t.ticker}>
                  <tr style={{ borderBottom: "1px solid #1e293b" }}>
                    <td style={{ padding: "8px 12px", fontWeight: 600 }}>
                      <button
                        type="button"
                        style={rowToggle}
                        aria-expanded={openTicker === t.ticker}
                        onClick={() => setOpenTicker(openTicker === t.ticker ? "" : t.ticker)}
                      >
                        {t.ticker} {openTicker === t.ticker ? "▾" : "▸"}
                      </button>
                    </td>
                    <td style={{ color: "#94a3b8", padding: "8px 12px", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t.name ?? "—"}
                    </td>
                    <td
                      title={[t.sector, otherIndustry(t) && `GICS 계열: ${otherIndustry(t)}`]
                        .filter(Boolean)
                        .join(" · ") || undefined}
                      style={{ color: "#94a3b8", padding: "8px 12px", fontSize: 13, maxWidth: 190,
                               overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    >
                      {shownIndustry(t) ?? "—"}
                    </td>
                    <td style={{ padding: "8px 12px" }}>
                      {t.universes.length === 0 ? (
                        <span style={{ color: "#475569", fontSize: 12 }}>—</span>
                      ) : (
                        <span style={{ display: "flex", gap: 4 }}>
                          {t.universes.map((u) => (
                            <span
                              key={u}
                              title={universes.find((x) => x.key === u)?.label ?? u}
                              style={{
                                border: `1px solid ${BADGE[u] ?? "#334155"}`,
                                color: BADGE[u] ?? "#94a3b8",
                                borderRadius: 4,
                                padding: "1px 6px",
                                fontSize: 11,
                                fontWeight: 600,
                              }}
                            >
                              {universes.find((x) => x.key === u)?.label ?? u}
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                    <td style={{ color: "#e2e8f0", padding: "8px 12px" }}>{t.start_date}</td>
                    <td style={{ color: "#e2e8f0", padding: "8px 12px" }}>{t.end_date}</td>
                    <td style={{ color: "#e2e8f0", padding: "8px 12px" }}>{t.count}</td>
                  </tr>
                  {openTicker === t.ticker && (
                    <tr>
                      <td colSpan={7} style={{ padding: 0 }}>
                        <StockPreview ticker={t.ticker} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          {visible.length === 0 && (
            <p style={{ color: "#64748b", fontSize: 13, padding: "16px 12px", margin: 0 }}>
              조건에 맞는 종목이 없습니다.
            </p>
          )}
          </div>
        )}
      </div>
        </>
      )}
    </div>
  );
}
