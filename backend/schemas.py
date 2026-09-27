from datetime import date, datetime
from pydantic import BaseModel, Field


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
    sector: str | None = None
    industry: str | None = None
    industry_krx: str | None = None
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
    # 한국 종목에만 해당한다. 증권사 키가 없으면 무시된다.
    with_flows: bool = True
    # 시세 구간과 맞춘 5년. 처음 받을 때 오래 걸리지만 재실행은 종목당 1회다.
    flow_months: int = 60


class BulkFetchStatus(BaseModel):
    running: bool
    universe: str
    phase: str = ""
    total: int
    done: int
    added: int
    failed: list[str]
    flow_total: int = 0
    flow_done: int = 0
    flow_added: int = 0
    fund_total: int = 0
    fund_done: int = 0
    fund_added: int = 0
    started_at: datetime | None
    finished_at: datetime | None
    error: str | None
    external: bool = False  # 서버 밖(collect.py)에서 도는 수집이면 True


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


class InvestorFlowPoint(BaseModel):
    date: date
    close: float | None
    prsn_ntby_qty: int | None
    frgn_ntby_qty: int | None
    orgn_ntby_qty: int | None
    prsn_ntby_amt: float | None
    frgn_ntby_amt: float | None
    orgn_ntby_amt: float | None
    fund_ntby_qty: int | None
    ivtr_ntby_qty: int | None
    pe_fund_ntby_qty: int | None
    scrt_ntby_qty: int | None

    class Config:
        from_attributes = True


class InvestorFlowSeries(BaseModel):
    """한국 종목 전용. 미국 시장은 투자자 유형별 매매동향을 공개하지 않는다."""
    ticker: str
    count: int
    start_date: date | None
    end_date: date | None
    data: list[InvestorFlowPoint]


class InvestorFlowSyncRequest(BaseModel):
    months: int = 60


class ScanRequest(BaseModel):
    """스크리너 조건. 값이 None/False 면 그 조건은 끈다."""
    universe: str | None = None
    limit: int = 100
    above_ma20: bool = False
    above_ma60: bool = False
    turnover_ratio_min: float | None = None
    disparity_max: float | None = None
    return_5d_max: float | None = None
    return_20d_min: float | None = None
    from_high_min: float | None = None
    frgn_buy: bool = False
    orgn_buy: bool = False
    prsn_not_crowded: bool = False
    min_turnover: float | None = None
    sector: str | None = None


class ScanStep(BaseModel):
    key: str
    label: str
    value: str
    passed: int
    remaining: int


class ScanRow(BaseModel):
    ticker: str
    name: str | None
    sector: str | None
    industry: str | None
    close: float
    date: date
    above_ma20: bool
    above_ma60: bool
    disparity_20: float | None
    turnover_ratio: float | None
    turnover_avg5: float | None
    return_5d: float | None
    return_20d: float | None
    from_high_pct: float | None
    frgn_ntby_20d: int | None
    orgn_ntby_20d: int | None
    prsn_ntby_20d: int | None


class ScanResponse(BaseModel):
    universe: str | None
    total: int
    matched: int
    funnel: list[ScanStep]
    rows: list[ScanRow]


class FundamentalPoint(BaseModel):
    period_end: date
    revenue: float | None
    gross_profit: float | None
    operating_income: float | None
    net_income: float | None
    inventory: float | None
    receivables: float | None
    total_assets: float | None
    total_debt: float | None
    equity: float | None
    operating_cashflow: float | None
    free_cashflow: float | None
    # KIS 재무비율에만 있다. yfinance 행에서는 비어 있다.
    roe: float | None = None
    eps: float | None = None
    bps: float | None = None
    period_type: str = "quarterly"
    source: str = "yfinance"

    class Config:
        from_attributes = True


class FundamentalSeries(BaseModel):
    ticker: str
    count: int
    first_period: date | None
    last_period: date | None
    # 금액은 실제 단위로 정규화해 내보낸다(억원 → 원). 통화는 상장 시장에서 온다.
    currency: str = "USD"
    period_type: str = "quarterly"
    source: str = "yfinance"
    data: list[FundamentalPoint]


