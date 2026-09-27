# CLAUDE.md

This file guides Claude Code (and other AI agents) when working in this repository.
For a human-facing overview see `README.md`; for deep design rationale see `ARCHITECTURE.md`.
For what data the app supports today and what to add next, see `doc/roadmap.md`.
For the trading-agent architecture (not yet implemented), see `doc/trading-agent.md`.

## What this is

**BacktestLab** — a US stock-market trading-strategy backtesting web app. A FastAPI
backend downloads OHLCV data from Yahoo Finance (yfinance), caches it in SQLite, runs a
custom backtest engine over pluggable strategies, and a React + TypeScript SPA
visualizes results (equity curve, candlestick chart, metrics, trade log).

## Commands

```bash
# Start both servers (kills anything on :8000 / :5173 first)
./start.sh

# Backend only
cd backend
source venv/bin/activate            # venv already exists in repo
uvicorn main:app --reload --port 8000

# Long index collection outside the dev server (survives --reload restarts;
# progress still shows in Data Manager). Resumes where it stopped.
python collect.py kospi200                              # prices + investor flows, 5y
python collect.py sp500 --no-flows
python collect.py kospi200 --tickers 023530.KS,024110.KS   # refill a few
# Editing any backend .py while a *server-side* bulk job runs kills that job.

# First-time backend setup
cd backend && python -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# Frontend only
cd frontend
npm run dev                         # dev server on :5173
npm run build                       # tsc -b && vite build
npm run lint                        # eslint
```

- UI: http://localhost:5173
- API + Swagger docs: http://localhost:8000/docs
- There is **no test suite** — verify changes by running the app and exercising the flow.

## Architecture map

```
backend/
  main.py                     FastAPI app, CORS (allows :5173 only), router registration
  database.py                 SQLAlchemy engine/session, SQLite at backend/backtest.db
  models.py                   ORM: Stock (OHLCV cache), Backtest, Trade
  schemas.py                  Pydantic request/response models
  routers/                    stocks, strategies, backtests, screening
  services/
    data_fetcher.py           yfinance download + SQLite cache (fetch/get/list)
    backtest_engine.py        run_backtest() — portfolio simulation loop
    screener.py               2-step screener (market cap -> strategy ranking)
    strategies/
      base.py                 Strategy ABC + Signal dataclass
      __init__.py             STRATEGY_REGISTRY + get_strategy()/list_strategies()
      <one file per strategy> 15 strategies
  utils/metrics.py            total_return, cagr, sharpe_ratio, max_drawdown, win_rate

frontend/src/
  App.tsx                     BrowserRouter + nav; routes below
  api/client.ts               Axios client, baseURL http://localhost:8000/api
  types/index.ts              TS interfaces mirroring backend schemas
  pages/                      Dashboard, DataManager, BacktestRun, BacktestResult, Strategies, Screener
  components/                 StrategyForm, MetricsPanel, EquityCurve, CandlestickChart, TradeLog, ErrorBoundary
```

### Routes (frontend)
`/` Dashboard · `/data` DataManager · `/backtest` BacktestRun · `/results/:id`
BacktestResult · `/strategies` Strategies · `/screener` Screener

### API (base `http://localhost:8000/api`)
- `POST /stocks/fetch` · `GET /stocks/{ticker}` · `GET /stocks/`
- `GET /strategies/`
- `POST /backtests/run` · `GET /backtests/` (last 50) · `GET /backtests/{id}` · `DELETE /backtests/{id}`
- `GET /screening/pool` · `POST /screening/market-cap` · `POST /screening/full`

## Key conventions & patterns

- **Strategy registry / factory.** Each strategy subclasses `Strategy` (base.py) and
  implements `generate_signals(df, params) -> list[Signal]`; optionally
  `compute_indicators(df, params)` for chart overlays. It declares `name`,
  `display_name`, `description`, and `param_schema` (list of
  `{name, type, default, min, max, description}`). Register the instance in
  `STRATEGY_REGISTRY` in `services/strategies/__init__.py`. It is then auto-exposed via
  `GET /strategies/` and rendered dynamically by `StrategyForm.tsx` — **no frontend
  change needed** to add a strategy.
- **Param validation** happens in `routers/backtests.py` against each strategy's
  `param_schema` min/max before running.
- **Data caching.** OHLCV lives in the `stocks` table with a `UNIQUE(ticker, date)`
  constraint. `run_backtest` endpoint auto-fetches from yfinance if the cache is missing
  or starts >7 days after the requested start. Tickers are uppercased everywhere.
- **yfinance quirk:** downloads may return a MultiIndex column frame; `data_fetcher.py`
  flattens it. Keep that handling if you touch fetching.
- **Invest modes:** `lump_sum` (initial capital) and `dca` (monthly_contribution,
  dollar-cost averaging). The engine handles both in one loop in `backtest_engine.py`.
- **equity_curve** is stored as a JSON column on `backtests` (list of `{date, equity}`),
  not a separate table. Indicators are recomputed on read, not stored.
- **Metrics:** Sharpe is annualized (×√252, 2% risk-free); win_rate is over SELL trades
  only; CAGR uses days/365.25.
- **Type safety is dual-sided:** Pydantic (`schemas.py`) and TypeScript
  (`types/index.ts`) must stay in sync when you change the API shape.

## Gotchas

- **CORS is pinned to `http://localhost:5173`** in `main.py`. Change there if the
  frontend port/origin changes.
- **lightweight-charts is v4** (see package.json); v5 has breaking API changes — do not
  upgrade casually. The candlestick chart in `CandlestickChart.tsx` depends on v4 APIs.
- **No migrations.** Tables are created via `Base.metadata.create_all` at startup. If you
  add/rename columns on existing models, the local `backend/backtest.db` won't
  auto-migrate — delete it or migrate manually (schema already has post-initial columns
  like `invest_mode`, `cagr`, `monthly_contribution`, `total_invested`).
- **The DB file `backend/backtest.db` and `backend/venv/` are gitignored.**

## Adding a new strategy (checklist)

1. Create `backend/services/strategies/<name>.py` subclassing `Strategy`.
2. Set `name`, `display_name`, `description`, `param_schema`; implement
   `generate_signals`; optionally `compute_indicators`.
3. Import it and add an instance to `STRATEGY_REGISTRY` in `strategies/__init__.py`.
4. Run the app and confirm it appears in the Backtest form and Strategies page.
