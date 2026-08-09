# BacktestLab - 주식 백테스팅 웹 애플리케이션

## 1. 프로젝트 개요

미국 주식 시장을 대상으로 트레이딩 전략을 백테스팅하고 성과를 분석하는 웹 애플리케이션입니다.
사용자 정의 전략 파라미터로 과거 데이터 시뮬레이션을 수행하고, 차트 및 지표를 통해 결과를 시각화합니다.
거치식(lump-sum)과 적립식(DCA) 투자 모드를 지원하며, 시가총액 기반 스크리너로 유망 종목을 선별할 수 있습니다.

### 기술 스택

| 구분 | 기술 | 버전 |
|------|------|------|
| **Backend** | Python + FastAPI | 3.12 / 0.115.0 |
| **Frontend** | React + TypeScript + Vite | 19.x / 5.9 / 8.x |
| **Database** | SQLite (SQLAlchemy ORM) | 2.0.35 |
| **데이터 소스** | yfinance (Yahoo Finance) | >= 1.2.0 |
| **차트** | Recharts + lightweight-charts | 3.x / 4.2.1 |
| **HTTP Client** | Axios | 1.x |
| **라우팅** | React Router DOM | 7.x |

> 관련 문서: 사용자용 개요는 `README.md`, AI 에이전트 작업 규칙은 `CLAUDE.md` 참고.

---

## 2. 디렉토리 구조

```
invest_backtest/
├── start.sh                          # 백엔드/프론트엔드 동시 실행 스크립트
├── README.md                         # 사용자용 개요 (한국어)
├── CLAUDE.md                         # AI 에이전트 작업 가이드
├── ARCHITECTURE.md                   # 본 문서
│
├── backend/
│   ├── main.py                       # FastAPI 앱 진입점, CORS, 라우터 등록, 로깅
│   ├── database.py                   # SQLAlchemy 엔진, 세션, Base 설정
│   ├── models.py                     # ORM 모델 (Stock, Backtest, Trade)
│   ├── schemas.py                    # Pydantic 요청/응답 스키마
│   ├── requirements.txt              # Python 의존성
│   ├── backtest.db                   # SQLite 데이터베이스 파일 (gitignored)
│   │
│   ├── routers/
│   │   ├── stocks.py                 # /api/stocks 엔드포인트
│   │   ├── strategies.py             # /api/strategies 엔드포인트
│   │   ├── backtests.py              # /api/backtests 엔드포인트
│   │   └── screening.py              # /api/screening 엔드포인트
│   │
│   ├── services/
│   │   ├── data_fetcher.py           # yfinance 데이터 다운로드 및 DB 캐싱
│   │   ├── backtest_engine.py        # 백테스트 시뮬레이션 엔진 (거치식/적립식)
│   │   ├── screener.py               # 시총 → 전략 2단계 스크리너
│   │   └── strategies/
│   │       ├── __init__.py           # 전략 레지스트리 (팩토리 패턴)
│   │       ├── base.py               # 추상 Strategy 베이스 클래스 + Signal
│   │       └── *.py                  # 전략 15종 (아래 6절 참고)
│   │
│   └── utils/
│       └── metrics.py                # 성과 지표 계산 (수익률, CAGR, Sharpe, MDD, 승률)
│
└── frontend/
    ├── package.json
    ├── vite.config.ts
    ├── index.html
    └── src/
        ├── main.tsx                  # React 진입점
        ├── App.tsx                   # 루트 컴포넌트 + 라우팅 + 네비게이션
        ├── index.css                 # 글로벌 스타일 (다크 테마)
        │
        ├── api/
        │   └── client.ts             # Axios API 클라이언트
        │
        ├── types/
        │   └── index.ts              # TypeScript 인터페이스
        │
        ├── pages/
        │   ├── Dashboard.tsx          # 백테스트 이력 목록/관리
        │   ├── DataManager.tsx        # 주식 데이터 가져오기/관리
        │   ├── BacktestRun.tsx        # 백테스트 설정 및 실행
        │   ├── BacktestResult.tsx     # 결과 상세 보기
        │   ├── Strategies.tsx         # 전략 탐색기
        │   └── Screener.tsx           # 종목 스크리너
        │
        └── components/
            ├── StrategyForm.tsx       # 전략 설정 폼 (동적 파라미터)
            ├── MetricsPanel.tsx       # 성과 지표 카드
            ├── EquityCurve.tsx        # 자산 곡선 차트 (Recharts)
            ├── CandlestickChart.tsx   # 캔들차트 + 지표 오버레이 (lightweight-charts)
            ├── TradeLog.tsx           # 거래 내역 테이블
            └── ErrorBoundary.tsx      # 렌더링 에러 격리
```

