import BacktestCore
import SwiftUI

/// 비교에 넣은 변형 하나. 색은 순서가 아니라 변형에 붙는다 — 하나를 지워도 나머지 선 색은 그대로.
struct Variant: Identifiable, Equatable {
    let id: Int
    let color: Int
    let params: [String: Double]
}

/// 파라미터 비교 (웹 components/ParamCompare.tsx).
///
/// 값을 바꿔 같은 구간·같은 투자 방식으로 다시 계산한다. 저장하지 않는다. 변형은 최대 3개, 원래 값과
/// 합쳐 4개 선까지 비교한다. 같은 데이터로 고른 값은 실제보다 좋아 보이기 쉬워 주변 값도 함께 봐야 한다.
struct ParamCompareSection: View {
    static let maxVariants = 3

    let model: LeaderboardModel
    let report: StrategyReport
    let period: ClosedRange<Day>?
    @Binding var variants: [Variant]

    @State private var draft: [String: Double]
    @State private var comparison: Comparison?
    @State private var loading = false
    @State private var failure: String?

    init(model: LeaderboardModel, report: StrategyReport, period: ClosedRange<Day>?, variants: Binding<[Variant]>) {
        self.model = model
        self.report = report
        self.period = period
        _variants = variants
        _draft = State(initialValue: report.values)
    }

    private var specs: [ParamSpec] { report.params }
    private var dca: Bool { report.mode == .dca }

    /// 변형으로 넣을 수 없는 사유. 직접 입력과 "최적값 찾기"가 같은 규칙을 쓴다.
    static func rejectReason(_ params: [String: Double], specs: [ParamSpec], original: [String: Double],
                             variants: [Variant]) -> String? {
        for p in specs {
            guard let v = params[p.name], v.isFinite else { return "\(ParamText.label(p.name)) 값을 입력하세요" }
            if !p.range.contains(v) {
                return "\(ParamText.label(p.name))은(는) \(Fmt.param(p.range.lowerBound))–\(Fmt.param(p.range.upperBound)) 범위여야 합니다"
            }
        }
        if params == original { return "원래 결과와 같은 값입니다" }
        if variants.contains(where: { $0.params == params }) { return "이미 추가한 변형입니다" }
        if variants.count >= maxVariants { return "변형은 최대 \(maxVariants)개까지 비교할 수 있습니다 — 하나를 삭제하세요" }
        return nil
    }

    /// 변형을 넣는다. 못 넣으면 사유를 돌려준다.
    static func add(_ params: [String: Double], to variants: inout [Variant], specs: [ParamSpec],
                    original: [String: Double]) -> String? {
        if let why = rejectReason(params, specs: specs, original: original, variants: variants) { return why }
        let used = Set([0] + variants.map(\.color))
        let color = (1...3).first { !used.contains($0) } ?? 1
        variants.append(Variant(id: (variants.map(\.id).max() ?? 0) + 1, color: color, params: params))
        return nil
    }

    private var requestKey: String {
        "\(String(describing: period))|\(variants.map { paramsKey($0.params) })"
    }

    var body: some View {
        editor
        if !variants.isEmpty {
            if let comparison {
                results(comparison)
            } else if let failure {
                Section { Text(failure).foregroundStyle(Theme.negative) }
            } else {
                Section { HStack { ProgressView(); Text("비교 계산 중…").foregroundStyle(.secondary) } }
            }
        }
    }

    // MARK: 입력

