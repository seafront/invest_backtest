import { useState } from "react";
import { useNavigate } from "react-router-dom";
import StrategyForm from "../components/StrategyForm";
import type { BacktestRequest, BacktestResult } from "../types";
import { runBacktest } from "../api/client";

export default function BacktestRun() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleSubmit = async (req: BacktestRequest) => {
    setLoading(true);
    setError("");
    try {
      const res = await runBacktest(req);
      navigate(`/results/${res.data.id}`, { state: res.data });
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h2 style={{ color: "#e2e8f0", marginBottom: 20 }}>Run Backtest</h2>

      <StrategyForm onSubmit={handleSubmit} loading={loading} />

      {error && (
        <div
          style={{
            background: "#7f1d1d",
            color: "#e2e8f0",
            padding: "10px 16px",
            borderRadius: 6,
            fontSize: 14,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
