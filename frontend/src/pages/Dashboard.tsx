import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import type { BacktestSummary } from "../types";
import { listBacktests, deleteBacktest } from "../api/client";

export default function Dashboard() {
  const [backtests, setBacktests] = useState<BacktestSummary[]>([]);
  const navigate = useNavigate();

  const load = () => {
    listBacktests().then((r) => setBacktests(r.data));
  };

  useEffect(() => {
    load();
  }, []);

  const handleDelete = async (id: number) => {
    await deleteBacktest(id);
    load();
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h2 style={{ color: "#e2e8f0" }}>Dashboard</h2>
        <button
          onClick={() => navigate("/backtest")}
          style={{
            background: "#3b82f6",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            padding: "8px 20px",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          + New Backtest
        </button>
      </div>

      {backtests.length === 0 ? (
        <div style={{ background: "#1e1e2e", borderRadius: 8, padding: 40, textAlign: "center" }}>
          <p style={{ color: "#64748b", fontSize: 16 }}>No backtests yet.</p>
          <p style={{ color: "#475569", fontSize: 14, marginTop: 8 }}>
            Fetch stock data first, then run your first backtest.
          </p>
        </div>
      ) : (
        <div style={{ background: "#1e1e2e", borderRadius: 8, padding: 16 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #334155" }}>
                {["#", "Ticker", "Strategy", "Params", "Period", "Return", "Sharpe", "Max DD", "Win Rate", ""].map(
                  (h) => (
                    <th
                      key={h}
                      style={{ color: "#94a3b8", textAlign: "left", padding: "8px 10px", fontWeight: 600 }}
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {backtests.map((b) => (
                <tr
                  key={b.id}
                  style={{ borderBottom: "1px solid #1e293b", cursor: "pointer" }}
                  onClick={() => navigate(`/results/${b.id}`)}
                >
                  <td style={{ color: "#64748b", padding: "8px 10px" }}>{b.id}</td>
                  <td style={{ color: "#3b82f6", padding: "8px 10px", fontWeight: 600 }}>
                    {b.ticker}
                  </td>
                  <td style={{ color: "#e2e8f0", padding: "8px 10px" }}>
                    {b.strategy_name.replace(/_/g, " ")}
                  </td>
                  <td style={{ color: "#64748b", padding: "8px 10px", fontSize: 11, maxWidth: 200 }}>
                    {Object.entries(b.params).map(([k, v]) => (
                      <span key={k} style={{
                        display: "inline-block",
                        background: "#0f172a",
                        borderRadius: 4,
                        padding: "2px 6px",
                        marginRight: 4,
                        marginBottom: 2,
                        whiteSpace: "nowrap",
                      }}>
                        <span style={{ color: "#94a3b8" }}>{k.replace(/_/g, " ")}</span>
                        <span style={{ color: "#3b82f6", marginLeft: 3 }}>{v}</span>
                      </span>
                    ))}
                  </td>
                  <td style={{ color: "#94a3b8", padding: "8px 10px", fontSize: 12 }}>
                    {b.start_date} ~ {b.end_date}
                  </td>
                  <td
                    style={{
                      color: (b.total_return ?? 0) >= 0 ? "#22c55e" : "#ef4444",
                      padding: "8px 10px",
                      fontWeight: 600,
                    }}
                  >
                    {b.total_return?.toFixed(2)}%
                  </td>
                  <td style={{ color: "#e2e8f0", padding: "8px 10px" }}>
                    {b.sharpe_ratio?.toFixed(2)}
                  </td>
                  <td style={{ color: "#eab308", padding: "8px 10px" }}>
                    {b.max_drawdown?.toFixed(2)}%
                  </td>
                  <td style={{ color: "#e2e8f0", padding: "8px 10px" }}>
                    {b.win_rate?.toFixed(1)}%
                  </td>
                  <td style={{ padding: "8px 10px" }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(b.id);
                      }}
                      style={{
                        background: "transparent",
                        border: "1px solid #475569",
                        color: "#94a3b8",
                        borderRadius: 4,
                        padding: "4px 8px",
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
