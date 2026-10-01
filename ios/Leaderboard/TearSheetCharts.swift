import BacktestCore
import Charts
import SwiftUI

extension Day {
    /// 차트 축용. 자정 UTC 로 두면 한국·미국 어느 시간대에서 봐도 같은 날짜로 찍힌다.
    var chartDate: Date { Date(timeIntervalSince1970: TimeInterval(ordinal) * 86400 + 43200) }
}

extension View {
    /// 날짜 축 눈금. 2년 넘게는 연 단위, 그보다 짧은 구간(Tear Sheet 계산 구간)은 몇 달 단위.
    func yearAxis(days: Int = 5 * 365) -> some View {
        chartXAxis {
            if days > 730 {
                AxisMarks(values: .stride(by: .year)) { _ in
                    AxisGridLine()
                    AxisValueLabel(format: .dateTime.year(.twoDigits))
                }
            } else {
                AxisMarks(values: .stride(by: .month, count: days > 300 ? 3 : days > 120 ? 2 : 1)) { _ in
                    AxisGridLine()
                    AxisValueLabel(format: .dateTime.year(.twoDigits).month(.defaultDigits))
                }
            }
        }
    }
}

extension StrategyReport {
    /// 차트 가로축 길이(일)
    var spanDays: Int { dataEnd - dataStart }
}

/// 추세 구간 배경 (초록 상승 · 빨강 하락)
private func regimeBands(_ regimes: [Regime]) -> some ChartContent {
    ForEach(regimes.filter { $0.kind != .flat }) { g in
        RectangleMark(xStart: .value("시작", g.start.chartDate), xEnd: .value("끝", g.end.chartDate))
            .foregroundStyle((g.kind == .up ? Theme.positive : Theme.negative).opacity(0.10))
    }
}

/// 전략과 B&H 의 누적 수익률(%)
struct TearSheetReturnChart: View {
    let report: StrategyReport

    var body: some View {
        Chart {
            regimeBands(report.regimes)
            RuleMark(y: .value("0", 0)).foregroundStyle(Color.secondary.opacity(0.4)).lineStyle(StrokeStyle(lineWidth: 0.5))
            if !report.isBenchmark {
                ForEach(report.benchmarkCurve, id: \.date) { p in
                    LineMark(x: .value("날짜", p.date.chartDate), y: .value("수익률", p.ret), series: .value("s", "B&H"))
                        .foregroundStyle(Theme.benchmark)
                        .lineStyle(StrokeStyle(lineWidth: 1.5, dash: [4, 3]))
                }
            }
            ForEach(report.curve, id: \.date) { p in
                LineMark(x: .value("날짜", p.date.chartDate), y: .value("수익률", p.ret), series: .value("s", "전략"))
                    .foregroundStyle(Theme.series[0])
                    .lineStyle(StrokeStyle(lineWidth: 2))
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading) { v in
                AxisGridLine()
                AxisValueLabel { if let d = v.as(Double.self) { Text("\(Int(d))%") } }
            }
        }
        .yearAxis(days: report.spanDays)
    }
}

/// 구간 끝 날짜별 "직전 N주 동안 전략 − B&H"(%p). 0선 위면 그 구간은 B&H 를 이겼다.
struct ExcessChart: View {
    let points: [Rolling.ExcessPoint]
    /// 위 누적 수익률 그래프와 같은 x축 — 첫 구간이 끝나기 전은 비어 있다
    let range: (Day?, Day?)

    var body: some View {
        Chart {
            // 면 하나는 한 색만 가진다 — 0 위·아래를 따로 칠한다
            ForEach(points, id: \.date) { p in
                AreaMark(x: .value("날짜", p.date.chartDate), yStart: .value("0", 0),
                         yEnd: .value("초과", max(p.excess, 0)), series: .value("s", "위"))
                    .foregroundStyle(Theme.positive.opacity(0.25))
                AreaMark(x: .value("날짜", p.date.chartDate), yStart: .value("0", 0),
                         yEnd: .value("초과", min(p.excess, 0)), series: .value("s", "아래"))
                    .foregroundStyle(Theme.negative.opacity(0.25))
                LineMark(x: .value("날짜", p.date.chartDate), y: .value("초과", p.excess), series: .value("s", "선"))
                    .foregroundStyle(Theme.series[0])
                    .lineStyle(StrokeStyle(lineWidth: 1.5))
            }
            RuleMark(y: .value("0", 0)).foregroundStyle(Color.secondary).lineStyle(StrokeStyle(lineWidth: 0.8))
        }
        .chartXScale(domain: (range.0 ?? points.first?.date ?? Day(ordinal: 0)).chartDate
                     ... (range.1 ?? points.last?.date ?? Day(ordinal: 1)).chartDate)
        .chartYAxis {
            AxisMarks(position: .leading) { v in
                AxisGridLine()
                AxisValueLabel { if let d = v.as(Double.self) { Text("\(d > 0 ? "+" : "")\(Int(d))") } }
            }
        }
        .yearAxis(days: (range.1 ?? Day(ordinal: 0)) - (range.0 ?? Day(ordinal: 0)))
    }
}

/// 날짜별 평가금액
struct EquityChart: View {
    let report: StrategyReport
    let currency: Currency