---

## 3. 시스템 아키텍처

### 전체 데이터 흐름

```
┌──────────────┐     HTTP/JSON      ┌──────────────────┐     SQLAlchemy    ┌──────────┐
│   Frontend   │ ◄────────────────► │   FastAPI Server  │ ◄──────────────► │  SQLite   │
│  (React)     │   localhost:5173   │   localhost:8000  │                  │  backtest │
│              │                    │                   │                  │   .db     │
└──────────────┘                    └────────┬──────────┘                  └──────────┘
                                             │
                                             │ yfinance
                                             ▼
                                    ┌──────────────────┐
                                    │  Yahoo Finance    │
                                    │  (External API)   │
                                    └──────────────────┘
```

### 백테스트 실행 흐름

```
사용자 요청 (POST /api/backtests/run)
    │
    ▼
┌─ 검증 ──── 전략 존재/파라미터 범위/날짜/투자 모드/자본금 유효성
    │
    ▼
┌─ get_cached_data() ──── DB에서 OHLCV 로드 ──── pandas DataFrame
    │   └── 캐시 없거나 시작일이 7일 이상 늦으면 fetch_and_cache()로 자동 다운로드
    │
    ▼
┌─ Strategy.generate_signals() ──── BUY/SELL/HOLD 시그널 생성
┌─ Strategy.compute_indicators() ── 차트 오버레이용 지표 계산
    │
    ▼
┌─ backtest_engine.run_backtest()
    │   ├── 투자 모드 분기 (lump_sum / dca)
    │   ├── 포트폴리오 시뮬레이션 (현금, 보유주식 추적)
    │   ├── DCA: 매월 정액 납입 + 보유 중이면 자동 추가 매수
    │   ├── 일별 자산 곡선 계산
    │   └── 거래 내역 기록
    │
    ▼
┌─ metrics 계산 (total_return, cagr, sharpe, mdd, win_rate)
    │
    ▼
┌─ DB 저장 (Backtest + Trade 레코드)
    │
    ▼
JSON 응답 → 프론트엔드 결과 페이지
```

---

## 4. 데이터베이스 설계

### ERD

```
┌───────────────┐       ┌────────────────────────┐       ┌───────────────┐
│    stocks     │       │       backtests        │       │    trades     │
├───────────────┤       ├────────────────────────┤       ├───────────────┤
│ id        PK  │       │ id                PK   │──┐    │ id        PK  │
│ ticker (idx)  │       │ ticker                 │  │    │ backtest_id FK│──┐
│ date          │       │ strategy_name          │  │    │ date          │  │
│ open          │       │ params           JSON  │  │    │ action        │  │
│ high          │       │ start_date             │  └───►│ price         │  │
│ low           │       │ end_date               │       │ shares        │  │
│ close         │       │ invest_mode            │       │ pnl           │  │
│ volume        │       │ initial_capital        │       └───────────────┘  │
└───────────────┘       │ monthly_contribution   │              ▲           │
 UQ(ticker,date)        │ total_invested         │              │           │
                        │ total_return           │              └───────────┘
                        │ cagr                   │           1:N (cascade delete)
                        │ sharpe_ratio           │
                        │ max_drawdown           │
                        │ win_rate               │
                        │ equity_curve     JSON  │
                        │ created_at             │
                        └────────────────────────┘
```

### 테이블 상세

**stocks** — OHLCV 캐시 데이터

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | INTEGER PK | 자동 증가 |
| ticker | VARCHAR (indexed) | 종목 심볼 (예: AAPL, 대문자 정규화) |
| date | DATE | 거래일 |
| open / high / low / close | FLOAT | 시/고/저/종가 |
| volume | INTEGER | 거래량 |

> UNIQUE 제약: `(ticker, date)` — 종목별 일자당 1건

