# BacktestLab

주식 트레이딩 전략을 **백테스팅**하고 시장 데이터를 시각화하는 웹 애플리케이션입니다.
Yahoo Finance에서 과거 시세를, FRED에서 거시 지표를 받아 SQLite에 캐싱하고, 15가지 내장
전략으로 포트폴리오 시뮬레이션을 실행한 뒤 자산 곡선·캔들차트·성과 지표·거래 내역으로
결과를 보여줍니다.

> 개인 연구/학습용 도구입니다. 실제 투자 권유가 아니며, 과거 성과가 미래 수익을 보장하지 않습니다.

## 주요 기능

- **데이터 관리** — 종목 티커로 yfinance에서 OHLCV를 받아 SQLite에 캐싱 (rate limit 회피, 재현성)
- **지수 일괄 수집** — S&P 500·나스닥 100·코스피 200 구성종목을 한 번에 받아옴. 백그라운드로 돌며 진행률을 표시
- **투자자별 수급** — KIS Open API로 개인·외국인·기관(연기금·투신·사모 등 세부 7종) 순매수를 수집 (한국 전용)
- **분기 재무** — 매출·영업이익·재고·영업현금흐름 등 "이익의 질"을 볼 수 있는 항목
- **일별 스냅샷** — 시가총액·PER·PBR·증권사 목표주가. 과거 소급이 불가능해 오늘부터 쌓는 값
- **거시 지표** — FRED에서 실업률·금리·장단기 금리차 등 8종을 받아 종목 낙폭과 같은 시간축에 나란히 배치
- **파생 지표** — 캐시된 OHLCV만으로 계산하는 이동평균·이격도·거래대금 배율·위꼬리·52주 위치
- **산업 현황** — 제품군(DRAM·HBM·NAND 등) 단위로 경쟁 구도와 마진·재고 추이를 비교
- **시장 리포트** — 일간·주간·월간·분기 등락 상위와 섹터별 수익률 곡선
- **백테스트 실행** — 전략·파라미터·기간·자본금을 설정해 시뮬레이션
- **투자 모드** — 거치식(`lump_sum`)과 적립식(`dca`, 월 정액 매수) 지원
- **성과 지표** — 총 수익률, CAGR, Sharpe 비율, 최대 낙폭(MDD), 승률
- **시각화** — 자산 곡선(Recharts), 캔들차트 + 지표 오버레이 + 매매 마커(lightweight-charts), 거래 로그
- **종목 분석** — 전략 없이 데이터 자체를 보는 화면. 낙폭 곡선, 연도별 수익률, 약세장(고점 대비 -20% 이상) 이벤트와 저점 이후 3·6·12개월 반등률
- **전략 탐색기** — 사용 가능한 전략과 파라미터 스키마 조회
- **스크리너** — 시가총액 상위 종목 필터링 → 전체 전략 백테스트 → 수익률 상위 종목 추천 (2단계)

## 제공 데이터

다섯 갈래입니다. 앞의 셋은 외부에서 받아 캐싱한 원본이고, 뒤의 둘은 이 앱이 계산해 만든
값입니다. 수치는 로컬 DB 실측이며, 수집 범위에 따라 달라집니다.

### 1. 시세 (OHLCV)

| 항목 | 내용 |
|------|------|
| 규모 | 728종목 · 930,122행 |
| 구성 | 미국 521 · 한국 199 · 대만 2 · 일본 1 · ETF 4 |
| 기간 | 지수 일괄 수집분은 5년, 개별 수집분은 최대 2000년~ |
| 필드 | 시가·고가·저가·종가·거래량 |
| 출처 | Yahoo Finance (yfinance) |

야후 심볼 규칙을 그대로 쓰므로 접미사만 붙이면 어느 시장이든 받을 수 있습니다
(`005930.KS`, `2330.TW`, `7203.T`, `BTC-USD`, `KRW=X`).

### 2. 투자자별 수급 — 한국 전용

| 항목 | 내용 |
|------|------|
| 규모 | 199종목 · 20,250행 · 2021-07 ~ 현재 |
| 주체 | 개인 · 외국인 · 기관 합계 |
| 기관 세부 | 연기금 · 투신 · 사모 · 금융투자 · 은행 · 보험 · 기타법인 |
| 필드 | 순매수 수량/금액, 매수·매도 수량 |
| 출처 | 한국투자증권 KIS Open API |

