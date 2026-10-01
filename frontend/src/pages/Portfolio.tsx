import { useState } from "react";
import HoldingsPanel from "../components/HoldingsPanel";
import AllocationPanel from "../components/AllocationPanel";
import GuidePanel from "../components/GuidePanel";
import RiskPanel from "../components/RiskPanel";

/**
 * 개인 포트폴리오. 자산 현황·비중과 리밸런싱, 보유 종목과 청산 규칙, 매수·매도 시점 가이드, 위험 분석.
 * 모두 조회·계산만 한다 — 주문은 하지 않는다.
 */
export default function Portfolio() {
  // 보유 종목이 바뀌면(동기화·추가·규칙 저장) 다른 패널을 다시 불러온다.
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  return (
    <div>
      <div style={{ color: "#64748b", fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>
        Portfolio · 개인 포트폴리오
      </div>
      <h2 style={{ color: "#e2e8f0", margin: "0 0 6px" }}>포트폴리오</h2>
      <p style={{ color: "#64748b", fontSize: 13, margin: "0 0 20px", lineHeight: 1.6 }}>
        KIS 계좌와 직접 입력한 보유분을 합쳐 비중·리밸런싱·위험을 보고, 종목마다 연결한 전략으로 다음 매수·매도 시점을 계산합니다. 모든 값은
        캐시의 일봉 종가 기준이며 이 앱은 주문하지 않습니다.
      </p>
      <AllocationPanel version={version} />
      <HoldingsPanel onChanged={bump} />
      <GuidePanel version={version} />
      <RiskPanel version={version} />
    </div>
  );
}