**backtests** — 백테스트 실행 결과

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | INTEGER PK | 자동 증가 |
| ticker | VARCHAR | 테스트 종목 |
| strategy_name | VARCHAR | 전략 식별자 (예: ma_crossover) |
| params | JSON | 전략 파라미터 (예: `{"fast_period": 10, "slow_period": 50}`) |
| start_date / end_date | DATE | 백테스트 기간 |
| invest_mode | VARCHAR | `lump_sum` 또는 `dca` (기본 lump_sum) |
| initial_capital | FLOAT | 초기 자본금 (거치식) |
| monthly_contribution | FLOAT | 월 납입액 (적립식, 기본 0) |
| total_invested | FLOAT | 총 투입 원금 (수익률 분모) |
| total_return | FLOAT | 총 수익률 (%) |
| cagr | FLOAT | 연평균 복리 성장률 (%) |
| sharpe_ratio | FLOAT | 샤프 비율 |
| max_drawdown | FLOAT | 최대 낙폭 (%) |
| win_rate | FLOAT | 승률 (%) |
| equity_curve | JSON | 일별 자산 가치 `[{date, equity}]` |
| created_at | DATETIME | 생성 시간 (UTC) |

**trades** — 개별 거래 내역

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | INTEGER PK | 자동 증가 |
| backtest_id | INTEGER FK | backtests.id 참조 (cascade delete) |
| date | DATE | 거래 실행일 |
| action | VARCHAR | "BUY" 또는 "SELL" |
| price | FLOAT | 체결 가격 |
| shares | INTEGER | 거래 수량 |
| pnl | FLOAT | 실현 손익 (SELL 시) |

> 스키마는 `Base.metadata.create_all`로 앱 시작 시 생성됩니다. 마이그레이션 도구가 없으므로
> 기존 모델에 컬럼을 추가/변경하면 로컬 `backtest.db`를 삭제하거나 수동 마이그레이션이 필요합니다.

---

## 5. API 설계

### Base URL: `http://localhost:8000/api`

### 주식 데이터 (`/api/stocks`)

| Method | Path | 설명 | Request Body | Response |
|--------|------|------|-------------|----------|
| `POST` | `/stocks/fetch` | yfinance에서 데이터 다운로드 및 캐싱 | `{ticker, start_date, end_date}` | `StockData[]` |
| `GET` | `/stocks/{ticker}` | 캐시된 OHLCV 조회 | — | `StockData[]` |
| `GET` | `/stocks/` | 캐시된 종목 목록 및 기간 | — | `TickerInfo[]` |

### 전략 (`/api/strategies`)

| Method | Path | 설명 | Response |
|--------|------|------|----------|
| `GET` | `/strategies/` | 사용 가능한 전략 목록 및 파라미터 스키마 | `StrategyInfo[]` |

### 백테스트 (`/api/backtests`)

| Method | Path | 설명 | Request Body | Response |
|--------|------|------|-------------|----------|
| `POST` | `/backtests/run` | 백테스트 실행 + DB 저장 (캐시 없으면 자동 다운로드) | `BacktestRequest` | `BacktestResult` |
| `GET` | `/backtests/` | 최근 50개 백테스트 목록 | — | `BacktestSummary[]` |
| `GET` | `/backtests/{id}` | 백테스트 상세 결과 (지표 재계산) | — | `BacktestResult` |
| `DELETE` | `/backtests/{id}` | 백테스트 삭제 (거래 내역 cascade) | — | `{message}` |

### 스크리닝 (`/api/screening`)

| Method | Path | 설명 | Request Body | Response |
|--------|------|------|-------------|----------|
| `GET` | `/screening/pool` | 기본 종목 풀 (대형주 50종) 반환 | — | `{pool, count}` |
| `POST` | `/screening/market-cap` | 1단계: 시총 상위 N 종목 | `{pool?, top_n}` | `MarketCapResult[]` |
| `POST` | `/screening/full` | 2단계: 시총 필터 → 전 전략 백테스트 → 상위 추천 | `FullScreenRequest` | `FullScreenResponse` |

### 데이터 스키마

