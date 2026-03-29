import type { TradeResult } from "../types";

interface Props {
  trades: TradeResult[];
}

export default function TradeLog({ trades }: Props) {
  // Calculate cumulative P&L
  let cumPnl = 0;
  const tradesWithCum = trades.map((t) => {
    if (t.action === "SELL") {
      cumPnl += t.pnl;
    }
    return { ...t, cumPnl: t.action === "SELL" ? cumPnl : null };
  });

  return (
    <div style={{ background: "#1e1e2e", borderRadius: 8, padding: 16, marginBottom: 24 }}>
      <h3 style={{ color: "#e2e8f0", marginBottom: 12 }}>
        Trade Log ({trades.length} trades)
      </h3>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #334155" }}>
              {["#", "Date", "Action", "Price", "Shares", "P&L", "Cum. P&L"].map((h) => (
                <th
                  key={h}
                  style={{
                    color: "#94a3b8",
                    textAlign: "left",
                    padding: "8px 12px",
                    fontWeight: 600,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tradesWithCum.map((t, i) => (
              <tr
                key={i}
                style={{ borderBottom: "1px solid #1e293b" }}
              >
                <td style={{ color: "#64748b", padding: "8px 12px", fontSize: 12 }}>{i + 1}</td>
                <td style={{ color: "#e2e8f0", padding: "8px 12px" }}>{t.date}</td>
                <td
                  style={{
                    color: t.action === "BUY" ? "#22c55e" : "#ef4444",
                    padding: "8px 12px",
                    fontWeight: 600,
                  }}
                >
                  {t.action}
                </td>
                <td style={{ color: "#e2e8f0", padding: "8px 12px" }}>
                  ${t.price.toFixed(2)}
                </td>
                <td style={{ color: "#e2e8f0", padding: "8px 12px" }}>{t.shares}</td>
                <td
                  style={{
                    color:
                      t.action === "SELL"
                        ? t.pnl >= 0
                          ? "#22c55e"
                          : "#ef4444"
                        : "#64748b",
                    padding: "8px 12px",
                  }}
                >
                  {t.action === "SELL" ? `$${t.pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "-"}
                </td>
                <td
                  style={{
                    color:
                      t.cumPnl !== null
                        ? t.cumPnl >= 0
                          ? "#22c55e"
                          : "#ef4444"
                        : "#64748b",
                    padding: "8px 12px",
                    fontWeight: t.cumPnl !== null ? 600 : 400,
                  }}
                >
                  {t.cumPnl !== null
                    ? `$${t.cumPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
