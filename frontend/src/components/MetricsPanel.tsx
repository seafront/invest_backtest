import { POSITIVE, NEGATIVE, CAUTION } from "../theme";
import { fmtMoney, type Currency } from "../utils/money";

interface Props {
  totalReturn: number;
  cagr?: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  initialCapital: number;
  totalInvested?: number;
  monthlyContribution?: number;
  currency: Currency;
}

export default function MetricsPanel({
  totalReturn,
  cagr,
  sharpeRatio,
  maxDrawdown,
  winRate,
  initialCapital,
  totalInvested,
  monthlyContribution,
  currency,
}: Props) {
  const invested = totalInvested || initialCapital;
  const finalValue = invested * (1 + totalReturn / 100);
  const isDCA = (monthlyContribution || 0) > 0;

  const metrics = [
    {
      label: "Total Return",
      value: `${totalReturn.toFixed(2)}%`,
      color: totalReturn >= 0 ? POSITIVE : NEGATIVE,
    },
    {
      // 적립식은 입금 시점을 반영한 연환산 수익률(IRR)이다. 원금 전부를 첫날 넣은 것으로 보는 CAGR과 다르다.
      label: isDCA ? "IRR (연환산)" : "CAGR",
      value: `${(cagr ?? 0).toFixed(2)}%`,
      color: (cagr ?? 0) >= 10 ? POSITIVE : (cagr ?? 0) >= 0 ? CAUTION : NEGATIVE,
    },
    ...(isDCA
      ? [
          {
            label: "Total Invested",
            value: fmtMoney(invested, currency),
            color: "#3b82f6",
          },
        ]
      : []),
    {
      label: "Final Value",
      value: fmtMoney(finalValue, currency),
      color: totalReturn >= 0 ? POSITIVE : NEGATIVE,
    },
    {
      label: "Sharpe Ratio",
      value: sharpeRatio.toFixed(4),
      color: sharpeRatio >= 1 ? POSITIVE : sharpeRatio >= 0 ? CAUTION : NEGATIVE,
    },
    {
      label: "Max Drawdown",
      value: `${maxDrawdown.toFixed(2)}%`,
      color: maxDrawdown <= 10 ? POSITIVE : maxDrawdown <= 20 ? CAUTION : NEGATIVE,
    },
    {
      label: "Win Rate",
      value: `${winRate.toFixed(1)}%`,
      color: winRate >= 50 ? POSITIVE : CAUTION,
    },
  ];

  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
      {metrics.map((m) => (
        <div
          key={m.label}
          style={{
            background: "#1e1e2e",
            borderRadius: 8,
            padding: "16px 24px",
            minWidth: 150,
            flex: 1,
          }}
        >
          <div style={{ color: "#94a3b8", fontSize: 13, marginBottom: 4 }}>
            {m.label}
          </div>
          <div style={{ color: m.color, fontSize: 22, fontWeight: 700 }}>
            {m.value}
          </div>
        </div>
      ))}
    </div>
  );
}
