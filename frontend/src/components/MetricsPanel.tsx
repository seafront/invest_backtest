import { POSITIVE, NEGATIVE, CAUTION } from "../theme";

interface Props {
  totalReturn: number;
  cagr?: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  initialCapital: number;
  totalInvested?: number;
  monthlyContribution?: number;
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
      label: "CAGR",
      value: `${(cagr ?? 0).toFixed(2)}%`,
      color: (cagr ?? 0) >= 10 ? POSITIVE : (cagr ?? 0) >= 0 ? CAUTION : NEGATIVE,
    },
    ...(isDCA
      ? [
          {
            label: "Total Invested",
            value: `$${invested.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
            color: "#3b82f6",
          },
        ]
      : []),
    {
      label: "Final Value",
      value: `$${finalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
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
