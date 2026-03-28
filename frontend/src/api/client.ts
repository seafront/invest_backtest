import axios from "axios";
import type {
  TickerInfo,
  StockData,
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
  api.get<StockData[]>(`/stocks/${ticker}`);

export const listTickers = () => api.get<TickerInfo[]>("/stocks/");

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