**미국은 제공하지 않습니다.** 미국 시장이 투자자 유형별 매매동향을 공개하지 않기 때문이며,
데이터 소스를 바꿔도 해결되지 않습니다.

### 3. 분기 재무

| 항목 | 내용 |
|------|------|
| 규모 | 206종목 · 9,520행 · 2004-12 ~ 2026-06 |
| 손익 | 매출 · 매출총이익 · 영업이익 · 순이익 |
| 재무상태 | 재고자산 · 매출채권 · 총자산 · 총부채 · 자본 |
| 현금흐름 | 영업활동현금흐름 · 잉여현금흐름 |
| 지표 | ROE · EPS · BPS (한국은 KIS가 직접 제공) |
| 출처 | KIS (한국) · yfinance (미국) |

> **통화와 단위가 섞여 있습니다.** 삼성전자는 원, 애플은 달러이며 KIS는 억원 단위로 줍니다.
> `source`·`unit_scale` 컬럼으로 구분하되, **절대액을 시장 간에 비교하면 안 되고**
> 증가율·비율로만 읽어야 합니다.

### 4. 일별 스냅샷 — 오늘부터 쌓이는 값

| 항목 | 내용 |
|------|------|
| 규모 | 722종목 · 하루 1행 |
| 필드 | 종가 · 시가총액 · PER · PBR |
| 컨센서스 | 목표주가 평균/최고/최저 · 애널리스트 수 · 투자의견 |
| 출처 | yfinance |

시세와 달리 **과거를 소급할 수 없습니다.** yfinance도 증권사 API도 목표주가와 시가총액은
"오늘 얼마"만 알려주고 어제 값은 주지 않습니다. 쌓기 시작한 날부터 시계열이 생깁니다.

### 5. 거시 지표 (FRED)

| 항목 | 내용 |
|------|------|
| 규모 | 8지표 · 35,872행 |
| 고용 | 실업률 · 비농업 고용 · 신규 실업수당 청구 |
| 금리 | 연방기금금리 · 국채 10년 · 장단기 금리차(10Y-2Y) |
| 물가·재정 | 소비자물가지수 · 정부부채/GDP |
| 출처 | FRED (API 키 불필요, 퍼블릭 도메인) |

### 6. 계산해서 제공하는 값

원본을 저장하지 않고 **요청할 때마다 계산**합니다. 사본을 두면 원본과 어긋날 여지만 생기기 때문입니다.

| 종류 | 내용 |
|------|------|
| 파생 지표 | 이동평균 5·20·60일, 이격도, 거래대금 배율, 위꼬리·양봉 일수, 52주 위치, 변동성 |
| 종목 통계 | 낙폭 곡선, 연도별 수익률, 약세장(-20%) 이벤트와 저점 후 3·6·12개월 반등률 |
| 산업 현황 | 제품군(DRAM·HBM·NAND 등)별 경쟁 구도, 영업이익률·재고/매출·영업현금/매출 추이 |
| 시장 리포트 | 일간·주간·월간·분기 등락 상위, 섹터별 수익률 곡선과 추세 |
| 백테스트 | 총수익률 · CAGR · Sharpe · MDD · 승률 · 자산 곡선 · 거래 내역 |

### 참고 — 제공하지 않는 것

자주 묻는 항목 중 **현재 없는** 것입니다. 사유는 [`doc/roadmap.md`](./doc/roadmap.md)에 적어 두었습니다.

| 항목 | 사유 |
|------|------|
| 미국 투자자별 수급 | 시장이 공개하지 않음 |
| 공매도·신용잔고·대차잔고 | KIS에 엔드포인트가 있으나 미연동 |
| 뉴스·공시 원문 | DART·SEC 미연동 |
| 메모리 현물가(DRAM/NAND), 가동률, 수주잔고 | 유료이거나 비정형 |
| 계좌 정보 · 투자 일지 | 사용자 입력 영역 |

## 기술 스택

| 구분 | 기술 |
|------|------|
| Backend | Python 3.12, FastAPI, SQLAlchemy, Pydantic |
| Frontend | React 19, TypeScript, Vite, React Router |
| Database | SQLite |
| 데이터 | yfinance (Yahoo Finance), KIS Open API (한국투자증권), FRED |
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
   - 또는 **S&P 500 / 나스닥 100 / 코스피 200** 버튼으로 지수 구성종목을 5년치씩 한 번에 수집
