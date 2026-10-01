import BacktestCore
import Charts
import SwiftUI

/// 전략별 누적 수익률(%)을 주 단위로 겹쳐 그린다. B&H 는 회색 점선(기준), 색 선은 고른 전략.
struct ReturnChart: View {
    let result: AutoBacktestResult
    let plotted: [String: Int]

    private struct Series: Identifiable {
        let name: String
        let color: Color
        let dashed: Bool
        let points: [CurvePoint]
        var id: String { name }
    }

    private var series: [Series] {
        var out: [Series] = []
        if let b = result.benchmark {
            out.append(Series(name: b.displayName, color: Theme.benchmark, dashed: true, points: b.curve))
        }
        for r in result.results {
            if let slot = plotted[r.strategyName] {
                out.append(Series(name: r.displayName, color: Theme.series[slot], dashed: false, points: r.curve))
            }
        }
        return out
    }

    var body: some View {
        Chart {
            RuleMark(y: .value("0", 0)).foregroundStyle(Color.secondary.opacity(0.4)).lineStyle(StrokeStyle(lineWidth: 0.5))
            ForEach(series) { s in
                ForEach(s.points, id: \.date) { p in
                    LineMark(
                        x: .value("날짜", p.date.chartDate),
                        y: .value("수익률", p.ret),
                        series: .value("전략", s.name)
                    )
                    .foregroundStyle(s.color)
                    .lineStyle(StrokeStyle(lineWidth: s.dashed ? 1.5 : 2, dash: s.dashed ? [4, 3] : []))
                }
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading) { v in
                AxisGridLine()
                AxisValueLabel { if let d = v.as(Double.self) { Text("\(Int(d))%") } }
            }
        }
        .yearAxis()
    }
}

struct ChartLegend: View {
    let result: AutoBacktestResult
    let plotted: [String: Int]

    var body: some View {
        let items = result.results
            .compactMap { r in plotted[r.strategyName].map { (r, $0) } }
            .sorted { $0.1 < $1.1 }
        VStack(alignment: .leading, spacing: 4) {
            if let b = result.benchmark {
                item(b.displayName, Theme.benchmark, dashed: true, value: b.curve.last?.ret)
            }
            ForEach(items, id: \.0.strategyName) { r, slot in
                item(r.displayName, Theme.series[slot], dashed: false, value: r.curve.last?.ret)
            }
        }
        .font(.caption)
    }

    private func item(_ name: String, _ color: Color, dashed: Bool, value: Double?) -> some View {
        HStack(spacing: 6) {
            Capsule()
                .stroke(color, style: StrokeStyle(lineWidth: 2.5, dash: dashed ? [3, 2] : []))
                .frame(width: 16, height: 2)
            Text(name).lineLimit(1)
            Spacer()
            if let value {
                Text(Fmt.pct(value)).monospacedDigit().foregroundStyle(Theme.signed(value))
            }
        }
    }
}
