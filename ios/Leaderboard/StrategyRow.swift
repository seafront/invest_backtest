import BacktestCore
import SwiftUI

/// 전략 한 줄. 웹의 넓은 표 대신, 판정에 쓰는 두 값(B&H 승률·초과 중앙값)을 크게 보이고
/// 나머지 지표는 한 줄로 줄였다. 누르면 전체 지표와 파라미터가 펼쳐진다.
struct StrategyRow: View {
    let row: Row
    let dca: Bool
    let colorSlot: Int?
    let plotDisabled: Bool
    let expanded: Bool
    let onTogglePlot: () -> Void
    let onToggleExpand: () -> Void

    private var r: AutoStrategyResult { row.result }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
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
                Spacer(minLength: 0)
                Image(systemName: expanded ? "chevron.up" : "chevron.down")
                    .font(.caption).foregroundStyle(.tertiary)
                    .padding(.top, 2)
            }
            .contentShape(Rectangle())
            .onTapGesture(perform: onToggleExpand)

            if expanded { details.padding(.leading, 34) }
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
        .buttonStyle(.plain)
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
        var parts = ["\(dca ? "IRR" : "CAGR") \(Fmt.pct(r.cagr))", "MDD -\(r.maxDrawdown.formatted(.number.precision(.fractionLength(1))))%"]
        if row.rollWin != nil { parts.insert("총 \(Fmt.pct(r.totalReturn))", at: 0) }
        return parts.joined(separator: " · ")
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: 6) {
            Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 4) {
                GridRow {
                    detail("총수익률", Fmt.pct(r.totalReturn))
                    detail(dca ? "IRR" : "CAGR", Fmt.pct(r.cagr))
                }
                GridRow {
                    detail("Sharpe", r.sharpeRatio.formatted(.number.precision(.fractionLength(2))))
                    detail("MDD", "-\(r.maxDrawdown.formatted(.number.precision(.fractionLength(1))))%")
                }
                GridRow {
                    detail("매매 승률", "\(Int(r.winRate.rounded()))%")
                    detail("거래", "\(r.tradesCount)회")
                }
            }
            if let first = r.firstTrade {
                Text("첫 매매 \(first.description)").font(.caption).foregroundStyle(.secondary)
            } else {
                Text("기간 안에 매매가 없었습니다").font(.caption).foregroundStyle(.secondary)
            }
            if !r.paramSpecs.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(r.paramSpecs, id: \.name) { p in
                        Text("\(p.name.replacingOccurrences(of: "_", with: " ")) = \(Fmt.param(r.params[p.name] ?? p.defaultValue))  ")
                            .font(.caption.monospaced())
                        + Text(p.description).font(.caption2).foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    private func detail(_ label: String, _ value: String) -> some View {
        HStack(spacing: 4) {
            Text(label).foregroundStyle(.secondary)
            Text(value).monospacedDigit()
        }
        .font(.caption)
    }
}
