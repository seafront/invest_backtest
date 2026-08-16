from datetime import date, datetime
from sqlalchemy import Column, Integer, String, Float, Date, DateTime, JSON, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from database import Base


class Stock(Base):
    __tablename__ = "stocks"

    id = Column(Integer, primary_key=True, index=True)
    ticker = Column(String, index=True, nullable=False)
    date = Column(Date, nullable=False)
    open = Column(Float, nullable=False)
    high = Column(Float, nullable=False)
    low = Column(Float, nullable=False)
    close = Column(Float, nullable=False)
    volume = Column(Integer, nullable=False)

    __table_args__ = (UniqueConstraint("ticker", "date", name="uq_ticker_date"),)


class MacroSeries(Base):
    """거시 지표의 메타데이터. 값은 macro_data에 따로 쌓는다.

    주가와 형태가 달라 stocks 테이블을 쓸 수 없다 — 값이 하나뿐이고,
    주기가 일·주·월·분기로 섞이며, 월간 시계열은 매월 1일로 스탬프된다.
    """
    __tablename__ = "macro_series"

    id = Column(Integer, primary_key=True, index=True)
    series_id = Column(String, unique=True, index=True, nullable=False)  # 예: UNRATE
    name = Column(String, nullable=False)
    unit = Column(String, default="")
    frequency = Column(String, default="")  # daily / weekly / monthly / quarterly
    source = Column(String, default="FRED")
    updated_at = Column(DateTime, default=datetime.utcnow)

    points = relationship("MacroData", back_populates="series", cascade="all, delete-orphan")


class MacroData(Base):
    __tablename__ = "macro_data"

    id = Column(Integer, primary_key=True, index=True)
    series_id = Column(String, ForeignKey("macro_series.series_id"), index=True, nullable=False)
    date = Column(Date, nullable=False)
    value = Column(Float, nullable=False)

    series = relationship("MacroSeries", back_populates="points")

    __table_args__ = (UniqueConstraint("series_id", "date", name="uq_series_date"),)


class Backtest(Base):
    __tablename__ = "backtests"

    id = Column(Integer, primary_key=True, index=True)
    ticker = Column(String, nullable=False)
    strategy_name = Column(String, nullable=False)
    params = Column(JSON, nullable=False)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    invest_mode = Column(String, default="lump_sum")
    initial_capital = Column(Float, nullable=False)
    monthly_contribution = Column(Float, default=0.0)
    total_invested = Column(Float)
    total_return = Column(Float)
    cagr = Column(Float)
    sharpe_ratio = Column(Float)
    max_drawdown = Column(Float)
    win_rate = Column(Float)
    equity_curve = Column(JSON)
    created_at = Column(DateTime, default=datetime.utcnow)

    trades = relationship("Trade", back_populates="backtest", cascade="all, delete-orphan")


class Trade(Base):
    __tablename__ = "trades"

    id = Column(Integer, primary_key=True, index=True)
    backtest_id = Column(Integer, ForeignKey("backtests.id"), nullable=False)
    date = Column(Date, nullable=False)
    action = Column(String, nullable=False)  # BUY or SELL
    price = Column(Float, nullable=False)
    shares = Column(Integer, nullable=False)
    pnl = Column(Float, default=0.0)

    backtest = relationship("Backtest", back_populates="trades")