    private var editor: some View {
        let reason = Self.rejectReason(draft, specs: specs, original: report.values, variants: variants)
        return Section {
            ForEach(specs, id: \.name) { p in
                ParamField(spec: p, value: Binding(get: { draft[p.name] ?? p.defaultValue },
                                                   set: { draft[p.name] = $0 }),
                           original: report.values[p.name] ?? p.defaultValue)
            }
            HStack {
                Button("비교에 추가") {
                    _ = Self.add(draft, to: &variants, specs: specs, original: report.values)
                }
                .buttonStyle(.borderedProminent)
                .disabled(reason != nil)
                Button("원래 값으로") { draft = report.values }
                    .buttonStyle(.bordered)
                    .disabled(draft == report.values)
                Spacer()
            }
            if let reason, draft != report.values {
                Text(reason).font(.caption).foregroundStyle(Theme.negative)
            }
            ForEach(Array(variants.enumerated()), id: \.element.id) { i, v in
                HStack(spacing: 8) {
                    LegendSwatch(color: Theme.series[v.color])
                    VStack(alignment: .leading, spacing: 1) {
                        Text("변형 \(i + 1)").font(.subheadline.bold())
                        Text(ParamText.of(v.params, specs: specs)).font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button(role: .destructive) { variants.removeAll { $0.id == v.id } } label: {
                        Image(systemName: "trash")
                    }
                    .buttonStyle(.borderless)
                }
            }
        } header: {
            Text("파라미터 비교")
        } footer: {
            Text("값을 바꿔 같은 구간·같은 투자 방식으로 다시 계산합니다(저장하지 않음). 변형은 최대 \(Self.maxVariants)개. 같은 데이터로 고른 값은 실제보다 좋아 보이기 쉬워, 주변 값에서도 결과가 비슷한지 함께 보세요.")
        }
        .task(id: requestKey) { await recompute() }
    }

    private func recompute() async {
        guard !variants.isEmpty else { comparison = nil; return }
        loading = true
        defer { loading = false }
        do {
            comparison = try await model.comparison(for: report.strategyName,
                                                    paramSets: [report.values] + variants.map(\.params),
                                                    period: period)
            failure = nil
        } catch {
            failure = error.localizedDescription
        }
    }

    // MARK: 결과

    private struct Line {
        let key: String
        let label: String
        let color: Color
        let variant: Variant?
        let row: Comparison.Row
    }

    private func lines(_ c: Comparison) -> [Line] {
        // 계산 중에 변형이 바뀌었으면 응답의 줄 수가 맞지 않는다 — 직전 결과는 쓰지 않는다
        guard c.rows.count == variants.count + 1 else { return [] }
        return [Line(key: "orig", label: "원래", color: Theme.series[0], variant: nil, row: c.rows[0])]
            + variants.enumerated().map { i, v in
                Line(key: "v\(v.id)", label: "변형 \(i + 1)", color: Theme.series[v.color], variant: v, row: c.rows[i + 1])
            }
    }

    @ViewBuilder
    private func results(_ c: Comparison) -> some View {
        let ls = lines(c)
        let points = c.benchmark.result.curve.count
        let weeks = WindowPicker.effective(model.windowWeeks, points: points)
        let days = c.dataEnd - c.dataStart

        Section {
            MultiReturnChart(
                lines: [ChartLine(id: "bh", label: "Buy & Hold", color: Theme.benchmark, dashed: true,
                                  points: c.benchmark.result.curve)]
                    + ls.map { ChartLine(id: $0.key, label: $0.label, color: $0.color, points: $0.row.result.curve) },
                regimes: c.regimes, days: days)
                .frame(height: 230).padding(.vertical, 6)
            legend(ls)
        } header: {
            HStack {
                Text("비교 · 누적 수익률")
                if loading { ProgressView().controlSize(.mini) }
            }
        }

        if let weeks, let range = c.benchmark.result.curve.first.flatMap({ f in c.benchmark.result.curve.last.map { f.date...$0.date } }) {
            Section {
                WindowPicker(weeks: Binding(get: { model.windowWeeks }, set: { model.windowWeeks = $0 }), points: points)
                MultiExcessChart(
                    lines: ls.map { ($0.key, $0.color, Rolling.excess($0.row.result.curve, bench: c.benchmark.result.curve, weeks: weeks)) },
                    range: range)
                    .frame(height: 170).padding(.vertical, 4)
            } header: {
                Text("비교 · B&H 대비 롤링 초과수익")
            }
        }

        Section("비교 · 지표") {
            ForEach(ls, id: \.key) { line in
                metricsCard(line, bench: c.benchmark, weeks: weeks)
            }
            benchCard(c.benchmark)
        }

        if !c.regimes.isEmpty {
            Section {
                ForEach(Array(c.regimes.enumerated()), id: \.element.id) { i, g in
                    regimeRow(g, index: i, lines: ls)
                }
                ForEach(ls, id: \.key) { line in
                    let r = line.row
                    let up = Regimes.capture(r.regimeReturns, regimes: c.regimes, firstTrade: r.result.firstTrade, kind: .up)
                    let down = Regimes.capture(r.regimeReturns, regimes: c.regimes, firstTrade: r.result.firstTrade, kind: .down)
                    HStack(spacing: 6) {
                        LegendSwatch(color: line.color)
                        Text(line.label).font(.caption.bold())
                        Spacer()
                        Text("포착 \(up.map { "\(Int($0.rounded()))%" } ?? "—") · 노출 \(down.map { "\(Int($0.rounded()))%" } ?? "—")")
                            .font(.caption.monospacedDigit())
                    }
                }
            } header: {
                Text("비교 · 추세 구간별 성과")
            } footer: {
                Text("포착률은 상승 구간에서 B&H 상승분 중 가져간 비율(높을수록 좋음), 노출률은 하락 구간에서 B&H 하락분 중 맞은 비율(낮을수록 좋음)입니다. 첫 매매 전 구간은 빼고 셉니다.")
            }
        }
    }

    private func legend(_ ls: [Line]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(ls, id: \.key) { l in
                    HStack(spacing: 4) { LegendSwatch(color: l.color); Text(l.label) }
                }
                HStack(spacing: 4) { LegendSwatch(color: Theme.benchmark, dashed: true); Text("B&H") }
            }
            .font(.caption)
        }
    }

    private func metricsCard(_ line: Line, bench: Comparison.Row, weeks: Int?) -> some View {
        let r = line.row.result
        let stats = weeks.flatMap { Rolling.vsBenchmark(r.curve, bench: bench.result.curve, weeks: $0) }
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                LegendSwatch(color: line.color)
                Text(line.label).font(.subheadline.bold())
                if let s = stats, s.winRate > 50 {
                    Text("▲ B&H").font(.caption2.bold()).foregroundStyle(Theme.positive)
                }
                Spacer()
                if let v = line.variant {
                    NavigationLink(value: TearSheetRoute(strategy: report.strategyName, params: v.params, period: period)) {
                        Text("Tear Sheet").font(.caption)
                    }
                    .fixedSize()
                }
            }
            Text(ParamText.of(r.params, specs: specs)).font(.caption).foregroundStyle(.secondary)
            Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 3) {
                GridRow {
                    cell("B&H 승률", stats.map { "\(Int($0.winRate.rounded()))%" } ?? "—")
                    cell("초과 중앙값", stats.map { Fmt.pp($0.medianExcess) } ?? "—", stats.map { Theme.signed($0.medianExcess) })
                    cell("총수익률", Fmt.pct(r.totalReturn), Theme.signed(r.totalReturn))
                }
                GridRow {
                    cell(dca ? "IRR" : "CAGR", Fmt.pct(r.cagr), Theme.signed(r.cagr))
                    cell("Sharpe", r.sharpeRatio.formatted(.number.precision(.fractionLength(2))))
                    cell("MDD", "-\(r.maxDrawdown.formatted(.number.precision(.fractionLength(1))))%")
                }
                GridRow {
                    cell("거래", "\(r.tradesCount)회")
                }
            }
        }
        .padding(.vertical, 2)
    }

    private func benchCard(_ b: Comparison.Row) -> some View {
        let r = b.result
        return HStack(spacing: 6) {
            LegendSwatch(color: Theme.benchmark, dashed: true)
            Text("B&H").font(.subheadline.bold())
            Spacer()
            Text("\(Fmt.pct(r.totalReturn)) · \(dca ? "IRR" : "CAGR") \(Fmt.pct(r.cagr)) · MDD -\(r.maxDrawdown.formatted(.number.precision(.fractionLength(1))))%")
                .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
        }
    }

    private func cell(_ label: String, _ value: String, _ color: Color? = nil) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(label).font(.caption2).foregroundStyle(.secondary)
            Text(value).font(.subheadline.bold().monospacedDigit()).foregroundStyle(color ?? .primary)
        }
    }

    private func regimeRow(_ g: Regime, index i: Int, lines ls: [Line]) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(g.kind == .up ? "▲ 상승" : g.kind == .down ? "▼ 하락" : "– 횡보")
                    .font(.subheadline.bold())
                    .foregroundStyle(g.kind == .up ? Theme.positive : g.kind == .down ? Theme.negative : .secondary)
                Text("\(String(g.start.description.prefix(7))) ~ \(String(g.end.description.prefix(7))) · \(g.weeks)주")
                    .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                Spacer()
                Text("B&H \(Fmt.pct(g.benchmarkReturn))").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            }
            ForEach(ls, id: \.key) { line in
                let entry = Regimes.entry(firstTrade: line.row.result.firstTrade, g)
                HStack(spacing: 6) {
                    LegendSwatch(color: line.color)
                    Text(line.label).font(.caption)
                    Spacer()
                    if entry == .before {
                        Text("첫 매매 전").font(.caption).foregroundStyle(.tertiary)
                    } else if let v = line.row.regimeReturns[i] {
                        Text("\(Fmt.pct(v))\(entry == .partial ? "*" : "") (\(Fmt.pp(v - g.benchmarkReturn)))")
                            .font(.caption.monospacedDigit().bold()).foregroundStyle(Theme.signed(v))
                    }
                }
            }
        }
        .padding(.vertical, 2)
    }
}