2. 캐시 목록에서 **티커를 클릭**하면 요약(스파크라인·수익률·이격도)이 펼쳐지고, **전체 보기**로 종목 분석 화면으로 이동
3. **Backtest** 탭 → 종목·전략·파라미터·기간·자본금(또는 적립식 월납입액) 설정 → **Run Backtest**
4. 결과 페이지에서 지표·차트·거래 내역 확인 (기록은 **Dashboard**에 저장됨)
5. (선택) **Screener** 탭에서 시총 상위 종목을 전략별로 자동 백테스트해 상위 종목 추천

> Backtest 실행 시 캐시에 데이터가 없으면 자동으로 yfinance에서 받아옵니다.

### 미국 외 종목

야후 심볼 규칙을 그대로 따르므로 접미사만 붙이면 됩니다.

| 입력 | 대상 |
|------|------|
| `AAPL` | 미국 |
| `005930.KS` | 코스피 (삼성전자) |
| `247540.KQ` | 코스닥 |
| `7203.T` | 도쿄 |
| `BTC-USD` · `KRW=X` | 암호화폐 · 환율 |

다만 화면에 통화 표시는 없고, 스크리너의 기본 종목 풀은 미국 대형주로 고정돼 있습니다.

## 데이터 화면

### 지수 일괄 수집

구성종목 목록은 지수마다 다른 곳에서 읽습니다. 위키피디아가 나스닥 100 표를 내렸고,
KRX 공식 API는 계정을 요구해 `pykrx`도 막히기 때문입니다.

| 지수 | 종목 수 | 출처 |
|------|--------|------|
| S&P 500 | 503 | 위키피디아 |
| 나스닥 100 | 102 | Slickcharts |
| 코스피 200 | 201 | 한국투자증권 종목 마스터 |

회사 이름도 이 표에서 함께 가져옵니다. yfinance의 `.info`로 받으면 종목당 0.9초씩
걸려 500종목이면 8분인데, 구성종목 표에는 이름이 이미 들어 있어 추가 요청이 없습니다.

수집은 백그라운드로 돌고 화면은 진행률을 폴링합니다. 새로고침해도 진행 중인 작업을
이어받습니다. **편입 정보 동기화**는 시세 없이 구성종목과 이름만 1초 만에 갱신합니다.

### 목록 다루기

종목이 수백 개가 되므로 티커·회사 이름 검색과 지수 필터(합집합)를 제공합니다.
행을 펼치면 최근 1년 스파크라인과 핵심 수치가 나옵니다.

### 거시 지표 (FRED)

실업률, 비농업 고용, 신규 실업수당 청구, 연방기금금리, 국채 10년 금리,
장단기 금리차(10Y-2Y), 소비자물가지수, 정부부채/GDP — 8종입니다. API 키가 필요 없습니다.

종목 분석 화면에서는 낙폭 차트 아래에 **같은 x축으로** 쌓입니다. 세로로 같은 위치가
같은 시점이라, 실업률이 치솟은 지점과 주가가 무너진 지점을 한 줄에서 읽을 수 있습니다.
단위가 제각각이라 한 축에 겹치지 않고 칸을 나눕니다.

## 파생 지표

캐시된 OHLCV에서 계산합니다. 저장하지 않고 요청할 때마다 계산합니다 — 원본이 이미
DB에 있으므로 사본을 따로 두면 어긋날 여지만 생깁니다.

| 항목 | 내용 |
|------|------|
| 이동평균 | 5·20·60일, 20일선 위 연속일수 |
| 이격도 | 5·20·60일 (한 차트에 겹쳐 그림 — 벌어진 폭 자체가 정보) |
| 거래대금 | 5일÷60일 배율, 20일 평균 대비 시계열 |
| 캔들 | 긴 위꼬리 일수(20일), 양봉일수(15일), 저점 상승 여부 |
| 위치 | 52주 고가·저가 대비, 20일 변동성(연율) |

종가·이격도·거래대금 세 차트가 하나의 x축을 공유하고, 1달부터 전체까지 구간을 바꿀 수
있습니다. 타일 값은 구간과 무관하게 항상 마지막 거래일 기준입니다.

