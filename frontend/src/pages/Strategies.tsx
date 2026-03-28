import { useState, useEffect } from "react";
import type { StrategyInfo } from "../types";
import { listStrategies } from "../api/client";

const STRATEGY_DETAILS: Record<string, {
  how_it_works: string;
  buy_rule: string;
  sell_rule: string;
  strengths: string[];
  weaknesses: string[];
  best_for: string;
}> = {
  ma_crossover: {
    how_it_works:
      "서로 다른 기간의 두 이동평균선을 종가 기준으로 계산합니다. " +
      "단기 이동평균(Fast MA)은 최근 가격 변화에 빠르게 반응하고, 장기 이동평균(Slow MA)은 전체적인 추세를 나타냅니다. " +
      "단기선이 장기선을 위로 돌파하면(골든크로스) 상승 모멘텀을 의미하고, " +
      "아래로 돌파하면(데드크로스) 하락 모멘텀을 의미합니다.\n\n" +
      "예시: MA10(10일 평균)이 MA50(50일 평균)을 상향 돌파하면, 최근 10일간의 평균 가격이 " +
      "50일 평균보다 높아진 것이므로 상승 추세 전환으로 해석합니다.",
    buy_rule:
      "단기 MA가 장기 MA를 상향 돌파 (골든크로스) → 매수\n" +
      "• 전일: 단기 MA ≤ 장기 MA\n" +
      "• 당일: 단기 MA > 장기 MA\n" +
      "• 현재 보유 중인 포지션이 없어야 함\n" +
      "• 매수 시 보유 현금 전액으로 최대 수량 매수",
    sell_rule:
      "단기 MA가 장기 MA를 하향 돌파 (데드크로스) → 매도\n" +
      "• 전일: 단기 MA ≥ 장기 MA\n" +
      "• 당일: 단기 MA < 장기 MA\n" +
      "• 현재 보유 중인 포지션이 있어야 함\n" +
      "• 매도 시 보유 주식 전량 매도",
    strengths: [
      "주요 추세 전환을 효과적으로 포착",
      "로직이 단순하고 직관적이어서 이해하기 쉬움",
      "강한 추세가 있는 시장에서 우수한 성과",
      "노이즈를 평균으로 상쇄하여 안정적인 시그널 생성",
    ],
    weaknesses: [
      "후행 지표 — 실제 가격 변동보다 시그널이 늦게 발생",
      "횡보/박스권 시장에서 잦은 거짓 시그널(Whipsaw) 발생",
      "장기 MA는 긴 워밍업 기간 필요 (예: 50일치 데이터 후 첫 시그널)",
      "급등/급락 시 진입 타이밍이 늦어 수익 기회를 놓칠 수 있음",
    ],
    best_for: "명확한 방향성이 있는 추세 시장 (예: 상승장의 기술주, 강한 하락 후 반등 구간)",
  },
  rsi: {
    how_it_works:
      "RSI(상대강도지수)는 최근 가격 변동의 속도와 크기를 0~100 사이 값으로 측정합니다. " +
      "일정 기간 동안의 평균 상승폭과 평균 하락폭을 비교하여 계산합니다.\n\n" +
      "RSI가 과매도 기준(기본값 30) 아래로 떨어지면 주가가 너무 빠르게 하락하여 " +
      "저평가 상태임을 나타냅니다 (반등 가능성). " +
      "RSI가 과매수 기준(기본값 70) 위로 올라가면 주가가 너무 빠르게 상승하여 " +
      "고평가 상태임을 나타냅니다 (조정 가능성).\n\n" +
      "계산식: RSI = 100 - (100 / (1 + 평균상승폭/평균하락폭))",
    buy_rule:
      "RSI가 과매도 기준 이하로 하락 → 매수\n" +
      "• RSI < 30 (기본 과매도 임계값)\n" +
      "• 주가가 급락하여 반등 가능성이 높은 구간\n" +
      "• 현재 보유 중인 포지션이 없어야 함\n" +
      "• 매수 시 보유 현금 전액으로 최대 수량 매수",
    sell_rule:
      "RSI가 과매수 기준 이상으로 상승 → 매도\n" +
      "• RSI > 70 (기본 과매수 임계값)\n" +
      "• 주가가 급등하여 조정 가능성이 높은 구간\n" +
      "• 현재 보유 중인 포지션이 있어야 함\n" +
      "• 매도 시 보유 주식 전량 매도",
    strengths: [
      "단기 가격 극단값을 잘 포착하여 타이밍 우수",
      "박스권/횡보 시장에서 효과적",
      "MA보다 워밍업 기간이 짧아 빠른 시그널 생성",
      "과매수/과매도 임계값을 조절하여 민감도 조정 가능",
    ],
    weaknesses: [
      "강한 추세에서 과매수/과매도 상태가 장기간 지속될 수 있음",
      "강한 상승장에서 너무 일찍 매도할 위험",
      "추세가 강한 시장에서는 효과 감소",
      "단독 사용 시 추세 방향을 무시하는 역추세 매매가 될 수 있음",
    ],
    best_for: "지지선과 저항선 사이에서 등락을 반복하는 박스권 종목 (예: 안정적인 대형주, 유틸리티/소비재 섹터)",
  },
  bollinger: {
    how_it_works:
      "볼린저 밴드는 세 개의 선으로 구성됩니다: 중심선(단순이동평균 SMA), " +
      "그리고 중심선에서 표준편차의 N배만큼 떨어진 상단 밴드와 하단 밴드입니다.\n\n" +
      "변동성이 커지면 밴드가 넓어지고, 줄어들면 밴드가 좁아집니다. " +
      "주가는 통계적으로 밴드 안에서 움직이는 경향이 있습니다(평균 회귀). " +
      "하단 밴드에 닿으면 상대적으로 저가, 상단 밴드에 닿으면 상대적으로 고가로 판단합니다.\n\n" +
      "계산식:\n" +
      "• 상단 밴드 = SMA + (표준편차 × N)\n" +
      "• 하단 밴드 = SMA - (표준편차 × N)",
    buy_rule:
      "종가가 하단 밴드 이하로 하락 → 매수\n" +
      "• 종가 ≤ 하단 밴드 (SMA - N × 표준편차)\n" +
      "• 통계적 저점 구간 — 평균으로 회귀 가능성\n" +
      "• 현재 보유 중인 포지션이 없어야 함\n" +
      "• 매수 시 보유 현금 전액으로 최대 수량 매수",
    sell_rule:
      "종가가 상단 밴드 이상으로 상승 → 매도\n" +
      "• 종가 ≥ 상단 밴드 (SMA + N × 표준편차)\n" +
      "• 통계적 고점 구간 — 평균으로 회귀 가능성\n" +
      "• 현재 보유 중인 포지션이 있어야 함\n" +
      "• 매도 시 보유 주식 전량 매도",
    strengths: [
      "변동성에 자동 적응 — 밴드가 시장 상황에 맞게 조절됨",
      "최근 가격 범위 대비 극단값을 잘 포착",
      "추세(SMA)와 변동성(표준편차) 정보를 동시에 활용",
      "시각적으로 직관적이어서 차트 분석에 유용",
    ],
    weaknesses: [
      "강한 추세에서 가격이 밴드를 따라 이동(Band Walking)하여 회귀하지 않을 수 있음",
      "돌파(Breakout) 상황에서 평균 회귀 가정이 무너짐",
      "높은 변동성 기간에 잦은 매매 시그널 발생 가능",
      "밴드 폭 설정(표준편차 배수)에 따라 성과 차이가 큼",
    ],
    best_for: "주기적 가격 패턴이 있고 적당한 변동성을 가진 종목 (예: 대형 우량주, ETF, 배당주)",
  },
  macd: {
    how_it_works:
      "MACD(이동평균 수렴·확산)는 두 지수이동평균(EMA)의 차이를 이용합니다. " +
      "빠른 EMA(12일)에서 느린 EMA(26일)를 빼면 MACD선이 되고, " +
      "MACD선의 9일 EMA가 시그널선입니다.\n\n" +
      "MACD선이 시그널선을 위로 돌파하면 상승 모멘텀, " +
      "아래로 돌파하면 하락 모멘텀을 의미합니다.\n\n" +
      "MA Crossover와 비슷하지만, EMA를 사용하여 최근 가격에 더 높은 가중치를 부여하므로 " +
      "시그널이 더 빠르게 발생합니다.",
    buy_rule:
      "MACD선이 시그널선을 상향 돌파 → 매수\n" +
      "• 전일: MACD ≤ Signal\n" +
      "• 당일: MACD > Signal\n" +
      "• 현재 보유 포지션이 없어야 함",
    sell_rule:
      "MACD선이 시그널선을 하향 돌파 → 매도\n" +
      "• 전일: MACD ≥ Signal\n" +
      "• 당일: MACD < Signal\n" +
      "• 현재 보유 포지션이 있어야 함",
    strengths: [
      "EMA 기반이라 SMA보다 최근 가격 반응이 빠름",
      "추세 전환을 조기에 포착 가능",
      "모멘텀의 강도(MACD 히스토그램)까지 파악 가능",
      "가장 널리 사용되는 기술적 지표 중 하나",
    ],
    weaknesses: [
      "횡보장에서 잦은 거짓 시그널 발생",
      "급격한 가격 변동 시 후행할 수 있음",
      "파라미터(12/26/9)에 따라 성과 차이가 큼",
      "단독 사용 시 추세 강도를 무시할 수 있음",
    ],
    best_for: "중기 추세 전환이 명확한 종목 (예: 기술주, 성장주, 섹터 ETF)",
  },
  golden_cross: {
    how_it_works:
      "50일 이동평균과 200일 이동평균의 교차를 이용하는 장기 추세 전략입니다.\n\n" +
      "50일선이 200일선을 상향 돌파하면 '골든크로스'라 하며, 장기 상승 추세 전환을 의미합니다. " +
      "반대로 하향 돌파하면 '데드크로스'라 하며, 장기 하락 추세 전환을 의미합니다.\n\n" +
      "MA Crossover(10/50)보다 훨씬 긴 기간을 사용하므로 " +
      "시그널 빈도가 매우 낮고(연 1~2회), 대형 추세만 포착합니다.",
    buy_rule:
      "50일 MA가 200일 MA를 상향 돌파 (골든크로스) → 매수\n" +
      "• 전일: MA50 ≤ MA200\n" +
      "• 당일: MA50 > MA200\n" +
      "• 장기 상승 추세 시작 신호\n" +
      "• 연 1~2회 발생하는 희귀 시그널",
    sell_rule:
      "50일 MA가 200일 MA를 하향 돌파 (데드크로스) → 매도\n" +
      "• 전일: MA50 ≥ MA200\n" +
      "• 당일: MA50 < MA200\n" +
      "• 장기 하락 추세 시작 신호",
    strengths: [
      "노이즈에 거의 영향받지 않는 안정적 시그널",
      "대형 하락장(2008 금융위기, 2020 코로나)을 효과적으로 회피",
      "매매 빈도가 매우 낮아 거래 비용 최소",
      "기관 투자자들도 참고하는 검증된 지표",
    ],
    weaknesses: [
      "시그널이 매우 느림 — 추세 전환 후 수개월 뒤 발생",
      "200일 워밍업 기간이 필요하여 데이터 초기 구간 사용 불가",
      "V자 반등 시 진입이 늦어 수익 기회를 놓침",
      "횡보장에서 뒤늦은 진입/청산으로 손실 발생",
    ],
    best_for: "장기 투자 관점의 대형주/ETF (예: SPY, QQQ). 연금형 장기 포트폴리오에 적합",
  },
  stochastic: {
    how_it_works:
      "스토캐스틱 오실레이터는 일정 기간의 가격 범위(고가-저가) 대비 현재 종가의 위치를 " +
      "0~100 사이 값으로 나타냅니다.\n\n" +
      "%K = (종가 - N일 최저가) / (N일 최고가 - N일 최저가) × 100\n" +
      "%D = %K의 M일 이동평균 (시그널선)\n\n" +
      "과매도 구간(20 이하)에서 %K가 %D를 상향 돌파하면 매수, " +
      "과매수 구간(80 이상)에서 %K가 %D를 하향 돌파하면 매도합니다.\n\n" +
      "RSI와 비슷하지만, 종가뿐 아니라 고가/저가 범위를 함께 고려합니다.",
    buy_rule:
      "과매도 구간에서 %K가 %D를 상향 돌파 → 매수\n" +
      "• %K < 20 (과매도 구간)\n" +
      "• 전일: %K ≤ %D\n" +
      "• 당일: %K > %D\n" +
      "• 바닥에서 반등 시작 신호",
    sell_rule:
      "과매수 구간에서 %K가 %D를 하향 돌파 → 매도\n" +
      "• %K > 80 (과매수 구간)\n" +
      "• 전일: %K ≥ %D\n" +
      "• 당일: %K < %D\n" +
      "• 고점에서 하락 시작 신호",
    strengths: [
      "고가/저가 범위를 반영하여 RSI보다 정밀한 과매수/과매도 판단",
      "%K/%D 교차로 타이밍을 세밀하게 조정",
      "박스권에서 매우 효과적인 역추세 매매",
      "조건이 까다로워(과매수/과매도 + 교차) 거짓 시그널이 적음",
    ],
    weaknesses: [
      "조건이 까다로워 시그널 빈도가 낮을 수 있음",
      "강한 추세에서 과매수/과매도 구간에 장기간 머무르면 시그널 없음",
      "단기 변동성이 큰 종목에서 노이즈 영향",
      "파라미터(%K기간, %D기간, 임계값)에 민감",
    ],
    best_for: "지지/저항이 명확한 박스권 종목, 변동성이 적당한 대형주",
  },
  dual_ma_rsi: {
    how_it_works:
      "이동평균(MA)으로 추세 방향을 필터링하고, RSI로 진입 타이밍을 잡는 복합 전략입니다.\n\n" +
      "1단계 — 추세 확인: Fast MA > Slow MA이면 상승 추세\n" +
      "2단계 — 타이밍: 상승 추세에서 RSI가 과매도(40 이하)이면 매수\n\n" +
      "매도는 반대: 하락 추세(Fast MA < Slow MA)에서 RSI가 과매수(60 이상)이면 매도.\n\n" +
      "단순 RSI 전략은 추세를 무시하여 하락장에서 매수하는 실수를 하지만, " +
      "이 전략은 추세 필터가 있어 상승장에서만 매수합니다.",
    buy_rule:
      "상승 추세 + RSI 과매도 → 매수\n" +
      "• Fast MA > Slow MA (상승 추세 확인)\n" +
      "• RSI < 40 (일시적 조정, 눌림목)\n" +
      "• 상승 추세 중 단기 하락 = 매수 기회",
    sell_rule:
      "하락 추세 + RSI 과매수 → 매도\n" +
      "• Fast MA < Slow MA (하락 추세 확인)\n" +
      "• RSI > 60 (일시적 반등)\n" +
      "• 하락 추세 중 단기 반등 = 매도 기회",
    strengths: [
      "추세 필터로 역추세 매매 위험 제거",
      "두 지표의 장점을 결합 — 추세(MA) + 타이밍(RSI)",
      "하락장에서 매수하는 실수를 방지",
      "RSI 임계값이 관대(40/60)하여 시그널 빈도 적절",
    ],
    weaknesses: [
      "두 조건을 동시에 만족해야 하므로 시그널이 드물 수 있음",
      "급등장에서 RSI가 40까지 안 내려오면 진입 기회를 놓침",
      "파라미터가 5개로 많아 과적합(Overfitting) 위험",
      "추세 전환 초기에 MA가 아직 교차하지 않아 진입이 늦음",
    ],
    best_for: "중장기 추세가 있으면서도 조정이 자주 오는 종목 (예: 대형 기술주, 섹터 ETF)",
  },
  breakout: {
    how_it_works:
      "돈치안 채널(Donchian Channel) 기반의 돌파 전략입니다.\n\n" +
      "N일간의 최고가를 상향 돌파하면 새로운 상승 추세의 시작으로 판단하여 매수합니다. " +
      "M일간의 최저가를 하향 돌파하면 하락 추세로 전환된 것으로 판단하여 매도합니다.\n\n" +
      "진입(N=20)보다 청산(M=10)의 기간을 짧게 설정하여, " +
      "진입은 신중하게 하되 청산은 빠르게 하는 비대칭 구조입니다.\n\n" +
      "유명한 터틀 트레이딩(Turtle Trading) 시스템의 핵심 전략이기도 합니다.",
    buy_rule:
      "종가가 N일 최고가를 돌파 → 매수\n" +
      "• 당일 종가 > 전일까지의 20일 최고가\n" +
      "• 신고가 돌파 = 강한 상승 모멘텀\n" +
      "• 저항선 돌파로 해석",
    sell_rule:
      "종가가 M일 최저가를 하향 돌파 → 매도\n" +
      "• 당일 종가 < 전일까지의 10일 최저가\n" +
      "• 신저가 돌파 = 추세 약화/전환\n" +
      "• 지지선 이탈로 해석",
    strengths: [
      "추세의 시작을 포착 — 큰 움직임의 초입에 진입",
      "비대칭 진입/청산으로 수익은 길게, 손실은 짧게",
      "터틀 트레이딩으로 검증된 역사적 전략",
      "단순한 규칙으로 구현이 쉽고 일관성 있음",
    ],
    weaknesses: [
      "횡보장에서 가짜 돌파(False Breakout)가 빈번",
      "돌파 후 즉시 되돌림이 오면 손실 발생",
      "박스권에서 상단 매수 → 하단 매도 반복으로 연속 손실",
      "거래 빈도가 높아질 수 있어 슬리피지/수수료 부담",
    ],
    best_for: "변동성이 큰 추세 시장, 모멘텀 종목 (예: 성장주, 레버리지 ETF, 원자재 ETF)",
  },
  vwap: {
    how_it_works:
      "VWAP(거래량 가중 평균가)은 일정 기간의 거래량을 가중치로 반영한 평균 가격입니다.\n\n" +
      "VWAP = Σ(종가 × 거래량) / Σ(거래량)\n\n" +
      "가격이 VWAP보다 크게 아래에 있으면 시장 참여자들의 평균 매수가보다 싸게 살 수 있는 기회, " +
      "크게 위에 있으면 비싸게 파는 기회로 해석합니다.\n\n" +
      "기관 투자자들이 대량 매매의 기준점으로 사용하는 핵심 지표입니다.",
    buy_rule:
      "가격이 VWAP 대비 N% 이상 하락 → 매수\n" +
      "• (종가 - VWAP) / VWAP < -2% (기본값)\n" +
      "• 시장 평균 매수가보다 크게 할인된 상태\n" +
      "• 평균으로 회귀할 가능성",
    sell_rule:
      "가격이 VWAP 대비 N% 이상 상승 → 매도\n" +
      "• (종가 - VWAP) / VWAP > +2% (기본값)\n" +
      "• 시장 평균 매수가보다 크게 프리미엄 상태\n" +
      "• 평균으로 회귀할 가능성",
    strengths: [
      "거래량을 반영하여 단순 이동평균보다 시장 현실을 잘 반영",
      "기관 투자자의 기준점과 동일하여 의미 있는 지지/저항선",
      "평균 회귀 전략으로 박스권에서 효과적",
      "임계값(%) 조절로 민감도를 쉽게 조정 가능",
    ],
    weaknesses: [
      "거래량 데이터 품질에 의존 — 거래량이 적은 종목에서 부정확",
      "강한 추세에서 VWAP 대비 계속 벌어지면 진입/청산이 늦음",
      "일중(Intraday) VWAP과 달리, 롤링 VWAP은 정밀도가 떨어짐",
      "돌파 시장에서 평균 회귀 가정이 무너짐",
    ],
    best_for: "거래량이 풍부한 대형주/ETF, 기관 매매가 활발한 종목 (예: SPY, AAPL, QQQ)",
  },
};

