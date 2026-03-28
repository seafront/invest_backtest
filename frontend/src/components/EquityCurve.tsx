import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import type { EquityPoint } from "../types";

interface Props {
  data: EquityPoint[];
}

export default function EquityCurve({ data }: Props) {
  const formatted = data
    .filter((_, i) => i % Math.max(1, Math.floor(data.length / 500)) === 0 || i === data.length - 1)
    .map((d) => ({
      date: d.date,
      equity: d.equity,
    }));

  return (
    <div style={{ background: "#1e1e2e", borderRadius: 8, padding: 16, marginBottom: 24 }}>
      <h3 style={{ color: "#e2e8f0", marginBottom: 12 }}>Equity Curve</h3>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={formatted}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis
            dataKey="date"
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            tickFormatter={(v) => v.slice(5)}
          />
          <YAxis
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
          />
          <Tooltip
            contentStyle={{ background: "#0f172a", border: "1px solid #334155" }}
            labelStyle={{ color: "#e2e8f0" }}
            formatter={(value: number) => [`$${value.toLocaleString()}`, "Equity"]}
          />
          <Line
            type="monotone"
            dataKey="equity"
            stroke="#3b82f6"
            dot={false}
            strokeWidth={2}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
