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


class InvestorFlow(Base):
    """종목별·일자별 투자자 매매동향. 한국 종목에만 존재한다.

    미국 시장은 이 데이터를 공개하지 않는다. 반면 한국은 외국인·기관·개인은 물론
    기관 안에서 연기금·투신·사모까지 나뉘어 나온다 — questions.md의 수급 프롬프트
    상당수가 이 구분을 전제로 쓰여 있다.

    KIS API는 한 번에 30거래일만 주므로, 종료일을 옮겨가며 받아 여기에 쌓는다.
    ntby(순매수)만으로는 "순매수는 작지만 양방향 거래가 컸다"를 구분할 수 없어
    매수·매도도 함께 담는다. 금액 단위는 API가 주는 그대로 백만원이다.
    """
    __tablename__ = "investor_flows"

    id = Column(Integer, primary_key=True, index=True)
    ticker = Column(String, index=True, nullable=False)
    date = Column(Date, nullable=False)

    close = Column(Float)
    volume = Column(Integer)

    # 3대 주체 — 순매수 수량/금액, 매수 수량, 매도 수량
    prsn_ntby_qty = Column(Integer)      # 개인
    prsn_ntby_amt = Column(Float)
    prsn_buy_qty = Column(Integer)
    prsn_sell_qty = Column(Integer)

    frgn_ntby_qty = Column(Integer)      # 외국인
    frgn_ntby_amt = Column(Float)
    frgn_buy_qty = Column(Integer)
    frgn_sell_qty = Column(Integer)

    orgn_ntby_qty = Column(Integer)      # 기관 합계
    orgn_ntby_amt = Column(Float)
    orgn_buy_qty = Column(Integer)
    orgn_sell_qty = Column(Integer)

    # 기관 세부 순매수 수량. "어느 주체가 샀나"를 묻는 프롬프트가 이걸 요구한다.
    fund_ntby_qty = Column(Integer)      # 연기금
    ivtr_ntby_qty = Column(Integer)      # 투신
    pe_fund_ntby_qty = Column(Integer)   # 사모
    scrt_ntby_qty = Column(Integer)      # 증권(금융투자)
    bank_ntby_qty = Column(Integer)      # 은행
    insu_ntby_qty = Column(Integer)      # 보험
    etc_corp_ntby_qty = Column(Integer)  # 기타법인

    __table_args__ = (UniqueConstraint("ticker", "date", name="uq_flow_ticker_date"),)


class Fundamental(Base):
    """분기 재무. yfinance가 최근 5개 분기를 준다.

    매출만 보면 "매출은 느는데 이익이 줄어드는" 구간을 놓친다. 그래서 마진을 낼 수 있는
    항목을 함께 담는다 — 매출총이익, 영업이익, 재고, 영업활동현금흐름. questions.md
    6장이 요구하는 "이익의 질"이 이 조합에서 나온다.

    통화는 종목의 상장 시장을 따른다. 삼성전자는 원, 애플은 달러다. 절대액을 시장 간에
    비교하면 안 되고 증가율·비율로만 봐야 한다.
    """
    __tablename__ = "fundamentals"

    id = Column(Integer, primary_key=True, index=True)
    ticker = Column(String, index=True, nullable=False)
    period_end = Column(Date, nullable=False)

    revenue = Column(Float)
    gross_profit = Column(Float)
    operating_income = Column(Float)
    net_income = Column(Float)

    inventory = Column(Float)
    receivables = Column(Float)
    total_assets = Column(Float)
    total_debt = Column(Float)
    equity = Column(Float)

    operating_cashflow = Column(Float)
    free_cashflow = Column(Float)

    # 한국 종목은 KIS가 ROE·EPS·BPS를 직접 준다. 계산하지 않고 그대로 담는다.
    roe = Column(Float)
    eps = Column(Float)
    bps = Column(Float)

    # 어디서 왔고 어떤 단위인지. yfinance는 원·달러 단위로 주고 KIS는 억원 단위라,
    # 표시하지 않으면 같은 컬럼의 값이 1억 배 어긋난 채 섞인다.
    source = Column(String, default="yfinance")   # yfinance / kis
    unit_scale = Column(Float, default=1.0)       # 저장값 × 이 값 = 실제 금액
    period_type = Column(String, default="quarterly")  # quarterly / annual

    updated_at = Column(DateTime, default=datetime.utcnow)

    # 같은 분기라도 분기·연간 보고가 따로 있어 period_type까지 키에 넣는다.
    __table_args__ = (
        UniqueConstraint("ticker", "period_end", "period_type", name="uq_fund_ticker_period"),
    )


class Snapshot(Base):
    """하루 한 장씩 찍어 두는 현재 값.

    시세와 달리 이 값들은 **과거를 받아올 수 없다.** yfinance도 증권사 API도 목표주가와
    시가총액은 "오늘 얼마"만 알려 주고 어제 얼마였는지는 알려 주지 않는다. 그래서
    questions.md가 반복해 묻는 "목표가가 상향됐나", "추정치가 올라갔나"는 오늘부터
    찍어 두지 않으면 영원히 답할 수 없다.

    쌓기 시작한 날부터 시계열이 생긴다. 늦을수록 손해라 다른 수집보다 우선한다.
    """
    __tablename__ = "snapshots"

    id = Column(Integer, primary_key=True, index=True)
    ticker = Column(String, index=True, nullable=False)
    date = Column(Date, nullable=False)

    close = Column(Float)
    market_cap = Column(Float)
    per = Column(Float)
    pbr = Column(Float)

    target_mean = Column(Float)      # 증권사 목표주가 평균
    target_high = Column(Float)
    target_low = Column(Float)
    analyst_count = Column(Integer)
    recommendation = Column(String)  # buy / hold / …

    __table_args__ = (UniqueConstraint("ticker", "date", name="uq_snapshot_ticker_date"),)


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
