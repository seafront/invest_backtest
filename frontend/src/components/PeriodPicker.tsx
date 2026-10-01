import type { BacktestResult } from "../types";
import { NEGATIVE } from "../theme";
import { monthsBefore } from "../utils/date";
import { isFullPeriod, periodError, type Period } from "../utils/period";

const MUTED = "#94a3b8";
const INK = "#e2e8f0";
const GRID = "#334155";

/** 빠른 선택. 저장된 결과의 끝 날짜에서 거슬러 올라간다. months 0 은 저장된 전체 구간. */
const PRESETS = [
  { label: "전체", months: 0 },
  { label: "최근 3년", months: 36 },
  { label: "최근 2년", months: 24 },
  { label: "최근 1년", months: 12 },
  { label: "최근 6개월", months: 6 },
];

interface Props {
  saved: BacktestResult;
  period: Period;
  onChange: (p: Period) => void;
  loading: boolean;
}

/**
 * Tear Sheet 의 계산 구간. 전체 기간에 맞춘 값이 최근 시세에는 맞지 않을 수 있어, 구간을 좁혀
 * 지표·그래프·매매 기록·파라미터 비교를 모두 그 구간으로 다시 계산한다. 저장하지 않는다.
 */
export default function PeriodPicker({ saved, period, onChange, loading }: Props) {
  const error = periodError(period, saved);
  const full = isFullPeriod(period, saved);
  const dateInput: React.CSSProperties = {
    background: "#0f172a",
    border: `1px solid ${GRID}`,
    borderRadius: 6,
    color: INK,
    padding: "4px 8px",
    fontSize: 13,
    width: 150,
    colorScheme: "dark",
  };

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "8px 12px",
        background: "#1e1e2e",
        border: `1px solid ${full ? GRID : "#f59e0b"}`,
        borderRadius: 8,
        padding: "10px 14px",
        marginBottom: 20,
      }}
    >
      <span style={{ color: INK, fontSize: 13, fontWeight: 600 }}>계산 구간</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {PRESETS.map((p) => {
          const start = p.months === 0 ? saved.start_date : monthsBefore(saved.end_date, p.months);
          const ok = start >= saved.start_date;
          const active = period.end === saved.end_date && period.start === start;
          return (
            <button
              key={p.label}
              type="button"
              disabled={!ok}
              title={ok ? `${start} ~ ${saved.end_date}` : "저장된 구간보다 깁니다"}
              onClick={() => onChange({ start, end: saved.end_date })}
              style={{
                background: active ? "#3b82f6" : "transparent",
                color: active ? "#fff" : ok ? MUTED : "#475569",
                border: `1px solid ${active ? "#3b82f6" : GRID}`,
                borderRadius: 4,
                padding: "3px 10px",
                fontSize: 12,
                cursor: ok ? "pointer" : "not-allowed",
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: MUTED, fontSize: 12 }}>
        <input
          type="date"
          value={period.start}
          min={saved.start_date}
          max={saved.end_date}
          onChange={(e) => onChange({ ...period, start: e.target.value })}
          style={dateInput}
        />
        ~
        <input
          type="date"
          value={period.end}
          min={saved.start_date}
          max={saved.end_date}
          onChange={(e) => onChange({ ...period, end: e.target.value })}
          style={dateInput}
        />
      </span>
      <span style={{ color: error ? NEGATIVE : "#64748b", fontSize: 12 }}>
        {error ||
          (loading
            ? "계산 중…"
            : full
              ? "저장된 전체 구간입니다."
              : "이 구간으로 다시 계산한 결과입니다(저장하지 않음). 구간 시작 전 시세로 지표를 준비해, 이미 매수 상태면 첫날 삽니다.")}
      </span>
    </div>
  );
}
