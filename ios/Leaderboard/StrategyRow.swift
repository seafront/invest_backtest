import BacktestCore
import SwiftUI

/// 전략 한 줄. 웹의 넓은 표 대신, 판정에 쓰는 두 값(B&H 승률·초과 중앙값)을 크게 보이고
/// 나머지 지표는 한 줄로 줄였다. 누르면 Tear Sheet 로 간다.
struct StrategyRow: View {
    let row: Row
    let dca: Bool
    let colorSlot: Int?
    let plotDisabled: Bool
    let onTogglePlot: () -> Void

    private var r: AutoStrategyResult { row.result }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            plotToggle
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Text(r.displayName).font(.subheadline.bold()).lineLimit(1)
                    if row.beatsBenchmark {
                        Text("▲ B&H")
                            .font(.caption2.bold())
                            .padding(.horizontal, 5).padding(.vertical, 1)
                            .background(Theme.positive.opacity(0.18), in: Capsule())
                            .foregroundStyle(Theme.positive)
                    }
                    if row.isBenchmark {
                        Text("기준").font(.caption2).foregroundStyle(.secondary)
                    }
                }
                headline
                Text(secondaryLine)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }

    private var plotToggle: some View {
        Button(action: onTogglePlot) {
            if row.isBenchmark {
                // B&H 는 늘 회색 점선으로 그려진다
                Image(systemName: "line.diagonal").foregroundStyle(Theme.benchmark)
            } else if let slot = colorSlot {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.series[slot])
            } else {
                Image(systemName: "circle").foregroundStyle(plotDisabled ? Color.secondary.opacity(0.3) : .secondary)
            }
        }
        // borderless: 줄 전체(NavigationLink)가 아니라 이 버튼만 눌리게 한다
        .buttonStyle(.borderless)
        .font(.title3)
        .frame(width: 24)
        .disabled(row.isBenchmark || plotDisabled)
        .accessibilityLabel(colorSlot == nil ? "그래프에 표시" : "그래프에서 숨기기")
    }

    @ViewBuilder
    private var headline: some View {
        if let win = row.rollWin, let excess = row.rollExcess {
            HStack(spacing: 16) {
                metric("B&H 승률", "\(Int(win.rounded()))%", win > 50 ? Theme.positive : .primary)
                metric("초과 중앙값", Fmt.pp(excess), Theme.signed(excess))
            }
        } else {
            metric("총수익률", Fmt.pct(r.totalReturn), Theme.signed(r.totalReturn))
        }
    }

    private func metric(_ label: String, _ value: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(label).font(.caption2).foregroundStyle(.secondary)
            Text(value).font(.title3.bold().monospacedDigit()).foregroundStyle(color)
        }
    }

    private var secondaryLine: String {
        var parts = [
            "\(dca ? "IRR" : "CAGR") \(Fmt.pct(r.cagr))",
            "MDD -\(r.maxDrawdown.formatted(.number.precision(.fractionLength(1))))%",
            "거래 \(r.tradesCount)",
        ]
        if row.rollWin != nil { parts.insert("총 \(Fmt.pct(r.totalReturn))", at: 0) }
        return parts.joined(separator: " · ")
    }
}