export default function Strategies() {
  const [strategies, setStrategies] = useState<StrategyInfo[]>([]);
  const [selected, setSelected] = useState<string>("");

  useEffect(() => {
    listStrategies().then((r) => {
      setStrategies(r.data);
      if (r.data.length > 0) setSelected(r.data[0].name);
    });
  }, []);

  const current = strategies.find((s) => s.name === selected);
  const details = selected ? STRATEGY_DETAILS[selected] : null;

  const sectionStyle: React.CSSProperties = {
    background: "#0f172a",
    borderRadius: 8,
    padding: "16px 20px",
    marginBottom: 12,
  };

  return (
    <div>
      <h2 style={{ color: "#e2e8f0", marginBottom: 8 }}>전략 가이드</h2>
      <p style={{ color: "#64748b", fontSize: 14, marginBottom: 24 }}>
        각 트레이딩 전략의 작동 원리와 매수/매도 기준을 확인하세요
      </p>

      {/* Strategy Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        {strategies.map((s) => (
          <button
            key={s.name}
            onClick={() => setSelected(s.name)}
            style={{
              background: selected === s.name ? "#3b82f6" : "#1e1e2e",
              color: selected === s.name ? "#fff" : "#94a3b8",
              border: selected === s.name ? "none" : "1px solid #334155",
              borderRadius: 8,
              padding: "10px 20px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {s.display_name}
          </button>
        ))}
      </div>

      {current && details && (
        <div style={{ background: "#1e1e2e", borderRadius: 8, padding: 24 }}>
          {/* Header */}
          <h3 style={{ color: "#e2e8f0", fontSize: 22, marginBottom: 4 }}>
            {current.display_name}
          </h3>
          <p style={{ color: "#64748b", fontSize: 14, marginBottom: 24 }}>
            {current.description}
          </p>

          {/* How it Works */}
          <div style={sectionStyle}>
            <h4 style={{ color: "#8b5cf6", fontSize: 14, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
              작동 원리
            </h4>
            <p style={{ color: "#cbd5e1", fontSize: 14, lineHeight: 1.8, whiteSpace: "pre-wrap" }}>
              {details.how_it_works}
            </p>
          </div>

          {/* Buy / Sell Rules */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div style={{ ...sectionStyle, borderLeft: "3px solid #22c55e" }}>
              <h4 style={{ color: "#22c55e", fontSize: 14, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
                매수 조건
              </h4>
              <pre style={{ color: "#cbd5e1", fontSize: 13, lineHeight: 1.8, whiteSpace: "pre-wrap", fontFamily: "inherit" }}>
                {details.buy_rule}
              </pre>
            </div>
            <div style={{ ...sectionStyle, borderLeft: "3px solid #ef4444" }}>
              <h4 style={{ color: "#ef4444", fontSize: 14, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
                매도 조건
              </h4>
              <pre style={{ color: "#cbd5e1", fontSize: 13, lineHeight: 1.8, whiteSpace: "pre-wrap", fontFamily: "inherit" }}>
                {details.sell_rule}
              </pre>
            </div>
          </div>

          {/* Parameters */}
          <div style={sectionStyle}>
            <h4 style={{ color: "#f59e0b", fontSize: 14, marginBottom: 12, textTransform: "uppercase", letterSpacing: 1 }}>
              파라미터 설정
            </h4>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
              {current.params.map((p) => (
                <div
                  key={p.name}
                  style={{
                    background: "#1e1e2e",
                    border: "1px solid #334155",
                    borderRadius: 6,
                    padding: "12px 16px",
                  }}
                >
                  <div style={{ color: "#e2e8f0", fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
                    {p.name.replace(/_/g, " ")}
                  </div>
                  <div style={{ color: "#64748b", fontSize: 12, marginBottom: 6 }}>
                    {p.description}
                  </div>
                  <div style={{ color: "#94a3b8", fontSize: 13 }}>
                    타입: <span style={{ color: "#3b82f6" }}>{p.type}</span>
                    {" · "}기본값: <span style={{ color: "#22c55e" }}>{p.default}</span>
                    {" · "}범위: <span style={{ color: "#f59e0b" }}>{p.min}~{p.max}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Strengths / Weaknesses */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div style={sectionStyle}>
              <h4 style={{ color: "#22c55e", fontSize: 14, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
                장점
              </h4>
              <ul style={{ color: "#cbd5e1", fontSize: 13, lineHeight: 2, paddingLeft: 20 }}>
                {details.strengths.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
            <div style={sectionStyle}>
              <h4 style={{ color: "#ef4444", fontSize: 14, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
                단점
              </h4>
              <ul style={{ color: "#cbd5e1", fontSize: 13, lineHeight: 2, paddingLeft: 20 }}>
                {details.weaknesses.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          </div>

          {/* Best For */}
          <div style={{ ...sectionStyle, borderLeft: "3px solid #3b82f6" }}>
            <h4 style={{ color: "#3b82f6", fontSize: 14, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
              적합한 시장/종목
            </h4>
            <p style={{ color: "#cbd5e1", fontSize: 14 }}>
              {details.best_for}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
