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
