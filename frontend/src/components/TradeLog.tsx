import type { TradeResult } from "../types";

interface Props {
  trades: TradeResult[];
}

export default function TradeLog({ trades }: Props) {
  return (
    <div style={{ background: "#1e1e2e", borderRadius: 8, padding: 16, marginBottom: 24 }}>
      <h3 style={{ color: "#e2e8f0", marginBottom: 12 }}>
        Trade Log ({trades.length} trades)
      </h3>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #334155" }}>
              {["Date", "Action", "Price", "Shares", "P&L"].map((h) => (
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
            {trades.map((t, i) => (
              <tr
                key={i}
                style={{ borderBottom: "1px solid #1e293b" }}
              >
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
                  {t.action === "SELL" ? `$${t.pnl.toFixed(2)}` : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
