import { useEffect, useState } from "react";
import { getMacroSeries, listMacroSeries } from "../api/client";
import type { MacroSeriesDetail } from "../types";
import { downsample, ts } from "../utils/chart";
import ChartRow from "./ChartRow";

/**
 * 캐시된 거시 지표를 전부 세로로 쌓는다.
 *
 * 드롭다운으로 하나씩 고르던 것을 대체한다. 지표를 고르는 화면에서는
 * "실업률이 치솟을 때 낙폭은 어땠나"를 보려면 왕복을 반복해야 했다.
 * 위 낙폭 차트와 x축을 공유하므로, 세로로 훑으면 한 시점의 상황이 한 번에 읽힌다.
 *
 * 한 축에 겹치지 않고 칸을 나누는 이유는 단위가 제각각이기 때문이다 —
 * 실업률(%)과 비농업 고용(천 명)을 같은 y축에 두면 둘 중 하나가 직선이 된다.
 */

const MUTED = "#94a3b8";
const GRID = "#334155";
const LINE = "#0891b2"; // 거시 지표는 상승/하락이 좋고 나쁨이 아니므로 중립색으로 통일한다

export default function MacroStack({
  startDate,
  endDate,
  tDomain,
  fmtX,
}: {
  startDate: string;
  endDate: string;
  tDomain: [number, number];
  fmtX: (t: number) => string;
}) {
  const [series, setSeries] = useState<MacroSeriesDetail[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listMacroSeries()
      .then((r) => Promise.all(r.data.map((m) => getMacroSeries(m.series_id))))
      .then((rs) => !cancelled && setSeries(rs.map((r) => r.data)))
      .catch(() => !cancelled && setSeries([]));
    return () => {
      cancelled = true;
    };
  }, []);

  if (series === null) {
    return <p style={{ color: MUTED, fontSize: 13 }}>거시 지표 불러오는 중…</p>;
  }
  if (series.length === 0) {
    return (
      <p style={{ color: "#64748b", fontSize: 13 }}>
        받아온 거시 지표가 없습니다. Data 탭의 지표에서 먼저 받아오세요.
      </p>
    );
  }

  // 종목 구간 밖은 잘라낸다. 겹치는 구간이 없으면 그리지 않고 이름만 남긴다.
  const panels = series.map((m) => {
    const inRange = m.data.filter((p) => p.date >= startDate && p.date <= endDate);
    return { meta: m, inRange };
  });
  const empty = panels.filter((p) => p.inRange.length === 0);

  return (
    <>
      <p style={{ color: MUTED, fontSize: 13, margin: "0 0 4px" }}>
        위 낙폭 차트와 x축이 같다. 세로로 같은 위치가 같은 시점이다.
        {" "}종목 구간({startDate} ~ {endDate})으로 잘라 그린다.
      </p>

      {panels
        .filter((p) => p.inRange.length > 0)
        .map(({ meta, inRange }) => {
          const rows = downsample(inRange, 400).map((p) => ({ t: ts(p.date), v: p.value }));
          const crossesZero =
            Math.min(...inRange.map((p) => p.value)) < 0 &&
            Math.max(...inRange.map((p) => p.value)) > 0;
          return (
            <ChartRow
              key={meta.series_id}
              rows={rows}
              tDomain={tDomain}
              fmtX={fmtX}
              lines={[{ key: "v", color: LINE, label: meta.name }]}
              gradientId={`macro-${meta.series_id}`}
              title={`${meta.name} (${meta.series_id}) — 단위 ${meta.unit || "—"}`}
              fmtValue={(n) => n.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              fmtTooltip={(n) => `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}${meta.unit}`}
              refLine={crossesZero ? 0 : undefined}
              yDomain={["auto", "auto"]}
              height={110}
            />
          );
        })}

      {empty.length > 0 && (
        <p style={{ color: "#64748b", fontSize: 12, marginTop: 12, borderTop: `1px solid ${GRID}`, paddingTop: 12 }}>
          구간이 겹치지 않아 생략: {empty.map((p) => p.meta.name).join(", ")}
        </p>
      )}
    </>
  );
}
