import { useState, useEffect } from "react";
import { useParams, useLocation } from "react-router-dom";
import type { BacktestResult as Result, StockData } from "../types";
import { getBacktest, getStockData } from "../api/client";
import { errMessage } from "../utils/error";
import MetricsPanel from "../components/MetricsPanel";
import EquityCurve from "../components/EquityCurve";
import CandlestickChart from "../components/CandlestickChart";
import TradeLog from "../components/TradeLog";
import { NEGATIVE } from "../theme";
import { currencyOf, fmtMoney } from "../utils/money";

export default function BacktestResult() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const [priceData, setPriceData] = useState<StockData[]>([]);
  const [fetched, setFetched] = useState<{ id: string; result: Result | null; error: string } | null>(
    null
  );

  // BacktestRun에서 넘어온 경우 라우터 state를 그대로 쓰고 API를 호출하지 않는다.
  const fromNav = (location.state as Result | null) ?? null;

  // effect 본문에서 동기 setState를 하지 않도록 세 값을 모두 파생시킨다.
  const current = fetched?.id === id ? fetched : null;
  const result = fromNav ?? current?.result ?? null;
  const error = fromNav ? "" : current?.error ?? "";
  const loading = !fromNav && !!id && current === null;

  useEffect(() => {
    if (fromNav || !id) return;
    let cancelled = false;
    getBacktest(Number(id))
      .then((r) => {
        if (!cancelled) setFetched({ id, result: r.data, error: "" });
      })
      .catch((err: unknown) => {
        if (!cancelled) setFetched({ id, result: null, error: errMessage(err, "Failed to load backtest") });
      });
    return () => {
      cancelled = true;
    };
  }, [id, fromNav]);

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
    return <p style={{ color: NEGATIVE, padding: 40 }}>{error}</p>;
  }

  if (!result) {
    return <p style={{ color: NEGATIVE, padding: 40 }}>Backtest not found.</p>;
  }

  return (
    <div>
      <h2 style={{ color: "#e2e8f0", marginBottom: 8 }}>
        {result.ticker} — {result.strategy_name.replace(/_/g, " ")}
      </h2>
      <p style={{ color: "#64748b", marginBottom: 20, fontSize: 14 }}>
        {result.start_date} ~ {result.end_date}
        {(result.invest_mode || "lump_sum") === "dca" ? (
          <span> · DCA (적립식) Monthly: {fmtMoney(result.monthly_contribution || 0, currencyOf(result.ticker))}</span>
        ) : (
          <span> · Lump Sum (거치식) Initial: {fmtMoney(result.initial_capital, currencyOf(result.ticker))}</span>
        )}
      </p>

      <MetricsPanel
        currency={currencyOf(result.ticker)}
        totalReturn={result.total_return}
        cagr={result.cagr}
        sharpeRatio={result.sharpe_ratio}
        maxDrawdown={result.max_drawdown}
        winRate={result.win_rate}
        initialCapital={result.initial_capital}
        totalInvested={result.total_invested}
        monthlyContribution={result.monthly_contribution}
      />

      <EquityCurve data={result.equity_curve} currency={currencyOf(result.ticker)} />

      {priceData.length > 0 && (
        <CandlestickChart
          data={priceData}
          trades={result.trades}
          indicators={result.indicators}
        />
      )}

      <TradeLog trades={result.trades} currency={currencyOf(result.ticker)} />
    </div>
  );
}
