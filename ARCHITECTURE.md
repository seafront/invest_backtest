# BacktestLab - 주식 백테스팅 웹 애플리케이션

## 1. 프로젝트 개요

미국 주식 시장을 대상으로 트레이딩 전략을 백테스팅하고 성과를 분석하는 웹 애플리케이션입니다.
사용자 정의 전략 파라미터로 과거 데이터 시뮬레이션을 수행하고, 차트 및 지표를 통해 결과를 시각화합니다.

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

---

## 2. 디렉토리 구조

```
stock_back_Tracking/
├── backend/
│   ├── main.py                       # FastAPI 앱 진입점, CORS, 라우터 등록
│   ├── database.py                   # SQLAlchemy 엔진, 세션, Base 설정
│   ├── models.py                     # ORM 모델 (Stock, Backtest, Trade)
│   ├── schemas.py                    # Pydantic 요청/응답 스키마
│   ├── requirements.txt              # Python 의존성
│   ├── backtest.db                   # SQLite 데이터베이스 파일
│   │
│   ├── routers/
│   │   ├── stocks.py                 # /api/stocks 엔드포인트
│   │   ├── strategies.py             # /api/strategies 엔드포인트
│   │   └── backtests.py              # /api/backtests 엔드포인트
│   │
│   ├── services/
│   │   ├── data_fetcher.py           # yfinance 데이터 다운로드 및 DB 캐싱
│   │   ├── backtest_engine.py        # 백테스트 시뮬레이션 엔진
│   │   └── strategies/
│   │       ├── __init__.py           # 전략 레지스트리 (팩토리 패턴)
│   │       ├── base.py               # 추상 Strategy 베이스 클래스
│   │       ├── ma_crossover.py       # 이동평균 교차 전략
│   │       ├── rsi.py                # RSI 과매수/과매도 전략
│   │       └── bollinger.py          # 볼린저 밴드 전략
│   │
│   └── utils/
│       └── metrics.py                # 성과 지표 계산 (수익률, Sharpe, MDD 등)
│
└── frontend/
    ├── package.json
    ├── vite.config.ts
    ├── index.html
    └── src/
        ├── main.tsx                  # React 진입점
        ├── App.tsx                   # 루트 컴포넌트 + 라우팅
        ├── index.css                 # 글로벌 스타일 (다크 테마)
        │
        ├── api/
        │   └── client.ts             # Axios API 클라이언트
        │
        ├── types/
        │   └── index.ts              # TypeScript 인터페이스
        │
        ├─��� pages/
        │   ├── Dashboard.tsx          # 백테스트 이력 목록
        │   ├── DataManager.tsx        # 주식 데이터 가져오기/관리
        │   ├── BacktestRun.tsx        # 백테스트 설정 및 실행
        │   └── BacktestResult.tsx     # 결과 상세 보기
        │
        └── components/
            ├── StrategyForm.tsx       # 전략 설정 폼 (동적 파라미터)
            ├── MetricsPanel.tsx       # 성과 지표 카드
            ├── EquityCurve.tsx        # 자산 곡선 차트 (Recharts)
            ├── CandlestickChart.tsx   # 캔들차트 + 지표 오버레이 (lightweight-charts)
            └── TradeLog.tsx           # 거래 내역 테이블
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
┌─ get_cached_data() ──── DB에서 OHLCV 로드 ──── pandas DataFrame
    │
    ▼
┌─ Strategy.generate_signals() ──── BUY/SELL/HOLD 시그널 생성
    │
    ▼
┌─ backtest_engine.run_backtest()
    │   ├── 포트폴리오 시뮬레이션 (현금, 보유주식 추적)
    │   ├── 일별 자산 곡선 계산
    │   └── 거래 내역 기록
    │
    ▼
┌─ metrics 계산
    │   ├── total_return (총 수익률 %)
    │   ├── sharpe_ratio (연환산 샤프 비율)
    │   ├── max_drawdown (최대 낙폭 %)
    │   └── win_rate (승률 %)
    │
    ▼
┌─ DB 저장 (Backtest + Trade 레코드)
    │
    ���
JSON 응답 → 프론트엔드 결과 페이지
```