```typescript
// 요청
interface BacktestRequest {
  ticker: string;              // "AAPL"
  strategy_name: string;       // "ma_crossover"
  params: Record<string, number>;  // {"fast_period": 10, "slow_period": 50}
  start_date: string;          // "2022-01-01"
  end_date: string;            // "2024-12-31"
  invest_mode: "lump_sum" | "dca";
  initial_capital: number;     // 100000 (lump_sum)
  monthly_contribution: number;// 1000   (dca)
}

// 응답
interface BacktestResult {
  id: number;
  ticker: string;
  strategy_name: string;
  params: Record<string, number>;
  start_date: string;
  end_date: string;
  invest_mode: "lump_sum" | "dca";
  initial_capital: number;
  monthly_contribution: number;
  total_invested: number;      // 총 투입 원금
  total_return: number;        // 39.51 (%)
  cagr: number;                // 11.72 (%)
  sharpe_ratio: number;        // 0.6511
  max_drawdown: number;        // 15.14 (%)
  win_rate: number;            // 30.0 (%)
  equity_curve: {date: string, equity: number}[];
  trades: {date: string, action: string, price: number, shares: number, pnl: number}[];
  indicators: Record<string, {date: string, value: number}[]> | null;
  created_at: string | null;
}
```

> 타입 안전성은 백엔드 Pydantic(`schemas.py`)과 프론트엔드 TypeScript(`types/index.ts`)의
> 이중 스키마로 API 경계에서 보장됩니다. API 형태를 바꾸면 양쪽을 함께 수정해야 합니다.

---

## 6. 전략 시스템

### 아키텍처 (Strategy Pattern + Registry)

```
                  ┌──────────────┐
                  │  Strategy    │  (추상 클래스, base.py)
                  ├──────────────┤
                  │ name         │
                  │ display_name │
                  │ description  │
                  │ param_schema │
                  ├──────────────┤
                  │ generate_    │ ◄── abstract
                  │  signals()   │
                  │ compute_     │
                  │  indicators()│
                  └──────┬───────┘
                         │  (15개 구현체가 상속)
                         ▼
              ┌─────────────────────┐
              │  STRATEGY_REGISTRY  │  (dict, __init__.py)
              ├─────────────────────┤
              │ get_strategy(name)  │  ◄── 팩토리
              │ list_strategies()   │
              └─────────────────────┘
```

### 구현된 전략 (15종)

프론트엔드에서는 카테고리별로 그룹화되어 표시됩니다.

**추세 추종 (Trend)**

| 식별자 | 표시명 | 원리 | 주요 파라미터 (기본값) |
|--------|--------|------|----------------------|
| `buy_and_hold` | Buy & Hold | 첫날 매수 후 종료까지 보유 (벤치마크) | — |
| `golden_cross` | Golden Cross (50/200) | 50/200 골든크로스 매수, 데드크로스 매도 | fast_period(50), slow_period(200) |
| `ma_crossover` | Moving Average Crossover | 단기 MA가 장기 MA 상향 돌파 시 매수 | fast_period(10), slow_period(50) |
| `ema_crossover` | EMA Crossover (Short-term) | EMA 교차, SMA보다 빠른 반응 | fast_period(5), slow_period(20) |
| `adx_trend` | ADX Trend | ADX 강세 + +DI>-DI 매수, 추세 약화 시 매도 | period(14), adx_threshold(25) |

**모멘텀 (Momentum)**

| 식별자 | 표시명 | 원리 | 주요 파라미터 (기본값) |
|--------|--------|------|----------------------|
| `macd` | MACD | MACD선이 시그널선 상향 돌파 시 매수 | fast(12), slow(26), signal(9) |
| `dual_ma_rsi` | Dual MA + RSI | MA 추세 상승 + RSI 과매도 시 매수 | fast(20), slow(50), rsi_period(14), rsi_buy(40), rsi_sell(60) |
| `momentum_roc` | Momentum (ROC) | ROC가 임계값 초과 시 매수, 음수 임계값 하회 시 매도 | period(10), buy_threshold(3.0), sell_threshold(-3.0) |
| `stochastic` | Stochastic Oscillator | 과매도 구간에서 %K가 %D 상향 돌파 시 매수 | k_period(14), d_period(3), oversold(20), overbought(80) |

**평균 회귀 (Mean Reversion)**

| 식별자 | 표시명 | 원리 | 주요 파라미터 (기본값) |
|--------|--------|------|----------------------|
| `rsi` | RSI Overbought/Oversold | RSI 과매도 하회 시 매수, 과매수 상회 시 매도 | period(14), oversold(30), overbought(70) |
| `bollinger` | Bollinger Bands | 하단 밴드 터치 시 매수, 상단 터치 시 매도 | period(20), std_dev(2.0) |
| `vwap` | VWAP Reversion | 가격이 VWAP 대비 N% 하락 시 매수 | period(20), buy_threshold(-2.0), sell_threshold(2.0) |
| `keltner` | Keltner Channel | 상단 채널 돌파 매수, 하단 이탈 매도 | ema_period(20), atr_period(10), atr_mult(2.0) |

