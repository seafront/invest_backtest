import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { BacktestSummary } from "../types";
import { listBacktests, deleteBacktest, listTickers } from "../api/client";
import { POSITIVE, NEGATIVE, CAUTION } from "../theme";
import { currencyOf, fmtMoney } from "../utils/money";

/** 요약 타일. label 아래 큰 값, 그 아래 어떤 백테스트인지 밝히는 보조 문구. */
function Tile({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ background: "#1e1e2e", borderRadius: 8, padding: "16px 24px", minWidth: 150, flex: 1 }}>
      <div style={{ color: "#94a3b8", fontSize: 13, marginBottom: 4 }}>{label}</div>
      <div style={{ color: color ?? "#e2e8f0", fontSize: 22, fontWeight: 700 }}>{value}</div>
      {sub && <div style={{ color: "#64748b", fontSize: 12, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

const describe = (b: BacktestSummary) => `${b.ticker} · ${b.strategy_name.replace(/_/g, " ")}`;

export default function Dashboard() {
  const [backtests, setBacktests] = useState<BacktestSummary[]>([]);
  const [tickerCount, setTickerCount] = useState<number | null>(null);
  const navigate = useNavigate();

  const load = () => {
    listBacktests().then((r) => setBacktests(r.data));
    listTickers().then((r) => setTickerCount(r.data.length));
  };

  useEffect(() => {
    load();
  }, []);

  // 최고 CAGR과 최대 낙폭을 나란히 둬 수익과 위험을 함께 보여준다. null인 옛 레코드는 제외.
  const summary = useMemo(() => {
    const pick = (
      key: "cagr" | "max_drawdown",
      better: (a: number, b: number) => boolean
    ): BacktestSummary | null =>
      backtests
        .filter((b) => b[key] !== null)
        .reduce<BacktestSummary | null>(
          (best, b) => (best === null || better(b[key] as number, best[key] as number) ? b : best),
          null
        );

    return {
      bestCagr: pick("cagr", (a, c) => a > c),
      worstDd: pick("max_drawdown", (a, c) => a > c),
    };
  }, [backtests]);

  const handleDelete = async (id: number) => {
    try {
      await deleteBacktest(id);
      load();
    } catch {
      alert("Failed to delete backtest");
    }
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

      {backtests.length > 0 && (
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
          <Tile label="백테스트" value={`${backtests.length}회`} sub="최근 50건까지 표시" />
          <Tile
            label="최고 CAGR"
            value={summary.bestCagr ? `${summary.bestCagr.cagr!.toFixed(2)}%` : "—"}
            sub={summary.bestCagr ? describe(summary.bestCagr) : undefined}
            color={POSITIVE}
          />
          <Tile
            label="최대 낙폭"
            value={summary.worstDd ? `-${summary.worstDd.max_drawdown!.toFixed(2)}%` : "—"}
            sub={summary.worstDd ? describe(summary.worstDd) : undefined}
            color={NEGATIVE}
          />
          <Tile
            label="캐시 종목"
            value={tickerCount === null ? "—" : `${tickerCount}개`}
            sub="Data 탭에서 관리"
          />
        </div>
      )}

      {backtests.length === 0 ? (
        <div style={{ background: "#1e1e2e", borderRadius: 8, padding: 40, textAlign: "center" }}>
          <p style={{ color: "#64748b", fontSize: 16 }}>No backtests yet.</p>
          <p style={{ color: "#475569", fontSize: 14, marginTop: 8 }}>
            {tickerCount ? `${tickerCount}개 종목이 캐시돼 있습니다. 첫 백테스트를 실행해 보세요.`
                         : "Fetch stock data first, then run your first backtest."}
          </p>
        </div>
      ) : (
        <div style={{ background: "#1e1e2e", borderRadius: 8, padding: 16 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #334155" }}>
                {["#", "Ticker", "Strategy", "Params", "Mode", "Period", "Return", "CAGR", "Sharpe", "Max DD", "Win Rate", ""].map(
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
                  <td style={{ padding: "8px 10px", fontSize: 11 }}>
                    {(b.invest_mode || "lump_sum") === "dca" ? (
                      <span style={{ color: "#8b5cf6" }}>DCA {fmtMoney(b.monthly_contribution || 0, currencyOf(b.ticker))}/mo</span>
                    ) : (
                      <span style={{ color: "#3b82f6" }}>{fmtMoney(b.initial_capital, currencyOf(b.ticker))}</span>
                    )}
                  </td>
                  <td style={{ color: "#94a3b8", padding: "8px 10px", fontSize: 12 }}>
                    {b.start_date} ~ {b.end_date}
                  </td>
                  <td
                    style={{
                      color: (b.total_return ?? 0) >= 0 ? POSITIVE : NEGATIVE,
                      padding: "8px 10px",
                      fontWeight: 600,
                    }}
                  >
                    {b.total_return?.toFixed(2)}%
                  </td>
                  <td
                    style={{
                      color: (b.cagr ?? 0) >= 0 ? POSITIVE : NEGATIVE,
                      padding: "8px 10px",
                    }}
                  >
                    {b.cagr?.toFixed(2)}%
                  </td>
                  <td style={{ color: "#e2e8f0", padding: "8px 10px" }}>
                    {b.sharpe_ratio?.toFixed(2)}
                  </td>
                  <td style={{ color: CAUTION, padding: "8px 10px" }}>
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