> **거래대금은 근사치입니다.** `종가 × 거래량`이라 변동성이 큰 날일수록 오차가 커집니다.
> 그래서 절대 금액이 아니라 배율로만 읽습니다 — 분자와 분모가 같은 방식으로 틀려
> 오차가 상쇄됩니다.

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
├── backend/            FastAPI 서버
│   ├── routers/               stocks, macro, strategies, backtests, screening, industry, reports, snapshots
│   ├── services/
│   │   ├── strategies/        전략 15종 + 레지스트리
│   │   ├── data_fetcher.py    yfinance 다운로드 + 일괄 캐싱
│   │   ├── kis_client.py      KIS Open API 인증·유량 제어
│   │   ├── investor_flow.py   투자자별 수급 (한국)
│   │   ├── fundamentals.py    분기 재무 (yfinance)
│   │   ├── kis_fundamentals.py 분기 재무 (KIS, 한국)
│   │   ├── snapshots.py       일별 시총·PER·목표주가 적재
│   │   ├── macro_fetcher.py   FRED 시계열
│   │   ├── indicators.py      OHLCV 파생 지표
│   │   ├── industry_groups.py 제품군 분류 + 산업 현황
│   │   ├── reports.py         기간별 등락·섹터 곡선
│   │   ├── universe.py        지수 구성종목 목록
│   │   ├── bulk_job.py        백그라운드 일괄 수집
│   │   ├── market_stats.py    낙폭·연도별 수익률·약세장
│   │   ├── screener.py        2단계 스크리너
│   │   └── screener_scan.py   조건 스캔
│   └── requirements.txt
├── frontend/           React + Vite SPA (src/pages, src/components, src/api)
├── doc/
│   ├── roadmap.md             데이터 현황·확장 계획·수집 비용 실측
│   └── book/                  투자서 분석 노트와 재현 가능한 검증 스크립트
├── start.sh            백엔드·프론트엔드 동시 실행 스크립트
├── ARCHITECTURE.md     상세 설계 문서 (ERD, API, 데이터 흐름)
├── CLAUDE.md           AI 에이전트 작업 가이드
└── README.md
```

### 화면

| 경로 | 화면 |
|------|------|
| `/` | Dashboard — 백테스트 기록 |
| `/data` | Data Manager — 수집·목록·검색 (종목 / 지표 탭) |
| `/data/:ticker` | 종목 분석 — 캔들, 파생 지표, 수급, 재무, 낙폭 + 거시 지표, 약세장 |
| `/data/macro/:seriesId` | 거시 지표 상세 |
| `/industry` · `/industry/:key` | 산업 목록 · 제품군별 경쟁 구도 |
| `/report` · `/report/:universe/:period` | 시장 리포트 — 기간별 등락 상위, 섹터 곡선 |
| `/backtest` · `/results/:id` | 백테스트 실행 · 결과 |
| `/strategies` · `/screener` | 전략 탐색기 · 스크리너 |

## API 개요

Base URL: `http://localhost:8000/api`

