import axios from "axios";
import type {
  Allocation,
  GuideRow,
  PortfolioRisk,
  HoldingRulesUpdate,
  HoldingStatus,
  PortfolioOverview,
  PortfolioSyncResult,
  SignalsOverview,
  SignalRun,
  WatchCreate,
  WatchStatus,
  TickerInfo,
  StockData,
  StockStats,
  StockIndicators,
  InvestorFlowSeries,
  FundamentalSeries,
  RefreshResult,
  BulkFetchStatus,
  UniverseInfo,
  MacroCatalogItem,
  MacroSeriesInfo,
  MacroSeriesDetail,
  StrategyInfo,
  BacktestRequest,
  AutoBacktestRequest,
  AutoBacktestResponse,
  SimulateRequest,
  OptimizeGoalInfo,
  OptimizeRequest,
  OptimizeJob,
  SimulateResponse,
  BacktestResult,
  BacktestSummary,
  MarketCapResult,
  FullScreenResponse,
  ScanRequest,
  ScanResponse,
  IndustryInfo,
  IndustryOverview,
  PeriodInfo,
  ReportResponse,
  RangeInfo,
  SectorCurveResponse,
  SectorTrendResponse,
} from "../types";

const api = axios.create({
  baseURL: "http://localhost:8000/api",
});

// Stocks
export const fetchStockData = (
  ticker: string,
  start_date: string,
  end_date: string
) => api.post<StockData[]>("/stocks/fetch", { ticker, start_date, end_date });

export const getStockData = (ticker: string) =>
  api.get<StockData[]>(`/stocks/${encodeURIComponent(ticker)}`);

export const getStockStats = (ticker: string) =>
  api.get<StockStats>(`/stocks/${encodeURIComponent(ticker)}/stats`);

export const getStockIndicators = (ticker: string, range = "1y") =>
  api.get<StockIndicators>(`/stocks/${encodeURIComponent(ticker)}/indicators`, {
    params: { range },
  });

export const refreshCachedData = (start_date: string, end_date: string) =>
  api.post<RefreshResult[]>("/stocks/refresh", { start_date, end_date });

export const listUniverses = () => api.get<UniverseInfo[]>("/stocks/universes");

/** 시세 없이 구성종목·회사 이름만 갱신한다. 값은 종목 수 또는 실패 사유 문자열. */
export const syncUniverses = () =>
  api.post<Record<string, number | string>>("/stocks/universes/sync");

export const startBulkFetch = (
  universe: string,
  start_date: string,
  end_date: string
) => api.post<BulkFetchStatus>("/stocks/bulk-fetch", { universe, start_date, end_date });

export const startBulkFundamentals = (universe: string) =>
  api.post<BulkFetchStatus>("/stocks/bulk-fundamentals", null, { params: { universe } });

export const getBulkFetchStatus = () =>
  api.get<BulkFetchStatus>("/stocks/bulk-fetch/status");

export const getInvestorFlow = (ticker: string) =>
  api.get<InvestorFlowSeries>(`/stocks/${encodeURIComponent(ticker)}/investor-flow`);

export const syncInvestorFlow = (ticker: string, months = 60) =>
  api.post<InvestorFlowSeries>(
    `/stocks/${encodeURIComponent(ticker)}/investor-flow/sync`,
    { months }
  );

export const getFundamentals = (ticker: string, periodType: "quarterly" | "annual" = "quarterly") =>
  api.get<FundamentalSeries>(`/stocks/${encodeURIComponent(ticker)}/fundamentals`, {
    params: { period_type: periodType },
  });

export const syncFundamentals = (ticker: string, periodType: "quarterly" | "annual" = "quarterly") =>
  api.post<FundamentalSeries>(`/stocks/${encodeURIComponent(ticker)}/fundamentals/sync`, null, {
    params: { period_type: periodType },
  });

export const listTickers = () => api.get<TickerInfo[]>("/stocks/");

// Macro (FRED)
export const listMacroCatalog = () =>
  api.get<MacroCatalogItem[]>("/macro/catalog");

export const fetchMacroSeries = (series_id: string) =>
  api.post<MacroSeriesInfo>("/macro/fetch", { series_id });

export const listMacroSeries = () => api.get<MacroSeriesInfo[]>("/macro/");

export const getMacroSeries = (series_id: string) =>
  api.get<MacroSeriesDetail>(`/macro/${encodeURIComponent(series_id)}`);

// Strategies
export const listStrategies = () => api.get<StrategyInfo[]>("/strategies/");

