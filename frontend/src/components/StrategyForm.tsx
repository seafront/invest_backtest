import { useState, useEffect } from "react";
import type { StrategyInfo, TickerInfo, BacktestRequest } from "../types";
import { listStrategies, listTickers } from "../api/client";

interface Props {
  onSubmit: (req: BacktestRequest) => void;
  loading: boolean;
}

export default function StrategyForm({ onSubmit, loading }: Props) {
  const [strategies, setStrategies] = useState<StrategyInfo[]>([]);
  const [tickers, setTickers] = useState<TickerInfo[]>([]);
  const [selectedStrategy, setSelectedStrategy] = useState("");
  const [ticker, setTicker] = useState("");
  const [params, setParams] = useState<Record<string, number>>({});
  const [startDate, setStartDate] = useState("2022-01-01");
  const [endDate, setEndDate] = useState("2024-12-31");
  const [capital, setCapital] = useState(100000);

  useEffect(() => {
    listStrategies().then((r) => {
      setStrategies(r.data);
      if (r.data.length > 0) {
        setSelectedStrategy(r.data[0].name);
        const defaults: Record<string, number> = {};
        r.data[0].params.forEach((p) => (defaults[p.name] = p.default));
        setParams(defaults);
      }
    });
    listTickers().then((r) => {
      setTickers(r.data);
      if (r.data.length > 0) setTicker(r.data[0].ticker);
    });
  }, []);

  const currentStrategy = strategies.find((s) => s.name === selectedStrategy);

  const handleStrategyChange = (name: string) => {
    setSelectedStrategy(name);
    const strat = strategies.find((s) => s.name === name);
    if (strat) {
      const defaults: Record<string, number> = {};
      strat.params.forEach((p) => (defaults[p.name] = p.default));
      setParams(defaults);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticker || !selectedStrategy) return;
    onSubmit({
      ticker,
      strategy_name: selectedStrategy,
      params,
      start_date: startDate,
      end_date: endDate,
      initial_capital: capital,
    });
  };

  const inputStyle: React.CSSProperties = {
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: 6,
    color: "#e2e8f0",
    padding: "8px 12px",
    fontSize: 14,
    width: "100%",
  };

  const labelStyle: React.CSSProperties = {
    color: "#94a3b8",
    fontSize: 13,
    marginBottom: 4,
    display: "block",
  };

  return (
    <form onSubmit={handleSubmit} style={{ background: "#1e1e2e", borderRadius: 8, padding: 24, marginBottom: 24 }}>
      <h3 style={{ color: "#e2e8f0", marginBottom: 16 }}>Backtest Configuration</h3>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <div>
          <label style={labelStyle}>Ticker</label>
          {tickers.length > 0 ? (
            <select
              value={ticker}
              onChange={(e) => setTicker(e.target.value)}
              style={inputStyle}
            >
              {tickers.map((t) => (
                <option key={t.ticker} value={t.ticker}>
                  {t.ticker} ({t.start_date} ~ {t.end_date})
                </option>
              ))}
            </select>
          ) : (
            <input
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              placeholder="e.g. AAPL"
              style={inputStyle}
            />
          )}
        </div>

        <div>
          <label style={labelStyle}>Strategy</label>
          <select
            value={selectedStrategy}
            onChange={(e) => handleStrategyChange(e.target.value)}
            style={inputStyle}
          >
            {strategies.map((s) => (
              <option key={s.name} value={s.name}>
                {s.display_name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label style={labelStyle}>Start Date</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>End Date</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>Initial Capital ($)</label>
          <input
            type="number"
            value={capital}
            onChange={(e) => setCapital(Number(e.target.value))}
            min={1000}
            step={1000}
            style={inputStyle}
          />
        </div>
      </div>

      {currentStrategy && currentStrategy.params.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ color: "#94a3b8", fontSize: 13, marginBottom: 8 }}>
            Strategy Parameters
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
            {currentStrategy.params.map((p) => (
              <div key={p.name}>
                <label style={{ ...labelStyle, fontSize: 12 }}>
                  {p.name.replace(/_/g, " ")} ({p.min}-{p.max})
                </label>
                <input
                  type="number"
                  value={params[p.name] ?? p.default}
                  onChange={(e) =>
                    setParams({ ...params, [p.name]: Number(e.target.value) })
                  }
                  min={p.min}
                  max={p.max}
                  step={p.type === "float" ? 0.1 : 1}
                  style={inputStyle}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {currentStrategy && (
        <p style={{ color: "#64748b", fontSize: 13, marginBottom: 16 }}>
          {currentStrategy.description}
        </p>
      )}

      <button
        type="submit"
        disabled={loading || !ticker}
        style={{
          background: loading ? "#334155" : "#3b82f6",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          padding: "10px 24px",
          fontSize: 15,
          fontWeight: 600,
          cursor: loading ? "wait" : "pointer",
        }}
      >
        {loading ? "Running..." : "Run Backtest"}
      </button>
    </form>
  );
}