    var body: some View {
        Chart {
            ForEach(report.equity, id: \.date) { p in
                AreaMark(x: .value("날짜", p.date.chartDate), y: .value("평가금액", p.equity))
                    .foregroundStyle(LinearGradient(colors: [Theme.series[2].opacity(0.25), .clear],
                                                    startPoint: .top, endPoint: .bottom))
                LineMark(x: .value("날짜", p.date.chartDate), y: .value("평가금액", p.equity))
                    .foregroundStyle(Theme.series[2])
                    .lineStyle(StrokeStyle(lineWidth: 1.5))
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading) { v in
                AxisGridLine()
                AxisValueLabel { if let d = v.as(Double.self) { Text(Fmt.compactMoney(d, currency)) } }
            }
        }
        .yearAxis(days: report.spanDays)
    }
}

/// 가격(종가) 위에 매매 시점과 전략 지표를 얹는다. 5년 일봉 1,250개는 폰 폭에서 봉 하나가 1픽셀도 안 돼
/// 캔들 대신 종가 선으로 그린다. RSI·MACD 처럼 가격과 축이 다른 지표는 아래 따로 그린다.
struct PriceSection: View {
    let report: StrategyReport
    let currency: Currency

    private var priceIndicators: [Indicator] { report.indicators.filter { $0.pane == .price } }
    private var oscillators: [Indicator] { report.indicators.filter { $0.pane == .oscillator } }
    /// 적립식의 월 자동 매수까지 찍으면 표시가 너무 많다 — 전략 신호로 들어간 매수만 표시한다
    private var markers: [Trade] {
        var holding = false
        return report.trades.filter { t in
            switch t.action {
            case .buy: defer { holding = true }; return !holding
            case .sell: holding = false; return true
            }
        }
    }

    var body: some View {
        Section {
            Chart {
                ForEach(report.bars, id: \.date) { b in
                    LineMark(x: .value("날짜", b.date.chartDate), y: .value("가격", b.close), series: .value("s", "종가"))
                        .foregroundStyle(Color.primary.opacity(0.75))
                        .lineStyle(StrokeStyle(lineWidth: 1))
                }
                ForEach(Array(priceIndicators.enumerated()), id: \.element.id) { i, ind in
                    ForEach(ind.points, id: \.date) { p in
                        LineMark(x: .value("날짜", p.date.chartDate), y: .value("가격", p.value), series: .value("s", ind.name))
                            .foregroundStyle(Theme.series[i % Theme.series.count])
                            .lineStyle(StrokeStyle(lineWidth: 1))
                    }
                }
                ForEach(Array(markers.enumerated()), id: \.offset) { _, t in
                    PointMark(x: .value("날짜", t.date.chartDate), y: .value("가격", t.price))
                        .symbol {
                            Image(systemName: t.action == .buy ? "arrowtriangle.up.fill" : "arrowtriangle.down.fill")
                                .font(.system(size: 9))
                                .foregroundStyle(t.action == .buy ? Theme.positive : Theme.negative)
                        }
                }
            }
            .chartYScale(domain: .automatic(includesZero: false))
            .chartYAxis {
                AxisMarks(position: .leading) { v in
                    AxisGridLine()
                    AxisValueLabel { if let d = v.as(Double.self) { Text(Fmt.compactMoney(d, currency)) } }
                }
            }
            .yearAxis(days: report.spanDays)
            .frame(height: 240)
            .padding(.vertical, 6)

            legend(priceIndicators, extra: true)

            if !oscillators.isEmpty {
                Chart {
                    ForEach(Array(oscillators.enumerated()), id: \.element.id) { i, ind in
                        ForEach(ind.points, id: \.date) { p in
                            LineMark(x: .value("날짜", p.date.chartDate), y: .value("값", p.value), series: .value("s", ind.name))
                                .foregroundStyle(Theme.series[i % Theme.series.count])
                                .lineStyle(StrokeStyle(lineWidth: 1))
                        }
                    }
                }
                .chartXScale(domain: (report.bars.first?.date ?? report.startDate).chartDate
                             ... (report.bars.last?.date ?? report.endDate).chartDate)
                .chartYAxis { AxisMarks(position: .leading) }
                .yearAxis(days: report.spanDays)
                .frame(height: 130)
                .padding(.vertical, 4)
                legend(oscillators, extra: false)
            }
        } header: {
            Text("가격 차트")
        } footer: {
            Text("▲ 매수 ▼ 매도 (종가 기준). \(report.mode == .dca ? "적립식의 월 자동 매수는 표시하지 않습니다. " : "")지표는 열 때마다 다시 계산합니다.")
        }
    }

    private func legend(_ items: [Indicator], extra: Bool) -> some View {
        HStack(spacing: 12) {
            if extra {
                HStack(spacing: 4) {
                    Capsule().fill(Color.primary.opacity(0.75)).frame(width: 12, height: 2)
                    Text("종가")
                }
            }
            ForEach(Array(items.enumerated()), id: \.element.id) { i, ind in
                HStack(spacing: 4) {
                    Capsule().fill(Theme.series[i % Theme.series.count]).frame(width: 12, height: 2)
                    Text(ind.name)
                }
            }
        }
        .font(.caption)
        .lineLimit(1)
        .minimumScaleFactor(0.8)
    }
}