**돌파 (Breakout)**

| 식별자 | 표시명 | 원리 | 주요 파라미터 (기본값) |
|--------|--------|------|----------------------|
| `breakout` | Breakout (Donchian) | N일 최고가 돌파 매수, M일 최저가 이탈 매도 | entry_period(20), exit_period(10) |
| `parabolic_sar` | Parabolic SAR | SAR이 가격 아래로 전환(상승) 시 매수 | af_start(0.02), af_max(0.2) |

> 모든 파라미터는 `param_schema`에 `{name, type, default, min, max, description}`로 정의되며,
> 백엔드는 실행 전 min/max 범위를 검증하고, 프론트엔드는 이 스키마로 입력 폼을 동적 생성합니다.

### 새 전략 추가 방법

1. `backend/services/strategies/` 에 새 파일 생성
2. `Strategy` 클래스를 상속하여 `generate_signals()` 구현 (필요 시 `compute_indicators()`)
3. `__init__.py`에서 import 후 `STRATEGY_REGISTRY`에 인스턴스 등록

```python
from .base import Strategy, Signal

class MACDStrategy(Strategy):
    name = "macd"
    display_name = "MACD"
    description = "MACD 시그널 라인 교차 전략"
    param_schema = [
        {"name": "fast_period", "type": "int", "default": 12, "min": 5, "max": 50, "description": "Fast EMA"},
        {"name": "slow_period", "type": "int", "default": 26, "min": 10, "max": 100, "description": "Slow EMA"},
        {"name": "signal_period", "type": "int", "default": 9, "min": 3, "max": 30, "description": "Signal line"},
    ]

    def generate_signals(self, df, params):
        ...  # BUY/SELL/HOLD Signal 리스트 반환
```

> 프론트엔드 수정 없이 `GET /api/strategies/`에서 자동으로 노출됩니다.

---

## 7. 스크리너 (2단계)

`services/screener.py`는 대형주 50종의 기본 풀(`DEFAULT_POOL`)을 대상으로 유망 종목을 선별합니다.

```
1단계 (screen_by_market_cap)
    yfinance fast_info로 시가총액 조회 → 내림차순 정렬 → 상위 N종목

2단계 (screen_by_strategy)
    각 종목에 대해 15개 전략 전부를 기본 파라미터로 백테스트
    (데이터 캐시 없으면 자동 다운로드, 최소 60봉 이상만 대상)
    → total_return 내림차순 정렬 → 종목 중복 제거하여 상위 M종목 추천
```

- `POST /screening/full`이 두 단계를 한 번에 수행하고
  `{market_cap_top, all_results, top_picks}`를 반환합니다.
- 프론트엔드 `Screener.tsx`에서 결과를 표로 시각화합니다.

---

## 8. 백테스트 엔진 & 투자 모드

`services/backtest_engine.py`의 `run_backtest()`가 단일 루프로 두 모드를 처리합니다.

| 모드 | 동작 |
|------|------|
| **lump_sum (거치식)** | 초기 자본금으로 시작, 추가 납입 없음. `total_invested = initial_capital` |
| **dca (적립식)** | 매월 `monthly_contribution` 납입. 보유 중이면 새 납입금으로 자동 추가 매수(평단가 갱신). `total_invested`는 누적 납입액 |

- 시그널이 `BUY`이고 미보유면 가용 현금으로 정수 주식 최대 매수, `SELL`이고 보유 중이면 전량 매도.
- 매 거래일 `equity = cash + shares × close`를 자산 곡선에 기록.
- 수익률/CAGR 분모는 `total_invested`(적립식에서는 누적 원금)를 사용.

---

## 9. 프론트엔드 설계

### 페이지 구조

```
App.tsx (BrowserRouter + ErrorBoundary)
├── NavBar: [Dashboard] [Data] [Backtest] [Strategy] [Screener]
│
├── /              → Dashboard.tsx       백테스트 이력 목록/삭제
├── /data          → DataManager.tsx     주식 데이터 가져오기/캐시 관리
├── /backtest      → BacktestRun.tsx     백테스트 설정 및 실행
├── /results/:id   → BacktestResult.tsx  결과 상세 보기
├── /strategies    → Strategies.tsx      전략 탐색기 (카테고리/파라미터)
└── /screener      → Screener.tsx        시총/전략 스크리너
```