---

## 4. 데이터베이스 설계

### ERD

```
┌───────────────┐       ┌────────────────────┐       ┌───────────────┐
│    stocks     │       │     backtests      │       │    trades     │
├───────────────┤       ├────────────────────┤       ├───────────────┤
│ id        PK  │       │ id            PK   │──┐    │ id        PK  │
│ ticker        │       │ ticker             │  │    │ backtest_id FK│──┐
│ date          │       │ strategy_name      │  │    │ date          │  │
│ open          │       ��� params       JSON  │  │    │ action        │  │
│ high          │       ��� start_date         │  └───►│ price         │  │
│ low           │       │ end_date           │       │ shares        │  │
│ close         │       │ initial_capital    │       │ pnl           │  │
│ volume        │       │ total_return       │       └───────────────┘  │
└───────────────┘       │ sharpe_ratio       │              ▲           │
 UQ(ticker,date)        │ max_drawdown       │              │           │
                        │ win_rate           │              └───────────┘
                        │ equity_curve JSON  │           1:N (cascade delete)
                        │ created_at         │
                        └────────────────────┘
```

### 테이블 상세

**stocks** — OHLCV 캐시 데이터

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | INTEGER PK | 자동 증가 |
| ticker | VARCHAR (indexed) | 종목 심볼 (예: AAPL) |
| date | DATE | 거래일 |
| open | FLOAT | 시가 |
| high | FLOAT | 고가 |
| low | FLOAT | 저가 |
| close | FLOAT | 종가 |
| volume | INTEGER | 거래량 |

> UNIQUE 제약: `(ticker, date)` — 종목별 일자당 1건

**backtests** — 백테스트 실행 결과

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | INTEGER PK | 자동 증가 |
| ticker | VARCHAR | 테스트 종목 |
| strategy_name | VARCHAR | 전략 식별자 (예: ma_crossover) |
| params | JSON | 전략 파라미터 (예: `{"fast_period": 10, "slow_period": 50}`) |
| start_date | DATE | 백테스트 시작일 |
| end_date | DATE | 백테스트 종료일 |
| initial_capital | FLOAT | 초기 자본금 |
| total_return | FLOAT | 총 수익률 (%) |
| sharpe_ratio | FLOAT | 샤프 비율 |
| max_drawdown | FLOAT | 최대 낙폭 (%) |
| win_rate | FLOAT | 승률 (%) |
| equity_curve | JSON | 일별 자산 가치 `[{date, equity}]` |
| created_at | DATETIME | 생성 시간 |

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

---

## 5. API 설계

### Base URL: `http://localhost:8000/api`

### 주식 데이터 (`/api/stocks`)

| Method | Path | 설명 | Request Body | Response |
|--------|------|------|-------------|----------|
| `POST` | `/stocks/fetch` | yfinance에서 데이터 다운로드 및 캐싱 | `{ticker, start_date, end_date}` | `StockData[]` |
| `GET` | `/stocks/{ticker}` | 캐시된 OHLCV 조회 | — | `StockData[]` |
| `GET` | `/stocks/` | 캐시된 종목 목록 | — | `TickerInfo[]` |

### 전략 (`/api/strategies`)

| Method | Path | 설명 | Response |
|--------|------|------|----------|
| `GET` | `/strategies/` | 사용 가능한 전략 목록 및 파라미터 스키마 | `StrategyInfo[]` |

### 백테스트 (`/api/backtests`)

| Method | Path | 설명 | Request Body | Response |
|--------|------|------|-------------|----------|
| `POST` | `/backtests/run` | 백테스트 실행 + DB 저장 | `BacktestRequest` | `BacktestResult` |
| `GET` | `/backtests/` | 최근 50개 백테스트 목록 | — | `BacktestSummary[]` |
| `GET` | `/backtests/{id}` | 백테스트 상세 결과 | — | `BacktestResult` |
| `DELETE` | `/backtests/{id}` | 백테스트 삭제 (거래 내역 포함) | — | `{message}` |

