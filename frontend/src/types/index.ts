export interface StockData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TickerInfo {
  ticker: string;
  start_date: string;
  end_date: string;
  count: number;
}

export interface ParamSchema {
  name: string;
  type: string;
  default: number;
  min: number;
  max: number;
  description: string;
}

export interface StrategyInfo {
  name: string;
  display_name: string;
  description: string;
  params: ParamSchema[];
}

export interface TradeResult {
  date: string;
  action: string;
  price: number;
  shares: number;
  pnl: number;
}

export interface EquityPoint {
  date: string;
  equity: number;
}

export interface IndicatorPoint {
  date: string;
  value: number;
}

export interface BacktestSummary {
  id: number;
  ticker: string;
  strategy_name: string;
  params: Record<string, number>;
  start_date: string;
  end_date: string;
  initial_capital: number;
  monthly_contribution: number;
  total_invested: number | null;
  total_return: number | null;
  cagr: number | null;
  sharpe_ratio: number | null;
  max_drawdown: number | null;
  win_rate: number | null;
  created_at: string | null;
}

export interface BacktestResult extends BacktestSummary {
  total_invested: number;
  total_return: number;
  cagr: number;
  sharpe_ratio: number;
  max_drawdown: number;
  win_rate: number;
  equity_curve: EquityPoint[];
  trades: TradeResult[];
  indicators: Record<string, IndicatorPoint[]> | null;
}

export interface BacktestRequest {
  ticker: string;
  strategy_name: string;
  params: Record<string, number>;
  start_date: string;
  end_date: string;
  invest_mode: "lump_sum" | "dca";
  initial_capital: number;
  monthly_contribution: number;
}

// Screening
export interface MarketCapResult {
  ticker: string;
  market_cap: number;
  market_cap_str: string;
}

export interface StrategyScreenResult {
  ticker: string;
  strategy_name: string;
  strategy_display: string;
  total_return: number;
  sharpe_ratio: number;
  max_drawdown: number;
  win_rate: number;
  trades_count: number;
}

export interface FullScreenResponse {
  market_cap_top: MarketCapResult[];
  all_results: StrategyScreenResult[];
  top_picks: StrategyScreenResult[];
}
