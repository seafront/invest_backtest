import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import type { MacroCatalogItem, MacroSeriesInfo, TickerInfo } from "../types";
import {
  fetchMacroSeries,
  fetchStockData,
  listMacroCatalog,
  listMacroSeries,
  listTickers,
} from "../api/client";
import { errMessage } from "../utils/error";

const FREQ_LABEL: Record<string, string> = {
  daily: "일",
  weekly: "주",
  monthly: "월",
  quarterly: "분기",
};

export default function DataManager() {
  const [tab, setTab] = useState<"stocks" | "macro">("stocks");

  const [tickers, setTickers] = useState<TickerInfo[]>([]);
  const [ticker, setTicker] = useState("AAPL");
  const [startDate, setStartDate] = useState("2020-01-01");
  const [endDate, setEndDate] = useState("2025-12-31");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const [catalog, setCatalog] = useState<MacroCatalogItem[]>([]);
  const [seriesId, setSeriesId] = useState("");
  const [macro, setMacro] = useState<MacroSeriesInfo[]>([]);

  const loadTickers = () => {
    listTickers().then((r) => setTickers(r.data));
  };

  const loadMacro = () => {
    listMacroSeries().then((r) => setMacro(r.data));
  };

  useEffect(() => {
    loadTickers();
    loadMacro();
    listMacroCatalog().then((r) => {
      setCatalog(r.data);
      setSeriesId((prev) => prev || r.data[0]?.series_id || "");
    });
  }, []);

  const handleFetchMacro = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!seriesId) return;
    setLoading(true);
    setMessage("");
    try {
      const res = await fetchMacroSeries(seriesId);
      setMessage(`${res.data.name} — ${res.data.count.toLocaleString()}개 관측치 저장됨`);
      loadMacro();
    } catch (err: unknown) {
      setMessage(`Error: ${errMessage(err)}`);
    } finally {
      setLoading(false);
    }
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
          <form
            onSubmit={handleFetchMacro}
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
            <div style={{ flex: 1, minWidth: 280 }}>
              <label style={{ color: "#94a3b8", fontSize: 13, display: "block", marginBottom: 4 }}>
                지표 (FRED)
              </label>
              <select
                value={seriesId}
                onChange={(e) => setSeriesId(e.target.value)}
                style={{ ...inputStyle, width: "100%" }}
              >
                {catalog.map((c) => (
                  <option key={c.series_id} value={c.series_id}>
                    {c.name} · {c.series_id} ({FREQ_LABEL[c.frequency] ?? c.frequency})
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={loading || !seriesId}
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
              {loading ? "받는 중..." : "지표 받기"}
            </button>
          </form>

          {catalog.find((c) => c.series_id === seriesId) && (
            <p style={{ color: "#64748b", fontSize: 13, marginTop: -12, marginBottom: 24 }}>
              {catalog.find((c) => c.series_id === seriesId)!.description}
            </p>
          )}

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
                    <tr key={m.series_id} style={{ borderBottom: "1px solid #1e293b" }}>
                      <td style={{ padding: "8px 12px", fontWeight: 600 }}>
                        <Link
                          to={`/data/macro/${encodeURIComponent(m.series_id)}`}
                          style={{ color: "#3b82f6", textDecoration: "none" }}
                        >
                          {m.name} →
                        </Link>
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
        <h3 style={{ color: "#e2e8f0", marginBottom: 12 }}>Cached Data</h3>
        {tickers.length === 0 ? (
          <p style={{ color: "#64748b" }}>No data cached yet. Fetch some stock data above.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #334155" }}>
                {["Ticker", "Start", "End", "Records"].map((h) => (
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
              {tickers.map((t) => (
                <tr key={t.ticker} style={{ borderBottom: "1px solid #1e293b" }}>
                  <td style={{ padding: "8px 12px", fontWeight: 600 }}>
                    <Link
                      to={`/data/${encodeURIComponent(t.ticker)}`}
                      style={{ color: "#3b82f6", textDecoration: "none" }}
                    >
                      {t.ticker} →
                    </Link>
                  </td>
                  <td style={{ color: "#e2e8f0", padding: "8px 12px" }}>{t.start_date}</td>
                  <td style={{ color: "#e2e8f0", padding: "8px 12px" }}>{t.end_date}</td>
                  <td style={{ color: "#e2e8f0", padding: "8px 12px" }}>{t.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
        </>
      )}
    </div>
  );
}
