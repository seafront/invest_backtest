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
  sector: string | null;
  industry: string | null;
  industry_krx: string | null;
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
  phase: string;
  total: number;
  done: number;
  added: number;
  failed: string[];
  flow_total: number;
  flow_done: number;
  flow_added: number;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
}

export interface InvestorFlowPoint {
  date: string;
  close: number | null;
  prsn_ntby_qty: number | null;
  frgn_ntby_qty: number | null;
  orgn_ntby_qty: number | null;
  prsn_ntby_amt: number | null;
  frgn_ntby_amt: number | null;
  orgn_ntby_amt: number | null;
  fund_ntby_qty: number | null;
  ivtr_ntby_qty: number | null;
  pe_fund_ntby_qty: number | null;
  scrt_ntby_qty: number | null;
}

export interface InvestorFlowSeries {
  ticker: string;
  count: number;
  start_date: string | null;
  end_date: string | null;
  data: InvestorFlowPoint[];
}

export interface ScanRequest {
  universe?: string | null;
  limit?: number;
  above_ma20?: boolean;
  above_ma60?: boolean;
  turnover_ratio_min?: number | null;
  disparity_max?: number | null;
  return_5d_max?: number | null;
  return_20d_min?: number | null;
  from_high_min?: number | null;
  frgn_buy?: boolean;
  orgn_buy?: boolean;
  prsn_not_crowded?: boolean;
  min_turnover?: number | null;
  sector?: string | null;
}

export interface ScanStep {
  key: string;
  label: string;
  value: string;
  passed: number;
  remaining: number;
}

export interface ScanRow {
  ticker: string;
  name: string | null;
  sector: string | null;
  industry: string | null;
  close: number;
  date: string;
  above_ma20: boolean;
  above_ma60: boolean;
  disparity_20: number | null;
  turnover_ratio: number | null;
  turnover_avg5: number | null;
  return_5d: number | null;
  return_20d: number | null;
  from_high_pct: number | null;
  frgn_ntby_20d: number | null;
  orgn_ntby_20d: number | null;
  prsn_ntby_20d: number | null;
}

export interface ScanResponse {
  universe: string | null;
  total: number;
  matched: number;
  funnel: ScanStep[];
  rows: ScanRow[];
}

export interface FundamentalPoint {
  period_end: string;
  revenue: number | null;
  gross_profit: number | null;
  operating_income: number | null;
  net_income: number | null;
  inventory: number | null;
  receivables: number | null;
  total_assets: number | null;
  total_debt: number | null;
  equity: number | null;
  operating_cashflow: number | null;
  free_cashflow: number | null;
  /** KIS 재무비율에만 있다. yfinance 행에서는 null. */
  roe: number | null;
  eps: number | null;
  bps: number | null;
  period_type: string;
  source: string;
}

export interface FundamentalSeries {
  ticker: string;
  count: number;
  first_period: string | null;
  last_period: string | null;
  /** 금액은 서버에서 실제 단위로 맞춰 온다. 통화만 표시에 쓴다. */
  currency: string;
  period_type: string;
  source: string;
  data: FundamentalPoint[];
}

export interface IndustryInfo {
  key: string;
  label: string;
  note: string;
}

export interface GroupMemberPrice {
  close: number;
  as_of: string;
  return_20d: number | null;
  return_60d: number | null;
  return_252d: number | null;
  from_high_pct: number | null;
  volatility_60d: number | null;
}

export interface GroupMemberFundamental {
  period_end: string;
  quarters: number;
  operating_margin: number | null;
  operating_margin_delta: number | null;
  gross_margin: number | null;
  revenue_qoq: number | null;
  revenue_yoy: number | null;
  inventory_to_revenue: number | null;
  ocf_to_revenue: number | null;
  debt_to_equity: number | null;
}

export interface GroupMemberFlow {
  frgn_ntby_20d: number;
  orgn_ntby_20d: number;
  prsn_ntby_20d: number;
}

export interface GroupMemberSnapshot {
  market_cap: number | null;
  per: number | null;
  pbr: number | null;
  target_upside: number | null;
  analyst_count: number | null;
  recommendation: string | null;
}

export interface GroupMember {
  ticker: string;
  name: string | null;
  cached: boolean;
  price: GroupMemberPrice | null;
  fundamental: GroupMemberFundamental | null;
  flow: GroupMemberFlow | null;
  snapshot: GroupMemberSnapshot | null;
}

export interface ProductGroup {
  key: string;
  label: string;
  note: string;
  unlisted: string[];
  members: GroupMember[];
  /** {date, "<ticker>": 값}. 티커가 키라 인덱스 시그니처로 받는다. */
  price_series: Record<string, string | number | null>[];
  financial_series: Record<string, Record<string, string | number | null>[]>;
}

export interface FinancialMetricInfo {
  key: string;
  label: string;
  unit: string;
  baseline: number | null;
  note: string;
}

export interface ChartRangeInfo {
  key: string;
  label: string;
  days: number;
}

export interface IndustryOverview {
  industry: string;
  label: string;
  note: string;
  chart_range: string;
  ranges: ChartRangeInfo[];
  metrics: FinancialMetricInfo[];
  groups: ProductGroup[];
}

export interface PeriodInfo {
  key: string;
  label: string;
  days: number;
  note: string;
}

export interface ReportRow {
  ticker: string;
  name: string | null;
  industry: string | null;
  return_pct: number | null;
  turnover_ratio: number | null;
  frgn_ntby_qty: number | null;
  orgn_ntby_qty: number | null;
  prsn_ntby_qty: number | null;
}

export interface Breadth {
  advancing: number;
  declining: number;
  unchanged: number;
  total: number;
  median_return: number;
  above_ma20: number;
  above_ma20_pct: number;
  new_high_52w: number;
  new_low_52w: number;
}

export interface FlowSection {
  available: boolean;
  days: number | null;
  both_buy_count: number | null;
  top_foreign: ReportRow[];
  bottom_foreign: ReportRow[];
  both_buy: ReportRow[];
}

export interface SectorRow {
  industry: string;
  count: number;
  median_return: number;
  prev_median_return: number | null;
  advancing: number;
  frgn_ntby: number | null;
}

export interface ReportResponse {
  period: string;
  label: string;
  note: string;
  universe: string;
  as_of: string;
  base_date: string;
  trading_days: number;
  breadth: Breadth;
  movers: { top: ReportRow[]; bottom: ReportRow[] };
  turnover_surge: ReportRow[];
  flows: FlowSection;
  sectors: SectorRow[];
  drawdown: { median: number; within_5pct: number; below_20pct: number };
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
