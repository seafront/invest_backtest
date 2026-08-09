# BacktestLab

미국 주식 트레이딩 전략을 **백테스팅**하고 성과를 시각화하는 웹 애플리케이션입니다.
Yahoo Finance에서 과거 시세를 받아 SQLite에 캐싱하고, 15가지 내장 전략으로 포트폴리오
시뮬레이션을 실행한 뒤 자산 곡선·캔들차트·성과 지표·거래 내역으로 결과를 보여줍니다.

> 개인 연구/학습용 도구입니다. 실제 투자 권유가 아니며, 과거 성과가 미래 수익을 보장하지 않습니다.

## 주요 기능

- **데이터 관리** — 종목 티커로 yfinance에서 OHLCV를 받아 SQLite에 캐싱 (rate limit 회피, 재현성)
- **백테스트 실행** — 전략·파라미터·기간·자본금을 설정해 시뮬레이션
- **투자 모드** — 거치식(`lump_sum`)과 적립식(`dca`, 월 정액 매수) 지원
- **성과 지표** — 총 수익률, CAGR, Sharpe 비율, 최대 낙폭(MDD), 승률
- **시각화** — 자산 곡선(Recharts), 캔들차트 + 지표 오버레이 + 매매 마커(lightweight-charts), 거래 로그
- **전략 탐색기** — 사용 가능한 전략과 파라미터 스키마 조회
- **스크리너** — 시가총액 상위 종목 필터링 → 전체 전략 백테스트 → 수익률 상위 종목 추천 (2단계)

## 기술 스택

| 구분 | 기술 |
|------|------|
| Backend | Python 3.12, FastAPI, SQLAlchemy, Pydantic |
| Frontend | React 19, TypeScript, Vite, React Router |
| Database | SQLite |
| 데이터 | yfinance (Yahoo Finance) |
| 차트 | Recharts, lightweight-charts v4 |

## 빠른 시작

### 사전 요구사항
- Python 3.12+
- Node.js 20+

### 한 번에 실행

```bash
./start.sh
```

`:8000`(백엔드)·`:5173`(프론트엔드)의 기존 프로세스를 정리한 뒤 두 서버를 함께 띄웁니다.

### 수동 실행

**백엔드**
```bash
cd backend
python -m venv venv
source venv/bin/activate            # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

**프론트엔드**
```bash
cd frontend
npm install
npm run dev
```

### 접속
- 웹 UI: http://localhost:5173
- API 문서 (Swagger): http://localhost:8000/docs

## 사용 순서

1. **Data** 탭 → 종목(예: `AAPL`)과 기간 입력 → **Fetch Data**
2. **Backtest** 탭 → 종목·전략·파라미터·기간·자본금(또는 적립식 월납입액) 설정 → **Run Backtest**
3. 결과 페이지에서 지표·차트·거래 내역 확인 (기록은 **Dashboard**에 저장됨)
4. (선택) **Screener** 탭에서 시총 상위 종목을 전략별로 자동 백테스트해 상위 종목 추천

> Backtest 실행 시 캐시에 데이터가 없으면 자동으로 yfinance에서 받아옵니다.

## 내장 전략 (15종)

| 카테고리 | 전략 |
|----------|------|
| 추세 추종 | Buy & Hold, Golden Cross (50/200), Moving Average Crossover, EMA Crossover, ADX Trend |
| 모멘텀 | MACD, Dual MA + RSI, Momentum (ROC), Stochastic Oscillator |
| 평균 회귀 | RSI, Bollinger Bands, VWAP Reversion, Keltner Channel |
| 돌파 | Breakout (Donchian), Parabolic SAR |

각 전략은 파라미터 스키마를 스스로 노출하며, 프론트엔드 폼이 이를 읽어 동적으로 입력
UI를 생성합니다. 새 전략을 추가하면 프론트엔드 수정 없이 곧바로 UI에 나타납니다.

## 성과 지표

| 지표 | 설명 |
|------|------|
| Total Return | 총 수익률 (%) |
| CAGR | 연평균 복리 성장률 (%) |
| Sharpe Ratio | 위험 대비 수익 (연환산, 무위험이자율 2%) |
| Max Drawdown | 최대 낙폭 (%) |
| Win Rate | 승률 (SELL 거래 기준, %) |

## 프로젝트 구조

```
invest_backtest/
├── backend/            FastAPI 서버 (main.py, routers/, services/, utils/)
│   ├── services/strategies/   전략 15종 + 레지스트리
│   └── requirements.txt
├── frontend/           React + Vite SPA (src/pages, src/components, src/api)
├── start.sh            백엔드·프론트엔드 동시 실행 스크립트
├── ARCHITECTURE.md     상세 설계 문서 (ERD, API, 데이터 흐름)
├── CLAUDE.md           AI 에이전트 작업 가이드
└── README.md
```

## API 개요

Base URL: `http://localhost:8000/api`

| Method | Path | 설명 |
|--------|------|------|
| POST | `/stocks/fetch` | yfinance에서 시세 다운로드 및 캐싱 |
| GET | `/stocks/{ticker}` | 캐시된 OHLCV 조회 |
| GET | `/stocks/` | 캐시된 종목 목록 |
| GET | `/strategies/` | 전략 목록 및 파라미터 스키마 |
| POST | `/backtests/run` | 백테스트 실행 및 저장 |
| GET | `/backtests/` | 최근 50개 백테스트 |
| GET | `/backtests/{id}` | 백테스트 상세 |
| DELETE | `/backtests/{id}` | 백테스트 삭제 |
| POST | `/screening/market-cap` | 시총 상위 N 종목 |
| POST | `/screening/full` | 2단계 스크리닝 (시총 → 전략) |

전체 스키마와 예시는 http://localhost:8000/docs 에서 확인할 수 있습니다.

## 더 알아보기

- 설계 상세 (ERD, 데이터 흐름, 설계 결정 근거): [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- 새 전략 추가 방법 및 개발 규칙: [`CLAUDE.md`](./CLAUDE.md)
