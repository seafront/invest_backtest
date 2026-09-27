import { useEffect, useState } from "react";
import type { StrategyInfo } from "../types";
import { listStrategies } from "../api/client";
import { fmtParam, paramLabel } from "../utils/params";

const MUTED = "#94a3b8";
const INK = "#e2e8f0";
const GRID = "#334155";

interface Props {
  strategyName: string;
  params: Record<string, number>;
}

/**
 * 결과를 만든 전략과 파라미터. 값만으로는 "slow period 200"이 무슨 뜻인지, 기본값에서
 * 바꾼 것인지 알 수 없어 설명·기본값·허용 범위를 함께 보여 준다.
 */
export default function StrategyParamsPanel({ strategyName, params }: Props) {
  const [info, setInfo] = useState<StrategyInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    listStrategies()
      .then((r) => {
        if (!cancelled) setInfo(r.data.find((s) => s.name === strategyName) ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [strategyName]);

  // 저장된 값이 기준이다. 스키마에만 있고 값이 없는 파라미터는 엔진이 기본값을 썼다.
  const schema = info?.params ?? [];
  const names = [...new Set([...schema.map((p) => p.name), ...Object.keys(params)])];

  return (
    <div style={{ background: "#1e1e2e", borderRadius: 8, padding: 20, marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
        <h3 style={{ color: INK, margin: 0, fontSize: 16 }}>{info?.display_name ?? paramLabel(strategyName)}</h3>
        <span style={{ color: "#64748b", fontSize: 12 }}>전략 파라미터</span>
      </div>
      {info?.description && <p style={{ color: MUTED, fontSize: 13, margin: "0 0 14px" }}>{info.description}</p>}

      {names.length === 0 ? (
        <p style={{ color: "#64748b", fontSize: 13, margin: 0 }}>파라미터가 없는 전략입니다.</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
          {names.map((name) => {
            const p = schema.find((s) => s.name === name);
            const value = params[name] ?? p?.default;
            const changed = p !== undefined && value !== undefined && value !== p.default;
            return (
              <div key={name} style={{ background: "#0f172a", border: `1px solid ${GRID}`, borderRadius: 6, padding: "10px 12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <span style={{ color: MUTED, fontSize: 12 }}>{paramLabel(name)}</span>
                  {changed && <span style={{ color: "#f59e0b", fontSize: 11 }}>기본값에서 변경</span>}
                </div>
                <div style={{ color: INK, fontSize: 20, fontWeight: 600, fontVariantNumeric: "tabular-nums", margin: "2px 0" }}>
                  {value === undefined ? "—" : fmtParam(value)}
                </div>
                {p && (
                  <div style={{ color: "#64748b", fontSize: 11, marginBottom: 4 }}>
                    기본값 {fmtParam(p.default)} · 범위 {fmtParam(p.min)}–{fmtParam(p.max)}
                  </div>
                )}
                {p?.description && <div style={{ color: MUTED, fontSize: 12, lineHeight: 1.4 }}>{p.description}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
