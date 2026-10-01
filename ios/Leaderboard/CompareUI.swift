import BacktestCore
import Charts
import SwiftUI

/// Tear Sheet 로 가는 길. 파라미터를 바꾼 변형·최적화 추천값도 같은 화면으로 연다.
struct TearSheetRoute: Hashable {
    var strategy: String
    /// 기본값과 다르게 돌릴 값 (비어 있으면 기본값)
    var params: [String: Double] = [:]
    /// 계산 구간 (nil 이면 Leaderboard 와 같은 최근 5년)
    var period: ClosedRange<Day>? = nil
}

enum ParamText {
    /// "fast period 50 · slow period 200" (웹 paramsText)
    static func of(_ values: [String: Double], specs: [ParamSpec]) -> String {
        specs.compactMap { s in values[s.name].map { "\(label(s.name)) \(Fmt.param($0))" } }.joined(separator: " · ")
    }

    /// fast_period → fast period
    static func label(_ name: String) -> String { name.replacingOccurrences(of: "_", with: " ") }

    /// 기본값과 다른 파라미터만
    static func changed(_ values: [String: Double], specs: [ParamSpec]) -> String {
        specs.compactMap { s in
            guard let v = values[s.name], v != s.defaultValue else { return nil }
            return "\(label(s.name)) \(Fmt.param(v))"
        }.joined(separator: " · ")
    }
}

/// 비교 그래프의 한 줄
struct ChartLine: Identifiable {
    let id: String
    let label: String
    let color: Color
    var dashed = false
    let points: [CurvePoint]
}

/// 여러 줄의 누적 수익률(%)을 추세 구간 배경과 함께 그린다
struct MultiReturnChart: View {
    let lines: [ChartLine]
    let regimes: [Regime]
    let days: Int

    var body: some View {
        Chart {
            ForEach(regimes.filter { $0.kind != .flat }) { g in
                RectangleMark(xStart: .value("시작", g.start.chartDate), xEnd: .value("끝", g.end.chartDate))
                    .foregroundStyle((g.kind == .up ? Theme.positive : Theme.negative).opacity(0.10))
            }
            RuleMark(y: .value("0", 0)).foregroundStyle(Color.secondary.opacity(0.4)).lineStyle(StrokeStyle(lineWidth: 0.5))
            ForEach(lines) { line in
                ForEach(line.points, id: \.date) { p in
                    LineMark(x: .value("날짜", p.date.chartDate), y: .value("수익률", p.ret), series: .value("s", line.id))
                        .foregroundStyle(line.color)
                        .lineStyle(StrokeStyle(lineWidth: line.dashed ? 1.5 : 2, dash: line.dashed ? [4, 3] : []))
                }
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading) { v in
                AxisGridLine()
                AxisValueLabel { if let d = v.as(Double.self) { Text("\(Int(d))%") } }
            }
        }
        .yearAxis(days: days)
    }
}

/// 여러 줄의 롤링 초과수익(%p). 0선 위면 그 구간은 B&H 를 이겼다.
struct MultiExcessChart: View {
    let lines: [(id: String, color: Color, points: [Rolling.ExcessPoint])]
    let range: ClosedRange<Day>

    var body: some View {
        Chart {
            RuleMark(y: .value("0", 0)).foregroundStyle(Color.secondary).lineStyle(StrokeStyle(lineWidth: 0.8))
            ForEach(lines, id: \.id) { line in
                ForEach(line.points, id: \.date) { p in
                    LineMark(x: .value("날짜", p.date.chartDate), y: .value("초과", p.excess), series: .value("s", line.id))
                        .foregroundStyle(line.color)
                        .lineStyle(StrokeStyle(lineWidth: 1.5))
                }
            }
        }
        .chartXScale(domain: range.lowerBound.chartDate...range.upperBound.chartDate)
        .chartYAxis {
            AxisMarks(position: .leading) { v in
                AxisGridLine()
                AxisValueLabel { if let d = v.as(Double.self) { Text("\(d > 0 ? "+" : "")\(Int(d))") } }
            }
        }
        .yearAxis(days: range.upperBound - range.lowerBound)
    }
}

/// 범례 한 칸
struct LegendSwatch: View {
    let color: Color
    var dashed = false

    var body: some View {
        Capsule().stroke(color, style: StrokeStyle(lineWidth: 2.5, dash: dashed ? [3, 2] : []))
            .frame(width: 14, height: 2)
    }
}

/// 비교 구간 (3개월~2년) 고르기. 데이터 기간의 절반을 넘는 길이는 막는다.
struct WindowPicker: View {
    @Binding var weeks: Int
    let points: Int

    var body: some View {
        HStack(spacing: 6) {
            ForEach(Rolling.windows) { w in
                let active = Self.effective(weeks, points: points) == w.weeks
                Button(w.label) { weeks = w.weeks }
                    .buttonStyle(.bordered)
                    .tint(active ? .accentColor : .gray)
                    .fontWeight(active ? .bold : .regular)
                    .disabled(!Rolling.allowed(weeks: w.weeks, points: points))
            }
        }
        .font(.subheadline)
    }

    /// 고른 길이가 이 기간에 너무 길면 쓸 수 있는 가장 긴 길이
    static func effective(_ weeks: Int, points: Int) -> Int? {
        Rolling.allowed(weeks: weeks, points: points)
            ? weeks : Rolling.windows.reversed().first { Rolling.allowed(weeks: $0.weeks, points: points) }?.weeks
    }
}
