from datetime import date, datetime
from pydantic import BaseModel


# --- Stock ---
class StockFetchRequest(BaseModel):
    ticker: str
    start_date: date
    end_date: date


class StockData(BaseModel):
    date: date
    open: float
    high: float
    low: float
    close: float
    volume: int

    class Config:
        from_attributes = True


class TickerInfo(BaseModel):
    ticker: str
    start_date: date
    end_date: date
    count: int
    name: str | None = None
    universes: list[str] = []


class RefreshRequest(BaseModel):
    start_date: date
    end_date: date


class RefreshResult(BaseModel):
    ticker: str
    added: int
    count: int
    error: str | None = None


class UniverseInfo(BaseModel):
    key: str
    label: str


class BulkFetchRequest(BaseModel):
    universe: str = "sp500"
    start_date: date
    end_date: date


class BulkFetchStatus(BaseModel):
    running: bool
    universe: str
    total: int
    done: int
    added: int
    failed: list[str]
    started_at: datetime | None
    finished_at: datetime | None
    error: str | None


class DrawdownPoint(BaseModel):
    date: date
    drawdown: float


class YearlyReturn(BaseModel):
    year: int
    return_pct: float
    partial: bool = False


class BearMarket(BaseModel):
    peak_date: date
    trough_date: date
    recovery_date: date | None
    peak_close: float
    trough_close: float
    decline_pct: float
    decline_days: int
    recovery_days: int | None
    return_3m: float | None
    return_6m: float | None
    return_12m: float | None


class DayChange(BaseModel):
    date: date
    change: float


class StockStats(BaseModel):
    ticker: str
    start_date: date
    end_date: date
    trading_days: int
    years: float
    first_close: float
    last_close: float
    total_return: float
    cagr: float
    annual_volatility: float
    max_drawdown: float
    sharpe_ratio: float
    best_day: DayChange
    worst_day: DayChange
    positive_day_pct: float
    drawdown_curve: list[DrawdownPoint]
    yearly_returns: list[YearlyReturn]
    bear_markets: list[BearMarket]


class IndicatorSignal(BaseModel):
    key: str
    label: str
    detail: str
    level: str  # ok / watch / alert


class IndicatorPoint(BaseModel):
    date: date
    close: float
    disparity_5: float | None
    disparity_20: float | None
    disparity_60: float | None
    turnover_ratio: float | None


class StockIndicators(BaseModel):
    """OHLCV에서 파생된 현재 상태 지표. 새로 받아오는 데이터는 없다."""
    ticker: str
    as_of: date
    close: float
    ma5: float | None
    ma20: float | None
    ma60: float | None
    above_ma20_days: int
    disparity_5: float | None
    disparity_20: float | None
    disparity_60: float | None
    return_5d: float | None
    return_20d: float | None
    return_60d: float | None
    turnover_avg5: float
    turnover_avg20: float
    turnover_avg60: float | None
    turnover_ratio_5_60: float | None
    high_52w: float
    low_52w: float
    from_high_pct: float | None
    from_low_pct: float | None
    is_52w_high: bool
    volatility_20d: float | None
    upper_wick_days_20: int
    bullish_days_15: int
    low_rising: bool | None
    signals: list[IndicatorSignal]
    series_range: str
    series: list[IndicatorPoint]


# --- Macro ---
class MacroCatalogItem(BaseModel):
    series_id: str
    name: str
    unit: str
    frequency: str
    description: str = ""


class MacroFetchRequest(BaseModel):
    series_id: str


class MacroSeriesInfo(BaseModel):
    series_id: str
    name: str
    unit: str
    frequency: str
    source: str
    start_date: date
    end_date: date
    count: int


class MacroPoint(BaseModel):
    date: date
    value: float


class MacroSeriesDetail(MacroSeriesInfo):
    description: str = ""
    latest_value: float
    min_value: float
    max_value: float
    data: list[MacroPoint]


# --- Strategy ---
class ParamSchema(BaseModel):
    name: str
    type: str
    default: float | int
    min: float | int
    max: float | int
    description: str = ""


class StrategyInfo(BaseModel):
    name: str
    display_name: str
    description: str
    params: list[ParamSchema]


# --- Backtest ---
class BacktestRequest(BaseModel):
    ticker: str
    strategy_name: str
    params: dict
    start_date: date
    end_date: date
    invest_mode: str = "lump_sum"  # "lump_sum" or "dca"
    initial_capital: float = 100000.0
    monthly_contribution: float = 0.0


class TradeResult(BaseModel):
    date: date
    action: str
    price: float
    shares: int
    pnl: float

    class Config:
        from_attributes = True


class EquityPoint(BaseModel):
    date: date
    equity: float


class BacktestSummary(BaseModel):
    id: int
    ticker: str
    strategy_name: str
    params: dict
    start_date: date
    end_date: date
    invest_mode: str = "lump_sum"
    initial_capital: float
    monthly_contribution: float = 0.0
    total_invested: float | None
    total_return: float | None
    cagr: float | None
    sharpe_ratio: float | None
    max_drawdown: float | None
    win_rate: float | None
    created_at: datetime | None

    class Config:
        from_attributes = True


class BacktestResult(BaseModel):
    id: int
    ticker: str
    strategy_name: str
    params: dict
    start_date: date
    end_date: date
    invest_mode: str = "lump_sum"
    initial_capital: float
    monthly_contribution: float = 0.0
    total_invested: float
    total_return: float
    cagr: float
    sharpe_ratio: float
    max_drawdown: float
    win_rate: float
    equity_curve: list[EquityPoint]
    trades: list[TradeResult]
    indicators: dict | None = None
    created_at: datetime | None

    class Config:
        from_attributes = True