class SnapshotPoint(BaseModel):
    date: date
    close: float | None
    market_cap: float | None
    per: float | None
    pbr: float | None
    target_mean: float | None
    target_high: float | None
    target_low: float | None
    analyst_count: int | None
    recommendation: str | None

    class Config:
        from_attributes = True


class SnapshotSeries(BaseModel):
    ticker: str
    count: int
    start_date: date | None
    end_date: date | None
    data: list[SnapshotPoint]


class SnapshotCaptureRequest(BaseModel):
    """대상을 고르지 않으면 캐시된 전 종목을 찍는다."""
    universe: str | None = None
    tickers: list[str] | None = None


class IndustryInfo(BaseModel):
    key: str
    label: str
    note: str


class GroupMemberPrice(BaseModel):
    close: float
    as_of: date
    return_20d: float | None
    return_60d: float | None
    return_252d: float | None
    from_high_pct: float | None
    volatility_60d: float | None


class GroupMemberFundamental(BaseModel):
    period_end: date
    quarters: int
    operating_margin: float | None
    operating_margin_delta: float | None
    gross_margin: float | None
    revenue_qoq: float | None
    revenue_yoy: float | None
    inventory_to_revenue: float | None
    ocf_to_revenue: float | None
    debt_to_equity: float | None


class GroupMemberFlow(BaseModel):
    frgn_ntby_20d: int
    orgn_ntby_20d: int
    prsn_ntby_20d: int


class GroupMemberSnapshot(BaseModel):
    market_cap: float | None
    per: float | None
    pbr: float | None
    target_upside: float | None
    analyst_count: int | None
    recommendation: str | None


class GroupMember(BaseModel):
    ticker: str
    name: str | None
    cached: bool
    price: GroupMemberPrice | None
    fundamental: GroupMemberFundamental | None
    flow: GroupMemberFlow | None
    snapshot: GroupMemberSnapshot | None


class ProductGroup(BaseModel):
    key: str
    label: str
    note: str
    unlisted: list[str]
    members: list[GroupMember]
    # {date, <ticker>: 값} 형태. 티커가 키라 스키마를 고정하지 않는다.
    price_series: list[dict] = []
    # {지표: [{date, <ticker>: 값}]} — 화면에서 지표를 바꿔 가며 본다.
    financial_series: dict[str, list[dict]] = {}


class FinancialMetricInfo(BaseModel):
    key: str
    label: str
    unit: str
    baseline: float | None
    note: str


class ChartRangeInfo(BaseModel):
    key: str
    label: str
    days: int


class IndustryOverview(BaseModel):
    industry: str
    label: str
    note: str
    chart_range: str = "1y"
    ranges: list[ChartRangeInfo] = []
    metrics: list[FinancialMetricInfo] = []
    groups: list[ProductGroup]


class PeriodInfo(BaseModel):
    key: str
    label: str
    days: int
    note: str


class ReportRow(BaseModel):
    ticker: str
    name: str | None = None
    industry: str | None = None
    return_pct: float | None = None
    turnover_ratio: float | None = None
    frgn_ntby_qty: float | None = None
    orgn_ntby_qty: float | None = None
    prsn_ntby_qty: float | None = None


class Breadth(BaseModel):
    advancing: int
    declining: int
    unchanged: int
    total: int
    median_return: float | None
    above_ma20: int
    above_ma20_pct: float
    new_high_52w: int
    new_low_52w: int


class FlowSection(BaseModel):
    available: bool
    days: int | None = None
    both_buy_count: int | None = None
    top_foreign: list[ReportRow] = []
    bottom_foreign: list[ReportRow] = []
    both_buy: list[ReportRow] = []


class SectorRow(BaseModel):
    industry: str
    count: int
    median_return: float | None
    prev_median_return: float | None
    advancing: int
    frgn_ntby: int | None


class TrendWindow(BaseModel):
    key: str
    label: str
    months: int
    base_date: date


class SectorTrendRow(BaseModel):
    industry: str
    count: int
    # 구간 키 -> 중앙 수익률(%). 시세가 모자란 구간은 아예 빠진다.
    returns: dict[str, float | None]


class SectorTrendResponse(BaseModel):
    universe: str
    as_of: date
    windows: list[TrendWindow]
    market: dict[str, float | None]
    sectors: list[SectorTrendRow]