/// 파라미터 하나 입력. 범위 안에서 스테퍼로 움직이거나 직접 넣는다.
struct ParamField: View {
    let spec: ParamSpec
    @Binding var value: Double
    let original: Double

    /// 실수 파라미터의 스테퍼 간격 — 범위의 1/20 근처의 1·2·5 단위
    private var step: Double {
        if spec.isInt { return 1 }
        let raw = (spec.range.upperBound - spec.range.lowerBound) / 20
        let mag = pow(10, (log10(raw)).rounded(.down))
        let f = raw / mag
        return (f < 2 ? 1 : f < 5 ? 2 : 5) * mag
    }

    var body: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                Text(ParamText.label(spec.name)).font(.subheadline)
                    .foregroundStyle(value != original ? Color.orange : .primary)
                Text("\(Fmt.param(spec.range.lowerBound))–\(Fmt.param(spec.range.upperBound))")
                    .font(.caption2).foregroundStyle(.tertiary)
            }
            Spacer()
            TextField("값", value: $value, format: .number.precision(.fractionLength(0...4)))
                .keyboardType(spec.isInt ? .numberPad : .decimalPad)
                .multilineTextAlignment(.trailing)
                .frame(width: 72)
                .textFieldStyle(.roundedBorder)
            Stepper("", value: Binding(get: { value }, set: { value = spec.isInt ? $0.rounded() : (($0 * 10_000).rounded() / 10_000) }),
                    in: spec.range, step: step)
                .labelsHidden()
        }
    }
}

/// 변형 목록이 바뀌었는지 가르는 키 (파라미터 이름순)
func paramsKey(_ params: [String: Double]) -> String {
    params.keys.sorted().map { "\($0)=\(params[$0]!)" }.joined(separator: ",")
}
