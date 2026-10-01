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
  /** 묶음 제목. 서버가 정한다. 옛 응답에는 없을 수 있어 선택 항목으로 둔다. */
  category?: string;
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
  fund_total: number;
  fund_done: number;
  fund_added: number;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  /** 서버 밖(backend/collect.py)에서 도는 수집이면 true */
  external?: boolean;
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

export interface TrendWindow {
  key: string;
  label: string;
  months: number;
  base_date: string;
}

export interface SectorTrendRow {
  industry: string;
  count: number;
  /** 구간 키 -> 중앙 수익률(%). 시세가 모자란 구간은 키 자체가 없다. */
  returns: Record<string, number | null>;
}

export interface SectorTrendResponse {
  universe: string;
  as_of: string;
  windows: TrendWindow[];
  market: Record<string, number | null>;
  sectors: SectorTrendRow[];
}

export interface RangeInfo {
  key: string;
  label: string;
  months: number;
}

export interface SectorCurve {
  industry: string;
  count: number;
  return_pct: number | null;
  /** dates 와 같은 길이. 구간 시작을 0%로 둔 누적수익률. */
  values: (number | null)[];
}

export interface SectorCurveResponse {
  universe: string;
  months: number;
  as_of: string;
  start_date: string;
  dates: string[];
  market: (number | null)[];
  sectors: SectorCurve[];
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

/** 한 종목 × 전체 전략 비교 (Auto 모드). 저장하지 않는다. */
export interface AutoBacktestRequest {
  ticker: string;
  years?: number;
  invest_mode: "lump_sum" | "dca";
  initial_capital: number;
  monthly_contribution: number;
}

export interface AutoStrategyResult {
  strategy_name: string;
  display_name: string;
  params: Record<string, number>;
  total_return: number;
  cagr: number;
  sharpe_ratio: number;
  max_drawdown: number;
  win_rate: number;
  /** 청산(SELL) 횟수 */
  trades_count: number;
  /** 주 단위 누적 수익률(%). 적립식은 그 시점까지 넣은 원금 대비. */
  curve: { date: string; ret: number; idx: number }[];
  /** 첫 매매일. 그 전 구간의 0%는 판단이 아니라 "아직 들어가지 않음"이다. */
  first_trade?: string | null;
  /** /simulate 에서만. SimulateResponse.regimes 순서의 구간별 수익률(%) */
  regime_returns?: (number | null)[] | null;
}

// ── 파라미터 최적화 ──
export type OptimizeGoal = "consistency" | "risk_adjusted" | "defense" | "trend" | "return";

export interface OptimizeGoalInfo {
  key: OptimizeGoal;
  label: string;
  description: string;
}

export interface OptimizeRequest {
  ticker: string;
  strategy_name: string;
  start_date: string;
  end_date: string;
  invest_mode: "lump_sum" | "dca";
  initial_capital: number;
  monthly_contribution: number;
  original_params: Record<string, number>;
  goal: OptimizeGoal;
  min_trades?: number;
  max_mdd?: number | null;
}

/** 한 구간(선택·검증·전체)의 성과. 입금 효과를 뺀 지수로 잰다. */
export interface SegmentMetrics {
  total_return: number;
  cagr: number;
  sharpe_ratio: number;
  max_drawdown: number;
  trades_count: number;
  entries: number;
  win_rate_vs_bh: number | null;
  median_excess: number | null;
  up_capture: number | null;
  down_exposure: number | null;
  /** 수익(양의 구간 로그수익) 중 가장 큰 한 구간의 비중(%) */
  concentration: number | null;
}

export interface OptimizeRow {
  params: Record<string, number>;
  in_sample: SegmentMetrics | null;
  out_of_sample: SegmentMetrics | null;
  full: SegmentMetrics | null;
  score_in: number | null;
  score_out: number | null;
  /** 주변 조합과 평균낸 선택 구간 점수(고원) */
  score_robust: number | null;
  /** 제약을 어겨 추천에서 뺀 사유 */
  excluded: string | null;
}

export interface OptimizeResult {
  goal: OptimizeGoal;
  goal_label: string;
  mode: "grid" | "random";
  evaluated: number;
  grid_size: number;
  split_date: string;
  start_date: string;
  end_date: string;
  regime_threshold: number;
  axes: { name: string; values: number[] }[];
  benchmark: { in_sample: SegmentMetrics | null; out_of_sample: SegmentMetrics | null };
  /** 고원 점수 내림차순 */
  results: OptimizeRow[];
  recommended: Record<string, number> | null;
  peak: Record<string, number> | null;
  original: Record<string, number>;
  concentration_warn: number;
}

export interface OptimizeJob {
  id: string;
  status: "running" | "done" | "error";
  done: number;
  total: number;
  result: OptimizeResult | null;
  error: string | null;
}

/** Buy & Hold 경로를 고점·저점으로 나눈 추세 구간 */
export interface TrendRegime {
  start: string;
  end: string;
  kind: "up" | "down" | "flat";
  weeks: number;
  benchmark_return: number;
}

/** 한 전략을 파라미터 조합 여러 개로 돌린다 (결과 화면의 파라미터 비교). 저장하지 않는다. */
export interface SimulateRequest {
  ticker: string;
  strategy_name: string;
  start_date: string;
  end_date: string;
  invest_mode: "lump_sum" | "dca";
  initial_capital: number;
  monthly_contribution: number;
  param_sets: Record<string, number>[];
}

export interface SimulateResponse {
  ticker: string;
  data_start: string;
  data_end: string;
  invest_mode: "lump_sum" | "dca";
  total_invested: number;
  /** 같은 구간·같은 투자 방식의 Buy & Hold */
  benchmark: AutoStrategyResult;
  /** param_sets 순서 그대로. 빠진 파라미터는 기본값으로 채워져 온다. */
  results: AutoStrategyResult[];
  regimes: TrendRegime[];
  /** 추세 전환으로 본 되돌림(%). 종목 변동성에 비례한다 */
  regime_threshold: number;
}

export interface AutoBacktestResponse {
  ticker: string;
  start_date: string;
  end_date: string;
  /** 실제 데이터 구간. 상장이 늦은 종목은 요청 구간보다 짧다. */
  data_start: string;
  data_end: string;
  invest_mode: "lump_sum" | "dca";
  total_invested: number;
  /** 총수익률 내림차순 */
  results: AutoStrategyResult[];
  failed: { strategy_name: string; display_name: string; error: string }[];
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

// --- Signals (워치리스트 신호 확인) ---

export interface WatchCreate {
  ticker: string;
  strategy_name: string;
  params: Record<string, number>;
  backtest_id?: number | null;
}

export interface SignalPoint {
  date: string;
  action: "BUY" | "SELL";
  price: number;
}

export interface WatchStatus {
  id: number;
  ticker: string;
  name: string | null;
  strategy_name: string;
  display_name: string;
  params: Record<string, number>;
  backtest_id: number | null;
  created_at: string;
  /** 장이 끝난 마지막 평일. last_bar_date 가 이보다 앞이면 시세가 밀려 있다(휴장일일 수도 있다). */
  expected_bar_date: string;
  last_bar_date: string | null;
  last_close: number | null;
  position: "long" | "flat" | null;
  /** 마지막 매매 신호(보유 상태를 바꾼 것). */
  last_signal: SignalPoint | null;
  bars_since: number | null;
  since_return: number | null;
  /** 마지막 일봉에서 난 신호. */
  is_new: boolean;
  error: string | null;
}

export interface SignalEvent {
  id: number;
  watch_id: number;
  ticker: string;
  strategy_name: string;
  display_name: string;
  params: Record<string, number>;
  date: string;
  action: "BUY" | "SELL";
  price: number;
  /** 감지할 때 캐시의 마지막 일봉. date 보다 뒤면 그만큼 늦게 본 것이다. */
  seen_bar_date: string;
  detected_at: string;
}

export interface SignalRun {
  id: number;
  source: "manual" | "schedule";
  started_at: string;
  finished_at: string | null;
  tickers: number;
  new_events: number;
  failed: { ticker: string; error: string }[];
}

export interface SignalsOverview {
  watches: WatchStatus[];
  events: SignalEvent[];
  last_run: SignalRun | null;
}

// --- Portfolio (보유 종목 관리) ---

export interface HoldingRule {
  kind: "strategy" | "stop" | "target" | "trailing";
  label: string;
  /** 그 가격에 닿으면 걸린다. 전략 청산은 없다. */
  line: number | null;
  triggered: boolean;
  /** 손절·트레일링: 선까지 남은 하락 여유(%), 목표: 남은 상승(%). */
  distance_pct: number | null;
  note: string;
  signal_date?: string | null;
  is_new?: boolean;
}

export interface EntryComparison {
  /** 실제로 산 날 전략도 보유 중이었는지. */
  strategy_holding: boolean;
  strategy_date: string | null;
  strategy_price: number | null;
  actual_date: string;
  actual_price: number;
  price_diff_pct: number | null;
  days_late: number | null;
}

export interface HoldingStatus {
  id: number;
  source: "kis" | "manual";
  ticker: string;
  name: string | null;
  quantity: number;
  avg_price: number;
  exchange: string | null;
  active: boolean;
  first_buy_date: string | null;
  first_buy_price: number | null;
  strategy_name: string | null;
  display_name: string | null;
  params: Record<string, number> | null;
  backtest_id: number | null;
  stop_loss_pct: number | null;
  target_pct: number | null;
  trailing_pct: number | null;
  last_bar_date: string | null;
  last_close: number | null;
  market_value: number | null;
  pnl: number | null;
  pnl_pct: number | null;
  peak_close: number | null;
  rules: HoldingRule[];
  triggered: boolean;
  comparison: EntryComparison | null;
  error: string | null;
}

export interface HoldingRulesUpdate {
  strategy_name: string | null;
  params: Record<string, number> | null;
  backtest_id: number | null;
  stop_loss_pct: number | null;
  target_pct: number | null;
  trailing_pct: number | null;
  first_buy_date: string | null;
  quantity?: number | null;
  avg_price?: number | null;
}

export interface AccountSnapshot {
  date: string;
  env: "paper" | "real";
  cash_krw: number;
  stock_krw: number;
  total_krw: number;
  pnl_krw: number;
  stock_usd: number;
  pnl_usd: number;
  taken_at: string;
}

export interface PortfolioOverview {
  kis: { env: "paper" | "real"; configured: boolean; account_hint: string; last_sync: string | null };
  holdings: HoldingStatus[];
  /** 최근 것부터. */
  snapshots: AccountSnapshot[];
}

export interface PortfolioSyncResult {
  domestic: number;
  overseas: number;
  executions: number;
  errors: string[];
}