class SectorCurve(BaseModel):
    industry: str
    count: int
    return_pct: float | None
    # dates 와 같은 길이. 구간 시작을 0%로 둔 누적수익률.
    values: list[float | None]


class SectorCurveResponse(BaseModel):
    universe: str
    months: int
    as_of: date
    start_date: date
    dates: list[date]
    market: list[float | None]
    sectors: list[SectorCurve]


class RangeInfo(BaseModel):
    key: str
    label: str
    months: int


class DrawdownSummary(BaseModel):
    median: float | None
    within_5pct: int
    below_20pct: int


class Movers(BaseModel):
    top: list[ReportRow]
    bottom: list[ReportRow]


class ReportResponse(BaseModel):
    period: str
    label: str
    note: str
    universe: str
    as_of: date
    base_date: date
    trading_days: int
    breadth: Breadth
    movers: Movers
    turnover_surge: list[ReportRow]
    flows: FlowSection
    sectors: list[SectorRow]
    drawdown: DrawdownSummary


# --- Macro ---
class MacroCatalogItem(BaseModel):
    series_id: str
    category: str = "기타"
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


class AutoBacktestRequest(BaseModel):
    """한 종목에 등록된 전략 전부를 기본 파라미터로 돌린다. 기간은 오늘 기준 최근 N년."""
    ticker: str
    years: int = Field(5, ge=1, le=30)
    invest_mode: str = "lump_sum"
    initial_capital: float = 100000.0
    monthly_contribution: float = 0.0


class AutoCurvePoint(BaseModel):
    date: date
    ret: float  # 누적 수익률(%) = (평가금액 - 그때까지 넣은 원금) / 그때까지 넣은 원금
    idx: float  # 입금 효과를 뺀 수익률 지수(시작 1.0). 두 점의 비율 = 그 구간 수익률


class AutoStrategyResult(BaseModel):
    strategy_name: str
    display_name: str
    params: dict
    total_return: float
    cagr: float
    sharpe_ratio: float
    max_drawdown: float
    win_rate: float
    trades_count: int  # 청산(SELL) 횟수
    curve: list[AutoCurvePoint]  # 주 단위로 줄인 누적 수익률
    # 첫 매매일. 그 전 구간의 0%는 판단이 아니라 "아직 들어가지 않음"이다 — 긴 이동평균은
    # 계산에 필요한 일수만큼 신호를 못 내므로, 시작 직후 구간을 방어로 읽으면 안 된다.
    first_trade: date | None = None
    # /simulate 에서만 채운다. SimulateResponse.regimes 와 같은 순서의 구간별 수익률(%).
    regime_returns: list[float | None] | None = None


class AutoStrategyFailure(BaseModel):
    strategy_name: str
    display_name: str
    error: str


class AutoBacktestResponse(BaseModel):
    ticker: str
    start_date: date  # 요청 구간
    end_date: date
    data_start: date  # 실제 데이터 구간 — 상장이 늦은 종목은 요청보다 짧다
    data_end: date
    invest_mode: str
    total_invested: float
    results: list[AutoStrategyResult]  # 총수익률 내림차순
    failed: list[AutoStrategyFailure]


class SimulateRequest(BaseModel):
    """한 전략을 파라미터 조합 여러 개로 돌려 비교한다. 저장하지 않는다."""
    ticker: str
    strategy_name: str
    start_date: date
    end_date: date
    invest_mode: str = "lump_sum"
    initial_capital: float = 100000.0
    monthly_contribution: float = 0.0
    param_sets: list[dict] = Field(..., min_length=1, max_length=10)


class TrendRegime(BaseModel):
    start: date
    end: date
    kind: str  # up / down / flat
    weeks: int
    benchmark_return: float  # 그 구간 Buy & Hold 수익률(%)


class SimulateResponse(BaseModel):
    ticker: str
    data_start: date
    data_end: date
    invest_mode: str
    total_invested: float
    benchmark: AutoStrategyResult  # 같은 구간·같은 투자 방식의 Buy & Hold
    results: list[AutoStrategyResult]  # param_sets 순서 그대로
    regimes: list[TrendRegime]  # Buy & Hold 경로를 고점·저점으로 나눈 추세 구간
    regime_threshold: float  # 추세 전환으로 본 되돌림(%). 종목 변동성에 비례한다


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
