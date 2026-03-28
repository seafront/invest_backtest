import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { MarketCapResult, StrategyScreenResult, FullScreenResponse } from "../types";
import { fullScreening } from "../api/client";

export default function Screener() {
  const [startDate, setStartDate] = useState("2022-01-01");
  const [endDate, setEndDate] = useState("2024-12-31");
  const [capital, setCapital] = useState(100000);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"idle" | "running" | "done">("idle");
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<FullScreenResponse | null>(null);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleRun = async () => {
    setLoading(true);
    setStep("running");
    setError("");
    setResult(null);
    setProgress("Step 1: Fetching market cap data for 50 stocks...");

    try {
      const res = await fullScreening({
        market_cap_top: 5,
        strategy_top: 2,
        start_date: startDate,
        end_date: endDate,
        initial_capital: capital,
      });
      setResult(res.data);
      setStep("done");
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message);
      setStep("idle");
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

  const labelStyle: React.CSSProperties = {
    color: "#94a3b8",
    fontSize: 13,
    display: "block",
    marginBottom: 4,
  };

  return (
    <div>
      <h2 style={{ color: "#e2e8f0", marginBottom: 8 }}>Stock Screener</h2>
      <p style={{ color: "#64748b", fontSize: 14, marginBottom: 20 }}>
        Step 1: Market cap Top 5 &rarr; Step 2: Best strategy Top 2
      </p>

      {/* Config */}
      <div
        style={{
          background: "#1e1e2e",
          borderRadius: 8,
          padding: 24,
          marginBottom: 24,
          display: "flex",
          gap: 16,
          alignItems: "flex-end",
          flexWrap: "wrap",
        }}
      >
        <div>
          <label style={labelStyle}>Start Date</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>End Date</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Initial Capital ($)</label>
          <input
            type="number"
            value={capital}
            onChange={(e) => setCapital(Number(e.target.value))}
            min={1000}
            step={1000}
            style={{ ...inputStyle, width: 140 }}
          />
        </div>
        <button
          onClick={handleRun}
          disabled={loading}
          style={{
            background: loading ? "#334155" : "#8b5cf6",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            padding: "9px 24px",
            fontSize: 14,
            fontWeight: 600,
            cursor: loading ? "wait" : "pointer",
          }}
        >
          {loading ? "Screening..." : "Run Screening"}
        </button>
      </div>

      {/* Progress */}
      {loading && (
        <div style={{ background: "#1e1e2e", borderRadius: 8, padding: 20, marginBottom: 24, textAlign: "center" }}>
          <div className="spinner" style={{ margin: "0 auto 12px", width: 32, height: 32, border: "3px solid #334155", borderTop: "3px solid #8b5cf6", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
          <p style={{ color: "#94a3b8", fontSize: 14 }}>{progress}</p>
          <p style={{ color: "#64748b", fontSize: 12, marginTop: 4 }}>This may take 1-2 minutes...</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {error && (
        <div style={{ background: "#7f1d1d", color: "#e2e8f0", padding: "10px 16px", borderRadius: 6, marginBottom: 24, fontSize: 14 }}>
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <>
          {/* Step 1 Result: Market Cap Top 5 */}
          <div style={{ background: "#1e1e2e", borderRadius: 8, padding: 24, marginBottom: 24 }}>
            <h3 style={{ color: "#e2e8f0", marginBottom: 4 }}>Step 1: Market Cap Top 5</h3>
            <p style={{ color: "#64748b", fontSize: 13, marginBottom: 16 }}>50 major US stocks pool filtered by market capitalization</p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {result.market_cap_top.map((item, idx) => (
                <div
                  key={item.ticker}
                  style={{
                    background: "#0f172a",
                    borderRadius: 8,
                    padding: "16px 20px",
                    minWidth: 160,
                    flex: 1,
                    border: "1px solid #334155",
                  }}
                >
                  <div style={{ color: "#64748b", fontSize: 12, marginBottom: 4 }}>#{idx + 1}</div>
                  <div style={{ color: "#3b82f6", fontSize: 20, fontWeight: 700 }}>{item.ticker}</div>
                  <div style={{ color: "#94a3b8", fontSize: 14, marginTop: 4 }}>{item.market_cap_str}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Step 2 Result: Strategy Backtest Results */}
          <div style={{ background: "#1e1e2e", borderRadius: 8, padding: 24, marginBottom: 24 }}>
            <h3 style={{ color: "#e2e8f0", marginBottom: 4 }}>Step 2: Strategy Backtest (All Results)</h3>
            <p style={{ color: "#64748b", fontSize: 13, marginBottom: 16 }}>
              {result.market_cap_top.length} tickers &times; 3 strategies = {result.all_results.length} combinations ranked by return
            </p>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #334155" }}>
                    {["Rank", "Ticker", "Strategy", "Return", "Sharpe", "Max DD", "Win Rate", "Trades"].map((h) => (
                      <th key={h} style={{ color: "#94a3b8", textAlign: "left", padding: "8px 10px", fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.all_results.map((r, idx) => {
                    const isTopPick = result.top_picks.some(
                      (tp) => tp.ticker === r.ticker && tp.strategy_name === r.strategy_name
                    );
                    return (
                      <tr
                        key={`${r.ticker}-${r.strategy_name}`}
                        style={{
                          borderBottom: "1px solid #1e293b",
                          background: isTopPick ? "rgba(139, 92, 246, 0.1)" : "transparent",
                        }}
                      >
                        <td style={{ color: "#64748b", padding: "8px 10px" }}>
                          {idx + 1}
                          {isTopPick && <span style={{ color: "#8b5cf6", marginLeft: 6, fontWeight: 700 }}>TOP</span>}
                        </td>
                        <td style={{ color: "#3b82f6", padding: "8px 10px", fontWeight: 600 }}>{r.ticker}</td>
                        <td style={{ color: "#e2e8f0", padding: "8px 10px" }}>{r.strategy_display}</td>
                        <td style={{ color: r.total_return >= 0 ? "#22c55e" : "#ef4444", padding: "8px 10px", fontWeight: 600 }}>
                          {r.total_return.toFixed(2)}%
                        </td>
                        <td style={{ color: "#e2e8f0", padding: "8px 10px" }}>{r.sharpe_ratio.toFixed(2)}</td>
                        <td style={{ color: "#eab308", padding: "8px 10px" }}>{r.max_drawdown.toFixed(2)}%</td>
                        <td style={{ color: "#e2e8f0", padding: "8px 10px" }}>{r.win_rate.toFixed(1)}%</td>
                        <td style={{ color: "#94a3b8", padding: "8px 10px" }}>{r.trades_count}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Final Picks */}
          <div style={{ background: "#1e1e2e", borderRadius: 8, padding: 24, border: "2px solid #8b5cf6" }}>
            <h3 style={{ color: "#8b5cf6", marginBottom: 4 }}>Final Selection: Top 2 Picks</h3>
            <p style={{ color: "#64748b", fontSize: 13, marginBottom: 20 }}>
              Best performing ticker + strategy combination
            </p>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              {result.top_picks.map((pick, idx) => (
                <div
                  key={pick.ticker}
                  style={{
                    background: "#0f172a",
                    borderRadius: 8,
                    padding: 24,
                    flex: 1,
                    minWidth: 280,
                    border: "1px solid #8b5cf6",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <div>
                      <span style={{ color: "#8b5cf6", fontSize: 12, fontWeight: 600 }}>PICK #{idx + 1}</span>
                      <div style={{ color: "#e2e8f0", fontSize: 28, fontWeight: 700 }}>{pick.ticker}</div>
                    </div>
                    <div style={{ color: pick.total_return >= 0 ? "#22c55e" : "#ef4444", fontSize: 24, fontWeight: 700 }}>
                      {pick.total_return >= 0 ? "+" : ""}{pick.total_return.toFixed(2)}%
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                    <div>
                      <div style={{ color: "#64748b", fontSize: 12 }}>Strategy</div>
                      <div style={{ color: "#e2e8f0", fontSize: 14 }}>{pick.strategy_display}</div>
                    </div>
                    <div>
                      <div style={{ color: "#64748b", fontSize: 12 }}>Sharpe Ratio</div>
                      <div style={{ color: "#e2e8f0", fontSize: 14 }}>{pick.sharpe_ratio.toFixed(4)}</div>
                    </div>
                    <div>
                      <div style={{ color: "#64748b", fontSize: 12 }}>Max Drawdown</div>
                      <div style={{ color: "#eab308", fontSize: 14 }}>{pick.max_drawdown.toFixed(2)}%</div>
                    </div>
                    <div>
                      <div style={{ color: "#64748b", fontSize: 12 }}>Win Rate</div>
                      <div style={{ color: "#e2e8f0", fontSize: 14 }}>{pick.win_rate.toFixed(1)}%</div>
                    </div>
                  </div>

                  <button
                    onClick={() => navigate(`/backtest?ticker=${pick.ticker}&strategy=${pick.strategy_name}`)}
                    style={{
                      background: "#8b5cf6",
                      color: "#fff",
                      border: "none",
                      borderRadius: 6,
                      padding: "8px 16px",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                      width: "100%",
                    }}
                  >
                    Run Detailed Backtest &rarr;
                  </button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