### 데이터 스키마

```typescript
// 요청
interface BacktestRequest {
  ticker: string;           // "AAPL"
  strategy_name: string;    // "ma_crossover"
  params: Record<string, number>;  // {"fast_period": 10, "slow_period": 50}
  start_date: string;       // "2022-01-01"
  end_date: string;         // "2024-12-31"
  initial_capital: number;  // 100000
}

// 응답
interface BacktestResult {
  id: number;
  ticker: string;
  strategy_name: string;
  params: Record<string, number>;
  start_date: string;
  end_date: string;
  initial_capital: number;
  total_return: number;     // 39.51 (%)
  sharpe_ratio: number;     // 0.6511
  max_drawdown: number;     // 15.14 (%)
  win_rate: number;         // 30.0 (%)
  equity_curve: {date: string, equity: number}[];
  trades: {date: string, action: string, price: number, shares: number, pnl: number}[];
  indicators: Record<string, {date: string, value: number}[]> | null;
}
```

---

## 6. 전략 시스템

### 아키텍처 (Strategy Pattern + Registry)

```
                  ┌──────────────┐
                  │  Strategy    │  (추상 클래스)
                  │  (base.py)   │
                  ├──────────────┤
                  │ name         │
                  │ display_name │
                  │ param_schema │
                  ├──────────────┤
                  │ generate_    │
                  │  signals()   │ ◄── abstract
                  │ compute_     │
                  │  indicators()│
                  └──────┬───────┘
           ┌─────────────┼─────────────┐
           ▼             ▼             ▼
    ┌─────────────┐ ┌──────────┐ ┌──────────────┐
    │ MACrossover │ │   RSI    │ │  Bollinger   │
    │             │ │ Strategy │ │   Bands      │
    └─────────────┘ └──────────┘ └───────────���──┘
           │             │             │
           └─────────────┼─────────────┘
                         ▼
              ┌─────────────────────┐
              │  STRATEGY_REGISTRY  │  (dict)
              │  __init__.py        │
              ├─────────────────────┤
              │ get_strategy(name)  │  ◄── 팩토리
              │ list_strategies()   │
              └─────────────────────┘
```

### 구현된 전략

#### 1. Moving Average Crossover (`ma_crossover`)
- **원리**: 단기 이동평균이 장기 이동평균을 상향 돌파 시 매수, 하향 돌파 시 매도
- **파라미터**:
  - `fast_period` (int, 기본값: 10, 범위: 2~200) — 단기 이동평균 기간
  - `slow_period` (int, 기본값: 50, 범위: 5~500) — 장기 이동평균 기간
- **지표 출력**: MA{fast}, MA{slow} 라인

#### 2. RSI Overbought/Oversold (`rsi`)
- **원리**: RSI가 과매도 구간 이하로 내려가면 매수, 과매수 구간 이상으로 올라가면 매도
- **파라미터**:
  - `period` (int, 기본값: 14, 범위: 2~100) — RSI 계산 기간
  - `oversold` (int, 기본값: 30, 범위: 5~50) — 과매도 임계값
  - `overbought` (int, 기본값: 70, 범위: 50~95) — 과매수 임계값
- **지표 출력**: RSI 값

#### 3. Bollinger Bands (`bollinger`)
- **원리**: 가격이 하단 밴드에 닿으면 매수, 상단 밴드에 닿으면 매도 (평균 회귀)
- **파라미터**:
  - `period` (int, 기본값: 20, 범위: 5~100) — 밴드 계산 기간
  - `std_dev` (float, 기본값: 2.0, 범위: 0.5~4.0) — 표준편차 배수
- **지표 출력**: SMA, Upper Band, Lower Band

### 새 전략 추가 방법

1. `backend/services/strategies/` 에 새 파일 생성
2. `Strategy` 클래스를 상속하여 `generate_signals()` 구현
3. `__init__.py`의 `STRATEGY_REGISTRY`에 등록

