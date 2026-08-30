import axios from "axios";
import type {
  TickerInfo,
  StockData,
  StockStats,
  StockIndicators,
  InvestorFlowSeries,
  RefreshResult,
  BulkFetchStatus,
  UniverseInfo,
  MacroCatalogItem,
  MacroSeriesInfo,
  MacroSeriesDetail,
  StrategyInfo,
  BacktestRequest,
  BacktestResult,
  BacktestSummary,
  MarketCapResult,
  FullScreenResponse,
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

export const getBulkFetchStatus = () =>
  api.get<BulkFetchStatus>("/stocks/bulk-fetch/status");

export const getInvestorFlow = (ticker: string) =>
  api.get<InvestorFlowSeries>(`/stocks/${encodeURIComponent(ticker)}/investor-flow`);

export const syncInvestorFlow = (ticker: string, months = 3) =>
  api.post<InvestorFlowSeries>(
    `/stocks/${encodeURIComponent(ticker)}/investor-flow/sync`,
    { months }
  );

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

export const listBacktests = () =>
  api.get<BacktestSummary[]>("/backtests/");

export const getBacktest = (id: number) =>
  api.get<BacktestResult>(`/backtests/${id}`);

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
