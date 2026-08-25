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


class Company(Base):
    """티커 → 회사 이름. 지수 구성종목 표에서 얻은 이름을 담아 둔다.

    yfinance의 .info로 받으면 종목당 약 0.9초가 걸려 522종목이면 8분이다.
    구성종목 표에는 이름이 함께 들어 있으므로 추가 요청 없이 채운다.
    """
    __tablename__ = "companies"

    ticker = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    # GICS 섹터(11종). 위키피디아 S&P 500 표에서 그대로 얻는다.
    sector = Column(String)
    # 세부 분류. 미국은 GICS 하위산업, 한국은 네이버 업종(WICS 계열, GICS 산업 수준).
    industry = Column(String)
    # KRX가 상장법인에 부여한 업종(통계청 KSIC 기반). 코스피 200의 공식 기준이라
    # 한국 종목은 이쪽을 보여준다. GICS 계열인 industry는 시장 간 비교용으로 함께 남긴다.
    industry_krx = Column(String)
    updated_at = Column(DateTime, default=datetime.utcnow)


class IndexMember(Base):
    """지수 편입 여부. 지수마다 한 행씩 — 한 종목이 여러 지수에 들어갈 수 있다."""
    __tablename__ = "index_members"

    id = Column(Integer, primary_key=True, index=True)
    universe = Column(String, index=True, nullable=False)  # sp500 / nasdaq100
    ticker = Column(String, index=True, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("universe", "ticker", name="uq_universe_ticker"),)


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
