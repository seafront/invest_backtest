import { useState } from "react";
import { Link } from "react-router-dom";
import type { BacktestResult } from "../types";
import { addWatch } from "../api/client";
import { errMessage } from "../utils/error";
import { NEGATIVE } from "../theme";

/** Tear Sheet 의 조합(종목·전략·파라미터)을 Signals 워치리스트에 더한다. */
export default function WatchButton({ result }: { result: BacktestResult }) {
  const [state, setState] = useState<"idle" | "busy" | "added" | "error">("idle");
  const [error, setError] = useState("");

  const add = async () => {
    setState("busy");
    try {
      await addWatch({
        ticker: result.ticker,
        strategy_name: result.strategy_name,
        params: result.params,
        backtest_id: result.id,
      });
      setState("added");
    } catch (err: unknown) {
      const msg = errMessage(err);
      // 이미 감시 중이면 실패가 아니다 — 바로 Signals 로 안내한다.
      if (msg.includes("이미 감시 중")) {
        setState("added");
      } else {
        setError(msg);
        setState("error");
      }
    }
  };

  if (state === "added") {
    return (
      <Link to="/signals" style={{ color: "#3b82f6", fontSize: 13, textDecoration: "none" }}>
        ● 감시 중 — Signals에서 보기 →
      </Link>
    );
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <button
        type="button"
        onClick={add}
        disabled={state === "busy"}
        title="이 종목·전략·파라미터의 매매 신호를 매일 확인합니다"
        style={{
          background: "transparent",
          border: "1px solid #334155",
          borderRadius: 6,
          color: "#3b82f6",
          padding: "5px 12px",
          fontSize: 13,
          cursor: state === "busy" ? "wait" : "pointer",
        }}
      >
        {state === "busy" ? "추가 중…" : "+ Signals에 추가"}
      </button>
      {state === "error" && <span style={{ color: NEGATIVE, fontSize: 12 }}>{error}</span>}
    </span>
  );
}
