import { useState, useEffect } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import type { BacktestResult as Result, StockData } from "../types";
import { getBacktest, getStockData } from "../api/client";
import { errMessage } from "../utils/error";
import MetricsPanel from "../components/MetricsPanel";
import EquityCurve from "../components/EquityCurve";
import CandlestickChart from "../components/CandlestickChart";
import TradeLog from "../components/TradeLog";
import StrategyParamsPanel from "../components/StrategyParamsPanel";
import ParamCompare from "../components/ParamCompare";
import { NEGATIVE } from "../theme";
import { currencyOf, fmtMoney } from "../utils/money";

export default function BacktestResult() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [priceData, setPriceData] = useState<StockData[]>([]);
  const [fetched, setFetched] = useState<{ id: string; result: Result | null; error: string } | null>(
    null
  );

  // BacktestRun에서 넘어온 경우 라우터 state를 그대로 쓰고 API를 호출하지 않는다.
  const fromNav = (location.state as (Result & { fromAuto?: boolean }) | null) ?? null;
  // Auto 비교표의 "상세 보기"로 들어왔으면 비교표로 돌아가는 버튼을 단다. 비교 결과는
  // 세션에 보관돼 있어 다시 계산하지 않고 그대로 복원된다.
  const fromAuto = !!fromNav?.fromAuto;

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

  // 브라우저 탭에도 어떤 전략의 성과 리포트인지 보이게 한다.
  useEffect(() => {
    if (!result) return;
    document.title = `${result.ticker} ${result.strategy_name.replace(/_/g, " ")} · Tear Sheet — BacktestLab`;
    return () => {
      document.title = "BacktestLab";
    };
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
      {fromAuto && (
        <button
          type="button"
          onClick={() =>
            // 비교표에서 바로 왔으면 기록을 한 칸 되돌린다. 새로 쌓으면 그다음 뒤로 가기가
            // 다시 이 결과 화면으로 온다. 새로고침 등으로 앞 기록이 없으면 주소로 간다.
            (window.history.state?.idx ?? 0) > 0 ? navigate(-1) : navigate("/backtest?mode=auto")
          }
          style={{
            background: "transparent",
            border: "1px solid #334155",
            borderRadius: 6,
            color: "#3b82f6",
            padding: "6px 12px",
            fontSize: 13,
            cursor: "pointer",
            marginBottom: 12,
          }}
        >
          ← Leaderboard로 돌아가기
        </button>
      )}
      <div
        style={{
          color: "#64748b",
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          marginBottom: 4,
        }}
      >
        Strategy Tear Sheet · 전략 성과 리포트
      </div>
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

      <StrategyParamsPanel strategyName={result.strategy_name} params={result.params} />
      {/* key: 다른 결과로 이동하면 변형 목록을 비운다 — 이전 결과 기준의 변형이 남지 않게 */}
      <ParamCompare key={result.id} result={result} fromAuto={fromAuto} />

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
