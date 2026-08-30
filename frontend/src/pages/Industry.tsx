import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listIndustries } from "../api/client";
import type { IndustryInfo } from "../types";

/** 산업 목록. 지금은 반도체 하나뿐이지만 백엔드 표에 추가하면 여기 자동으로 늘어난다. */
export default function Industry() {
  const [items, setItems] = useState<IndustryInfo[]>([]);

  useEffect(() => {
    listIndustries()
      .then((r) => setItems(r.data))
      .catch(() => setItems([]));
  }, []);

  return (
    <div>
      <h2 style={{ color: "#e2e8f0", marginBottom: 4 }}>산업별 현황</h2>
      <p style={{ color: "#94a3b8", fontSize: 14, marginBottom: 20 }}>
        종목 하나가 아니라 제품군 안의 경쟁 구도를 본다.
      </p>

      {items.length === 0 ? (
        <p style={{ color: "#64748b", fontSize: 13 }}>등록된 산업이 없습니다.</p>
      ) : (
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {items.map((i) => (
            <Link
              key={i.key}
              to={`/industry/${i.key}`}
              style={{
                background: "#1e1e2e", borderRadius: 8, padding: 20,
                textDecoration: "none", minWidth: 280, flex: 1, maxWidth: 420,
                border: "1px solid #334155",
              }}
            >
              <div style={{ color: "#3b82f6", fontSize: 17, fontWeight: 700, marginBottom: 6 }}>
                {i.label} →
              </div>
              <div style={{ color: "#94a3b8", fontSize: 13, lineHeight: 1.5 }}>{i.note}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
