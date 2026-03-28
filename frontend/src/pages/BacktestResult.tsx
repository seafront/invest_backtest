import { useState, useEffect } from "react";
import { useParams, useLocation } from "react-router-dom";
import type { BacktestResult as Result, StockData } from "../types";
import { getBacktest, getStockData } from "../api/client";
import MetricsPanel from "../components/MetricsPanel";
import EquityCurve from "../components/EquityCurve";
import CandlestickChart from "../components/CandlestickChart";
import TradeLog from "../components/TradeLog";

export default function BacktestResult() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const [result, setResult] = useState<Result | null>(null);
  const [priceData, setPriceData] = useState<StockData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    // If navigated from BacktestRun with state, use it directly
    if (location.state) {
      setResult(location.state as Result);
      setLoading(false);
      return;
    }
    // Otherwise fetch from API
    if (id) {
      setLoading(true);
      getBacktest(Number(id))
        .then((r) => {
          setResult(r.data);
        })
        .catch((err) => {
          setError(err.response?.data?.detail || "Failed to load backtest");
        })
        .finally(() => setLoading(false));
    }
  }, [id, location.state]);

  useEffect(() => {
    if (result) {
      getStockData(result.ticker)
        .then((r) => {
          const filtered = r.data.filter(
            (d) => d.date >= result.start_date && d.date <= result.end_date
          );
          setPriceData(filtered);
        })
        .catch(() => {});
    }
  }, [result]);

  if (loading) {
    return <p style={{ color: "#94a3b8", padding: 40, textAlign: "center" }}>Loading...</p>;
  }

  if (error) {
    return <p style={{ color: "#ef4444", padding: 40 }}>{error}</p>;
  }

  if (!result) {
    return <p style={{ color: "#ef4444", padding: 40 }}>Backtest not found.</p>;
  }

  return (
    <div>
      <h2 style={{ color: "#e2e8f0", marginBottom: 8 }}>
        {result.ticker} — {result.strategy_name.replace(/_/g, " ")}
      </h2>
      <p style={{ color: "#64748b", marginBottom: 20, fontSize: 14 }}>
        {result.start_date} ~ {result.end_date} · Initial: $
        {result.initial_capital.toLocaleString()}
      </p>

      <MetricsPanel
        totalReturn={result.total_return}
        sharpeRatio={result.sharpe_ratio}
        maxDrawdown={result.max_drawdown}
        winRate={result.win_rate}
        initialCapital={result.initial_capital}
      />

      <EquityCurve data={result.equity_curve} />

      {priceData.length > 0 && (
        <CandlestickChart
          data={priceData}
          trades={result.trades}
          indicators={result.indicators}
        />
      )}

      <TradeLog trades={result.trades} />
    </div>
  );
}