| Method | Path | 설명 |
|--------|------|------|
| **시세** | | |
| POST | `/stocks/fetch` | yfinance에서 시세 다운로드 및 캐싱 |
| POST | `/stocks/refresh` | 캐시된 전체 종목을 같은 구간으로 재수집 |
| GET | `/stocks/` | 캐시된 종목 목록 (회사 이름·지수 편입 포함) |
| GET | `/stocks/{ticker}` | 캐시된 OHLCV 조회 |
| GET | `/stocks/universes` | 일괄 수집 가능한 지수 목록 |
| POST | `/stocks/universes/sync` | 구성종목·회사 이름만 갱신 (시세 제외) |
| POST | `/stocks/bulk-fetch` | 지수 구성종목 일괄 수집 (백그라운드) |
| GET | `/stocks/bulk-fetch/status` | 일괄 수집 진행률 |
| **파생·통계** | | |
| GET | `/stocks/{ticker}/indicators` | 파생 지표 (`?range=1m\|3m\|6m\|1y\|3y\|5y\|all`) |
| GET | `/stocks/{ticker}/stats` | 낙폭 곡선, 연도별 수익률, 약세장 이벤트 |
| **수급 (한국)** | | |
| GET | `/stocks/{ticker}/investor-flow` | 투자자별 순매수 시계열 |
| POST | `/stocks/{ticker}/investor-flow/sync` | KIS에서 수급 수집 |
| **재무·스냅샷** | | |
| GET | `/stocks/{ticker}/fundamentals` | 분기 재무 시계열 |
| POST | `/stocks/{ticker}/fundamentals/sync` | 재무 수집 |
| POST | `/stocks/bulk-fundamentals` | 재무 일괄 수집 (백그라운드) |
| GET | `/stocks/{ticker}/snapshots` | 일별 스냅샷 (시총·PER·목표주가) |
| POST | `/snapshots/capture` · GET `/snapshots/status` | 스냅샷 적재 · 진행률 |
| **거시** | | |
| GET | `/macro/catalog` · `/macro/` · `/macro/{id}` | FRED 카탈로그 · 캐시 목록 · 시계열 |
| POST | `/macro/fetch` | FRED 시계열 다운로드 및 캐싱 |
| **산업·리포트** | | |
| GET | `/industry/` · `/industry/{key}` | 산업 목록 · 제품군별 현황 (`?range=`) |
| GET | `/reports/periods` · `/reports/curve-ranges` | 리포트 기간·구간 옵션 |
| GET | `/reports/{period}` | 기간별 등락 상위 (일간/주간/월간/분기) |
| GET | `/reports/sector-curves` · `/reports/sector-trends` | 섹터 수익률 곡선 · 추세 |
| **전략·백테스트** | | |
| GET | `/strategies/` | 전략 목록 및 파라미터 스키마 |
| POST | `/backtests/run` | 백테스트 실행 및 저장 |
| GET | `/backtests/` · `/backtests/{id}` | 최근 50개 · 상세 |
| DELETE | `/backtests/{id}` | 백테스트 삭제 |
| **스크리너** | | |
| GET | `/screening/pool` | 기본 종목 풀 |
| POST | `/screening/market-cap` · `/screening/full` · `/screening/scan` | 시총 상위 N · 2단계 스크리닝 · 조건 스캔 |

전체 스키마와 예시는 http://localhost:8000/docs 에서 확인할 수 있습니다.

## 데이터베이스

SQLite 파일 하나(`backend/backtest.db`)에 담깁니다. 마이그레이션 도구는 쓰지 않고
시작 시 `Base.metadata.create_all`로 테이블을 만듭니다.

| 테이블 | 내용 | 규모 |
|--------|------|------|
| `stocks` | OHLCV, `UNIQUE(ticker, date)` | 930,122행 / 728종목 |
| `companies` | 티커 → 회사 이름·GICS 섹터·업종·KRX 업종 | 728행 |
| `index_members` | 지수 편입 (지수 × 티커) | 804행 |
| `investor_flows` | 투자자별 순매수 (한국) | 20,250행 / 199종목 |
| `fundamentals` | 분기 재무 | 9,520행 / 206종목 |
| `snapshots` | 일별 시총·PER·목표주가 | 하루 722행 |
| `macro_series` · `macro_data` | FRED 지표 메타 · 관측치 | 8지표 / 35,872행 |
| `backtests` · `trades` | 백테스트 결과 · 거래 내역 | |

기존 모델에 컬럼을 추가하거나 이름을 바꾸면 로컬 DB는 자동으로 따라오지 않습니다.
파일을 지우고 다시 만들거나 수동으로 옮겨야 합니다.

## 더 알아보기

- 설계 상세 (ERD, 데이터 흐름, 설계 결정 근거): [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- 새 전략 추가 방법 및 개발 규칙: [`CLAUDE.md`](./CLAUDE.md)
- 데이터 현황과 확장 계획, 소스별 한계: [`doc/roadmap.md`](./doc/roadmap.md)
- 매매 에이전트를 만든다면 어떤 구조여야 하는지: [`doc/trading-agent.md`](./doc/trading-agent.md)
- 이 엔진으로 검증한 투자서 주장과 실측 통계: [`doc/book/markets-never-forget/`](./doc/book/markets-never-forget/)
- 투자서에서 옮긴 AI 프롬프트 모음: [`doc/book/ai_questions/`](./doc/book/ai_questions/)
