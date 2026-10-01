# 사이트 가이드

BacktestLab 화면에 나오는 숫자와 표시가 무엇을 뜻하는지 정리한다. 화면별로 나눴다.

| 문서 | 화면 | 주소 |
|---|---|---|
| [backtest-auto.md](backtest-auto.md) | Run Backtest — Auto 모드 (전략 비교) | `/backtest?mode=auto` |
| [backtest-result.md](backtest-result.md) | 백테스트 결과 (상세 보기) | `/results/:id` |
| [screener.md](screener.md) | Screener (조건 검색) | `/screener` |
| [portfolio.md](portfolio.md) | Portfolio (자산 현황·리밸런싱·보유 종목·시점 가이드·위험) | `/portfolio` |
| [signals.md](signals.md) | Signals (매매 신호 모니터링) | `/signals` |

## 모든 화면에 공통인 가정

백테스트 숫자를 읽을 때 엔진(`backend/services/backtest_engine.py`)의 가정을 알아야 한다.

- **체결가:** 신호가 나온 날의 종가에 바로 사고판다. 실제로는 다음 날 시가에 체결되는
  경우가 많아 결과가 조금 낙관적이다.
- **비용:** 수수료·세금·슬리피지를 넣지 않는다. 매매가 잦은 전략일수록 실제 성과가 더 나쁘다.
- **현금:** 보유하지 않는 동안 현금은 이자를 받지 않는다(0%). 보유 비율이 낮은 전략에 불리하다.
- **수량:** 정수 주만 산다. 한 번 들어가면 가진 현금으로 살 수 있는 만큼 전부 산다.
- **지표 준비 구간(warm-up):** 시작일 전 시세를 더 읽어 지표를 미리 계산한다. 시작일에 이미
  매수 신호 상태였다면 첫날 바로 산다.
- **통화:** `.KS`/`.KQ` 종목은 원(₩), 나머지는 달러($)로 표시한다.

과거 백테스트 결과이며 투자 조언이 아니다.