### 컴포넌트 구성

```
BacktestResult.tsx
├── MetricsPanel         총 수익률 / CAGR / 최종 자산 / 샤프 비율 / MDD / 승률
├── EquityCurve          자산 곡선 라인 차트 (Recharts)
├── CandlestickChart     캔들 차트 + 지표 오버레이 + 매매 마커 (lightweight-charts v4)
└── TradeLog             거래 내역 테이블

BacktestRun.tsx
└── StrategyForm         종목 / 전략 / 파라미터 / 투자 모드 / 기간 / 자본금 입력 폼
```

### UI 테마

- **배경**: `#0f172a` (Slate 900)
- **카드/네비**: `#1e1e2e`
- **텍스트**: `#e2e8f0`, **보조 텍스트**: `#94a3b8`
- **액센트**: `#3b82f6` (Blue 500), **활성 배경**: `#334155`
- **수익**: `#22c55e` (Green), **손실**: `#ef4444` (Red)

---

## 10. 성과 지표 계산

`utils/metrics.py` 기준.

| 지표 | 수식 | 설명 |
|------|------|------|
| **Total Return** | `(최종 자산 - 총 투입원금) / 총 투입원금 × 100` | 총 수익률 (%) |
| **CAGR** | `(최종/원금)^(1/년수) - 1) × 100`, 년수 = days/365.25 | 연평균 복리 성장률 (%) |
| **Sharpe Ratio** | `mean(초과 일수익률) / std(일수익률) × √252` | 위험 대비 수익 (연환산, 무위험이자율 2%) |
| **Max Drawdown** | `max((고점 - 현재) / 고점 × 100)` | 최대 낙폭 (%) |
| **Win Rate** | `수익 SELL 거래 수 / 총 SELL 거래 수 × 100` | 승률 (%) |

---

## 11. 실행 방법

### 사전 요구사항
- Python 3.12+
- Node.js 20+

### 한 번에 실행
```bash
./start.sh   # :8000/:5173 정리 후 백엔드+프론트엔드 동시 실행
```

### 백엔드 (수동)
```bash
cd backend
python -m venv venv
source venv/bin/activate            # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### 프론트엔드 (수동)
```bash
cd frontend
npm install
npm run dev
```

### 접속
- 프론트엔드: http://localhost:5173
- API 문서: http://localhost:8000/docs (Swagger UI)

### 사용 순서
1. **Data** 탭 → 종목 입력 (예: `AAPL`) → **Fetch Data**
2. **Backtest** 탭 → 전략/파라미터/투자 모드/기간/자본금 설정 → **Run Backtest**
3. 결과 페이지에서 성과 분석 (이력은 Dashboard에 저장)
4. (선택) **Screener** 탭에서 시총 상위 종목을 전략별로 자동 백테스트

> 테스트 스위트는 없습니다. 변경 사항은 앱을 실제로 실행해 흐름을 확인하며 검증합니다.

---

## 12. 설계 결정 및 근거

| 결정 | 근거 |
|------|------|
| OHLCV를 SQLite에 캐싱 | yfinance 속도 제한 회피, 백테스트 실행 속도 향상, 재현성 보장 |
| equity_curve를 JSON 컬럼으로 저장 | 별도 테이블보다 단순, 개인 연구 도구에 적합 |
| 지표는 저장하지 않고 조회 시 재계산 | DB 용량 절감, 전략 로직 변경 시 항상 최신 값 |
| 자체 백테스트 엔진 (backtrader 미사용) | 100줄 남짓의 단순한 코드, 디버깅/확장 용이, DCA 등 커스텀 로직 반영 쉬움 |
| lightweight-charts v4 사용 | v5는 API 호환성 문제, v4가 안정적 |
| 전략 레지스트리 패턴 | 새 전략 추가 시 프론트엔드 수정 불필요 |
| Pydantic + TypeScript 이중 스키마 | API 경계에서 양방향 타입 안전성 보장 |
| 백테스트 실행 시 데이터 자동 페치 | 캐시 미스/불완전 범위를 투명하게 보완, UX 단순화 |
| CORS를 :5173로 고정 | 로컬 개발 전용 도구, 최소 노출 |
