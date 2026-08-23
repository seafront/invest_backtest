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
  name: string | null;
  universes: string[];
}

export interface MacroCatalogItem {
  series_id: string;
  name: string;
  unit: string;
  frequency: string;
  description: string;
}

export interface MacroSeriesInfo {
  series_id: string;
  name: string;
  unit: string;
  frequency: string;
  source: string;
  start_date: string;
  end_date: string;
  count: number;
}

export interface MacroPoint {
  date: string;
  value: number;
}

export interface MacroSeriesDetail extends MacroSeriesInfo {
  description: string;
  latest_value: number;
  min_value: number;
  max_value: number;
  data: MacroPoint[];
}

export interface RefreshResult {
  ticker: string;
  added: number;
  count: number;
  error: string | null;
}

export interface UniverseInfo {
  key: string;
  label: string;
}

export interface BulkFetchStatus {
  running: boolean;
  universe: string;
  total: number;
  done: number;
  added: number;
  failed: string[];
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
}

export interface IndicatorSignal {
  key: string;
  label: string;
  detail: string;
  level: "ok" | "watch" | "alert";
}

export interface IndicatorPoint {
  date: string;
  close: number;
  disparity_5: number | null;
  disparity_20: number | null;
  disparity_60: number | null;
  turnover_ratio: number | null;
}

export interface StockIndicators {
  ticker: string;
  as_of: string;
  close: number;
  ma5: number | null;
  ma20: number | null;
  ma60: number | null;
  above_ma20_days: number;
  disparity_5: number | null;
  disparity_20: number | null;
  disparity_60: number | null;
  return_5d: number | null;
  return_20d: number | null;
  return_60d: number | null;
  turnover_avg5: number;
  turnover_avg20: number;
  turnover_avg60: number | null;
  turnover_ratio_5_60: number | null;
  high_52w: number;
  low_52w: number;
  from_high_pct: number | null;
  from_low_pct: number | null;
  is_52w_high: boolean;
  volatility_20d: number | null;
  upper_wick_days_20: number;
  bullish_days_15: number;
  low_rising: boolean | null;
  signals: IndicatorSignal[];
  series_range: string;
  series: IndicatorPoint[];
}

export interface DrawdownPoint {
  date: string;
  drawdown: number;
}

export interface YearlyReturn {
  year: number;
  return_pct: number;
  partial: boolean;
}

export interface BearMarket {
  peak_date: string;
  trough_date: string;
  recovery_date: string | null;
  peak_close: number;
  trough_close: number;
  decline_pct: number;
  decline_days: number;
  recovery_days: number | null;
  return_3m: number | null;
  return_6m: number | null;
  return_12m: number | null;
}

export interface DayChange {
  date: string;
  change: number;
}

export interface StockStats {
  ticker: string;
  start_date: string;
  end_date: string;
  trading_days: number;
  years: number;
  first_close: number;
  last_close: number;
  total_return: number;
  cagr: number;
  annual_volatility: number;
  max_drawdown: number;
  sharpe_ratio: number;
  best_day: DayChange;
  worst_day: DayChange;
  positive_day_pct: number;
  drawdown_curve: DrawdownPoint[];
  yearly_returns: YearlyReturn[];
  bear_markets: BearMarket[];
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
  invest_mode: "lump_sum" | "dca";
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