```python
# 예: MACD 전략 추가
from .base import Strategy, Signal

class MACDStrategy(Strategy):
    name = "macd"
    display_name = "MACD"
    description = "MACD 시그널 라인 교차 전략"
    param_schema = [
        {"name": "fast", "type": "int", "default": 12, "min": 5, "max": 50, "description": "Fast EMA"},
        {"name": "slow", "type": "int", "default": 26, "min": 10, "max": 100, "description": "Slow EMA"},
        {"name": "signal", "type": "int", "default": 9, "min": 3, "max": 30, "description": "Signal line"},
    ]

    def generate_signals(self, df, params):
        # 시그널 생성 로직
        ...
```

> 프론트엔드 수정 없이 `GET /api/strategies/`에서 자동으로 노출됩니다.

---

## 7. 프론트엔드 설계

### 페이지 구조

```
App.tsx (BrowserRouter)
├── NavBar: [Dashboard] [Data] [Backtest]
│
├── /              → Dashboard.tsx       백테스트 이력 목록/관리
├── /data          → DataManager.tsx     주식 데이터 가져오기
├── /backtest      → BacktestRun.tsx     백테스트 설정 및 실행
└── /results/:id   → BacktestResult.tsx  결과 상세 보기
```

### 컴포넌트 구성

```
BacktestResult.tsx
├── MetricsPanel         총 수익률 / 최종 자산 / 샤프 비율 / MDD / 승률
├── EquityCurve          자산 곡선 라인 차트 (Recharts)
├── CandlestickChart     캔들 차트 + 지표 오버레이 + 매매 마커 (lightweight-charts)
└── TradeLog             거래 내역 테이블

BacktestRun.tsx
└── StrategyForm         종목 / 전략 / 파라미터 / 기간 / 자본금 입력 폼
```

### UI 테마
- **배경**: `#0f172a` (Slate 900)
- **카드**: `#1e1e2e`
- **텍스트**: `#e2e8f0` (밝은 회색)
- **보조 텍스트**: `#94a3b8`
- **액센트**: `#3b82f6` (Blue 500)
- **수익**: `#22c55e` (Green), **손실**: `#ef4444` (Red)

---

## 8. 성과 지표 계산

| 지표 | 수식 | 설명 |
|------|------|------|
| **Total Return** | `(최종 자산 - 초기 자본) / 초기 자본 × 100` | 총 수익률 (%) |
| **Sharpe Ratio** | `mean(초과수익률) / std(일별수익률) × √252` | 위험 대비 수익 (연환산, 무위험이자율 2%) |
| **Max Drawdown** | `max((고점 - 저점) / 고점 × 100)` | 최대 낙폭 (%) |
| **Win Rate** | `수익 거래 수 / 총 SELL 거래 수 × 100` | 승률 (%) |

---

## 9. 실행 방법

### 사전 요구사항
- Python 3.12+
- Node.js 20+

### 백엔�� 실행
```bash
cd backend
python -m venv venv
source venv/Scripts/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### 프론트엔드 실행
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
2. **Backtest** 탭 → 전략/파라미터 설정 → **Run Backtest**
3. 결과 페이지에서 성과 분석

---

## 10. 설계 결정 및 근거

| 결정 | 근거 |
|------|------|
| OHLCV를 SQLite에 캐싱 | yfinance 속도 제한 회피, 백테스트 실행 속도 향상, 재현성 보장 |
| equity_curve를 JSON 컬럼으로 저장 | 별도 테이블보다 단순, 개인 연구 도구에 적합 |
| 자체 백테스트 엔진 (backtrader 미사용) | 80~100줄의 단순한 코드, 디버깅/확장 용이 |
| lightweight-charts v4 사용 | v5는 API 호환성 문제, v4가 안정적 |
| 전략 레지스트리 패턴 | 새 전략 추가 시 프론트엔드 수정 불필요 |
| Pydantic + TypeScript 이중 스키마 | API 경계에서 양방향 타입 안전성 보장 |
