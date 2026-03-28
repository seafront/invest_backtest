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
    initial_capital: float = 100000.0


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
    initial_capital: float
    total_return: float | None
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
    initial_capital: float
    total_return: float
    sharpe_ratio: float
    max_drawdown: float
    win_rate: float
    equity_curve: list[EquityPoint]
    trades: list[TradeResult]
    indicators: dict | None = None
    created_at: datetime | None

    class Config:
        from_attributes = True