// Backtests
export const runBacktest = (req: BacktestRequest) =>
  api.post<BacktestResult>("/backtests/run", req);

export const runAutoBacktest = (req: AutoBacktestRequest) =>
  api.post<AutoBacktestResponse>("/backtests/auto", req);

export const simulateParams = (req: SimulateRequest) =>
  api.post<SimulateResponse>("/backtests/simulate", req);

export const listOptimizeGoals = () => api.get<OptimizeGoalInfo[]>("/backtests/optimize/goals");

export const startOptimize = (req: OptimizeRequest) =>
  api.post<{ id: string; status: string }>("/backtests/optimize", req);

export const getOptimizeJob = (id: string) => api.get<OptimizeJob>(`/backtests/optimize/${id}`);

export const listBacktests = () =>
  api.get<BacktestSummary[]>("/backtests/");

/** period 를 주면 저장된 구간 안의 그 구간으로 다시 돌려 받는다(저장하지 않음). */
export const getBacktest = (id: number, period?: { start: string; end: string }) =>
  api.get<BacktestResult>(`/backtests/${id}`, { params: period });

export const deleteBacktest = (id: number) =>
  api.delete(`/backtests/${id}`);

// Screening
export const screenMarketCap = (pool?: string[], top_n: number = 5) =>
  api.post<MarketCapResult[]>("/screening/market-cap", { pool, top_n });

export const fullScreening = (params: {
  pool?: string[];
  market_cap_top?: number;
  strategy_top?: number;
  start_date?: string;
  end_date?: string;
  initial_capital?: number;
}) => api.post<FullScreenResponse>("/screening/full", params);

export const scanStocks = (req: ScanRequest) =>
  api.post<ScanResponse>("/screening/scan", req);

// Industry
export const listIndustries = () => api.get<IndustryInfo[]>("/industry/");

export const getIndustry = (key: string, range = "1y") =>
  api.get<IndustryOverview>(`/industry/${encodeURIComponent(key)}`, { params: { range } });

// Reports
export const listPeriods = () => api.get<PeriodInfo[]>("/reports/periods");

export const getReport = (period: string, universe = "kospi200") =>
  api.get<ReportResponse>(`/reports/${encodeURIComponent(period)}`, { params: { universe } });

export const getSectorTrends = (universe = "kospi200") =>
  api.get<SectorTrendResponse>("/reports/sector-trends", { params: { universe } });

export const listCurveRanges = () => api.get<RangeInfo[]>("/reports/curve-ranges");

export const getSectorCurves = (universe = "kospi200", months = 60) =>
  api.get<SectorCurveResponse>("/reports/sector-curves", { params: { universe, months } });

// --- Signals ---
export const getSignals = () => api.get<SignalsOverview>("/signals/");
export const addWatch = (req: WatchCreate) => api.post<WatchStatus>("/signals/watches", req);
export const deleteWatch = (id: number) => api.delete(`/signals/watches/${id}`);
/** 장이 끝난 마지막 날까지 시세를 받고 새 신호를 기록한다. 종목당 1~2초. */
export const checkSignals = () => api.post<SignalRun>("/signals/check", null, { timeout: 300_000 });

// --- Portfolio ---
export const getPortfolio = () => api.get<PortfolioOverview>("/portfolio/");
/** KIS 잔고·체결 조회(주문 없음) + 보유 종목 시세. 모의 서버는 느려 몇십 초 걸릴 수 있다. */
export const syncPortfolio = () => api.post<PortfolioSyncResult>("/portfolio/sync", null, { timeout: 300_000 });
export const addHolding = (req: { ticker: string; quantity: number; avg_price: number; first_buy_date: string | null }) =>
  api.post<HoldingStatus>("/portfolio/holdings", req, { timeout: 120_000 });
export const updateHolding = (id: number, req: HoldingRulesUpdate) =>
  api.put<HoldingStatus>(`/portfolio/holdings/${id}`, req);
export const deleteHolding = (id: number) => api.delete(`/portfolio/holdings/${id}`);
export const getAllocation = (band: number) => api.get<Allocation>("/portfolio/allocation", { params: { band } });
export const saveTargets = (items: { ticker: string; weight: number }[], band: number) =>
  api.put<Allocation>("/portfolio/targets", items, { params: { band }, timeout: 120_000 });
export const getPortfolioRisk = () => api.get<PortfolioRisk>("/portfolio/risk");
/** 종목당 1~3초 — 가상의 다음 봉으로 전략을 수십 번 돌린다. */
export const getPortfolioGuide = () => api.get<GuideRow[]>("/portfolio/guide", { timeout: 300_000 });
