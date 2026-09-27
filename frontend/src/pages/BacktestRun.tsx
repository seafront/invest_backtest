import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import StrategyForm from "../components/StrategyForm";
import AutoBacktest from "../components/AutoBacktest";
import type { BacktestRequest } from "../types";
import { runBacktest } from "../api/client";
import { errMessage } from "../utils/error";

export default function BacktestRun() {
  // 모드는 주소(?mode=auto)에 둔다. 결과 화면에서 뒤로 오면 보던 모드가 그대로 열린다.
  const [searchParams, setSearchParams] = useSearchParams();
  const mode: "manual" | "auto" = searchParams.get("mode") === "auto" ? "auto" : "manual";
  const setMode = (m: "manual" | "auto") =>
    setSearchParams(m === "auto" ? { mode: "auto" } : {}, { replace: true });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleSubmit = async (req: BacktestRequest) => {
    setLoading(true);
    setError("");
    try {
      const res = await runBacktest(req);
      navigate(`/results/${res.data.id}`, { state: res.data });
    } catch (err: unknown) {
      setError(errMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
        <h2 style={{ color: "#e2e8f0", margin: 0 }}>Run Backtest</h2>
        <div style={{ display: "flex", background: "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: 3 }}>
          {(["manual", "auto"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              style={{
                background: mode === m ? "#3b82f6" : "transparent",
                color: mode === m ? "#fff" : "#94a3b8",
                border: "none",
                borderRadius: 6,
                padding: "6px 16px",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {m === "manual" ? "Manual" : "Auto"}
            </button>
          ))}
        </div>
      </div>

      {mode === "auto" ? (
        <AutoBacktest />
      ) : (
        <StrategyForm onSubmit={handleSubmit} loading={loading} />
      )}

      {mode === "manual" && error && (
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
