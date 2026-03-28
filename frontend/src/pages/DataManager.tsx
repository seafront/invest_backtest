import { useState, useEffect } from "react";
import type { TickerInfo } from "../types";
import { fetchStockData, listTickers } from "../api/client";

export default function DataManager() {
  const [tickers, setTickers] = useState<TickerInfo[]>([]);
  const [ticker, setTicker] = useState("AAPL");
  const [startDate, setStartDate] = useState("2020-01-01");
  const [endDate, setEndDate] = useState("2025-12-31");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const loadTickers = () => {
    listTickers().then((r) => setTickers(r.data));
  };

  useEffect(() => {
    loadTickers();
  }, []);

  const handleFetch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticker) return;
    setLoading(true);
    setMessage("");
    try {
      const res = await fetchStockData(ticker.toUpperCase(), startDate, endDate);
      setMessage(`Fetched ${res.data.length} records for ${ticker.toUpperCase()}`);
      loadTickers();
    } catch (err: any) {
      setMessage(`Error: ${err.response?.data?.detail || err.message}`);
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

  return (
    <div>
      <h2 style={{ color: "#e2e8f0", marginBottom: 20 }}>Data Manager</h2>

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
                  <td style={{ color: "#3b82f6", padding: "8px 12px", fontWeight: 600 }}>
                    {t.ticker}
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
    </div>
  );
}
