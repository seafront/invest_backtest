import BacktestCore
import Charts
import SwiftUI

/// 목표에 맞는 값 찾기 (웹 components/ParamOptimizer.tsx).
///
/// 계산 구간의 앞 60% 로 고르고 뒤 40% 로 검증한다. 한 점의 최고 점수보다 주변 조합까지 고르게 좋은
/// 값(고원)을 추천한다. 폰에서 계산하므로 서버 없이 몇 초면 끝난다.
struct OptimizerSection: View {
    let model: LeaderboardModel
    let report: StrategyReport
    let period: ClosedRange<Day>?
    /// 변형으로 넣는다. 못 넣으면 사유.
    let onAdd: ([String: Double]) -> String?

    @State private var goal: Optimizer.Goal = .consistency
    @State private var minEntries = 1
    @State private var maxMDD: Double?
    @State private var result: Optimizer.Result?
    @State private var resultGoal: Optimizer.Goal = .consistency
    @State private var failure: String?
    @State private var notice: String?
    @State private var running = false
    @State private var progress = OptimizeProgress()
    @State private var control: OptimizeControl?
    @State private var view: ScoreView = .robust
    @State private var axisX = 0
    @State private var axisY = 1

    enum ScoreView: String, CaseIterable, Identifiable {
        case robust, inSample, outOfSample
        var id: String { rawValue }
        var label: String {
            switch self {
            case .robust: "고원 점수"
            case .inSample: "선택 구간"
            case .outOfSample: "검증 구간"
            }
        }

        func value(_ r: Optimizer.Row) -> Double? {
            switch self {
            case .robust: r.scoreRobust
            case .inSample: r.scoreIn
            case .outOfSample: r.scoreOut
            }
        }
    }

    private var span: ClosedRange<Day>? {
        period ?? model.result.map { $0.startDate...$0.endDate }
    }

    private var periodBlock: String? {
        guard let span else { return "계산 구간을 먼저 고르세요" }
        return span.upperBound - span.lowerBound < Optimizer.minSpanDays
            ? "계산 구간이 1년 이상이어야 선택·검증 구간으로 나눌 수 있습니다" : nil
    }

    var body: some View {
        Section {
            Picker("목표", selection: $goal) {
                ForEach(Optimizer.Goal.allCases) { Text($0.label).tag($0) }
            }
            Text(goal.summary).font(.caption).foregroundStyle(.secondary)
            Stepper("최소 진입 \(minEntries)회", value: $minEntries, in: 0...50)
            if goal == .riskAdjusted {
                HStack {
                    Text("최대 낙폭 한도")
                    Spacer()
                    TextField("없음", value: $maxMDD, format: .number)
                        .keyboardType(.decimalPad)
                        .multilineTextAlignment(.trailing)
                        .frame(width: 70)
                    Text("%").foregroundStyle(.secondary)
                }
            }
            if running {
                VStack(alignment: .leading, spacing: 4) {
                    ProgressView(value: Double(progress.done), total: Double(max(progress.total, 1)))
                    HStack {
                        Text("조합 \(progress.done)/\(progress.total) 계산 중").font(.caption).foregroundStyle(.secondary)
                        Spacer()
                        Button("멈추기", role: .cancel) { control?.cancel() }.font(.caption)
                    }
                }
            } else {
                Button { Task { await run() } } label: {
                    Label("최적값 찾기", systemImage: "wand.and.stars").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(periodBlock != nil)
            }
            if let failure { Text(failure).font(.caption).foregroundStyle(Theme.negative) }
            if let notice { Text(notice).font(.caption).foregroundStyle(.secondary) }
        } header: {
            Text("목표에 맞는 값 찾기")
        } footer: {
            Text(periodBlock ?? "계산 구간 \(span.map { "\($0.lowerBound) ~ \($0.upperBound)" } ?? "")의 앞 60%로 고르고 뒤 40%로 검증합니다. 최소 진입은 선택 구간에서 적어도 몇 번 포지션에 들어가야 후보로 인정할지입니다(느린 전략 1~2회, 잦은 전략 5~10회).")
        }

        if let result { resultSections(result) }
        #if DEBUG
        // 화면 확인용: -debugOptimize consistency 면 그 목표로 바로 찾는다
        Color.clear.frame(height: 0).listRowBackground(Color.clear)
            .task {
                guard result == nil, !running,
                      let g = UserDefaults.standard.string(forKey: "debugOptimize").flatMap(Optimizer.Goal.init) else { return }
                goal = g
                await run()
            }
        #endif
    }

    // MARK: 실행

    private func run() async {
        guard let span else { return }
        let control = OptimizeControl()
        self.control = control
        let box = progress
        box.done = 0
        box.total = 0
        running = true
        failure = nil
        notice = nil
        defer { running = false; self.control = nil }
        do {
            let goal = goal
            let res = try await model.optimize(
                report.strategyName, original: report.values, period: period ?? span, goal: goal,
                minTrades: minEntries, maxMDD: goal == .riskAdjusted ? maxMDD : nil
            ) { done, total in
                if done % 5 == 0 || done == total {
                    Task { @MainActor in box.done = done; box.total = total }
                }
                return !control.cancelled
            }
            result = res
            resultGoal = goal
            axisX = 0
            axisY = min(1, res.axes.count - 1)
        } catch is CancellationError {
            notice = "멈췄습니다"
        } catch {
            failure = error.localizedDescription
        }
    }

    private func add(_ params: [String: Double]) {
        notice = onAdd(params) ?? "비교에 추가했습니다: \(ParamText.of(params, specs: report.params))"
    }

    // MARK: 결과

    @ViewBuilder
    private func resultSections(_ res: Optimizer.Result) -> some View {
        #if DEBUG
        // 화면 확인용: -debugHidePicks YES 면 결과 카드를 숨겨 히트맵을 위로 올린다
        let hidePicks = UserDefaults.standard.bool(forKey: "debugHidePicks")
        #else
        let hidePicks = false
        #endif
        if !hidePicks { picksSection(res) }

        if res.axes.count >= 2 {
            heatmapSection(res)
        } else if res.axes.count == 1 {
            oneParamSection(res)
        }

        Section("고원 점수 상위 10개") {
            let top = res.rows.filter { $0.scoreRobust != nil && $0.excluded == nil }.prefix(10)
            ForEach(Array(top)) { r in topRow(r, res) }
        }
    }

    private func picksSection(_ res: Optimizer.Result) -> some View {
        Section {
            Text("선택 구간 \(res.startDate) ~ \(res.splitDate) · 검증 구간 ~ \(res.endDate)")
                .font(.caption.monospacedDigit())
            Text(res.random
                 ? "조합이 \(res.gridSize)개라 무작위로 뽑고 상위 근처를 더 봐서 \(res.evaluated)개를 계산했습니다."
                 : "격자 전체 \(res.evaluated)개 조합을 계산했습니다.")
                .font(.caption).foregroundStyle(.secondary)
            PickCard(symbol: "★", label: "안정 추천", hint: "주변 조합까지 고르게 좋은 값", row: res.row(res.recommended),
                     res: res, goal: resultGoal, specs: report.params, route: route, onAdd: add)
            PickCard(symbol: "▲", label: "최고점", hint: "선택 구간 한 점의 최고 점수 — 과최적화됐을 수 있다",
                     row: res.row(res.peak), res: res, goal: resultGoal, specs: report.params, route: route, onAdd: add)
            PickCard(symbol: "○", label: "원래 값", hint: "지금 결과의 파라미터", row: res.row(res.original),
                     res: res, goal: resultGoal, specs: report.params, route: nil, onAdd: nil)
        } header: {
            Text("\(resultGoal.label) · 결과")
        }
    }

    private func route(_ params: [String: Double]) -> TearSheetRoute {
        TearSheetRoute(strategy: report.strategyName, params: params, period: period)
    }

    private func heatmapSection(_ res: Optimizer.Result) -> some View {
        let ax = res.axes[min(axisX, res.axes.count - 1)]
        let ay = res.axes[min(axisY, res.axes.count - 1)]
        // 3개 이상이면 칸(두 파라미터 값)마다 나머지 파라미터 중 가장 좋은 조합을 대표로 쓴다
        var cells: [String: Optimizer.Row] = [:]
        for r in res.rows {
            let k = "\(r.params[ax.name]!)|\(r.params[ay.name]!)"
            let v = view.value(r)
            guard let cur = cells[k] else { cells[k] = r; continue }
            guard v != nil else { continue }
            let better = (r.excluded == nil) != (cur.excluded == nil)
                ? r.excluded == nil : (v ?? -.infinity) > (view.value(cur) ?? -.infinity)
            if better { cells[k] = r }
        }
        let values = cells.values.filter { $0.excluded == nil }.compactMap { view.value($0) }
        let (lo, hi) = (values.min() ?? 0, values.max() ?? 1)
        let marks: [(String, [String: Double]?)] = [("★", res.recommended), ("▲", res.peak), ("○", res.original)]

        return Section {
            if res.axes.count > 2 {
                HStack {
                    Picker("가로", selection: $axisX) {
                        ForEach(res.axes.indices, id: \.self) { Text(ParamText.label(res.axes[$0].name)).tag($0) }
                    }
                    Picker("세로", selection: $axisY) {
                        ForEach(res.axes.indices, id: \.self) { Text(ParamText.label(res.axes[$0].name)).tag($0) }
                    }
                }
                .pickerStyle(.menu)
                .font(.caption)
            }
            Picker("점수", selection: $view) {
                ForEach(ScoreView.allCases) { Text($0.label).tag($0) }
            }
            .pickerStyle(.segmented)

            // 칸은 값이 아니라 칸 번호로 그린다 — 간격이 고르지 않은 축(원래 값을 끼워 넣은 축)도 같은 크기의 칸
            Chart {
                ForEach(Array(ax.values.enumerated()), id: \.offset) { i, x in
                    ForEach(Array(ay.values.enumerated()), id: \.offset) { j, y in
                        let cell = cells["\(x)|\(y)"]
                        let v = cell.flatMap { view.value($0) }
                        RectangleMark(xStart: .value("x", Double(i)), xEnd: .value("x", Double(i + 1)),
                                      yStart: .value("y", Double(j)), yEnd: .value("y", Double(j + 1)))
                            .foregroundStyle(cellColor(cell, v, lo, hi))
                            .annotation(position: .overlay) {
                                let sym = marks.first { m in
                                    m.1.map { $0[ax.name] == x && $0[ay.name] == y } ?? false
                                }?.0
                                if let sym { Text(sym).font(.caption2.bold()).foregroundStyle(.white).shadow(radius: 1) }
                            }
                    }
                }
            }
            .chartXScale(domain: 0...Double(ax.values.count))
            .chartYScale(domain: 0...Double(ay.values.count))
            .chartXAxis {
                AxisMarks(values: ax.values.indices.map { Double($0) + 0.5 }) { v in
                    AxisValueLabel {
                        if let d = v.as(Double.self), ax.values.indices.contains(Int(d)) { Text(Fmt.param(ax.values[Int(d)])) }
                    }
                }
            }
            .chartYAxis {
                AxisMarks(position: .leading, values: ay.values.indices.map { Double($0) + 0.5 }) { v in
                    AxisValueLabel {
                        if let d = v.as(Double.self), ay.values.indices.contains(Int(d)) { Text(Fmt.param(ay.values[Int(d)])) }
                    }
                }
            }
            .chartXAxisLabel(ParamText.label(ax.name), alignment: .center)
            .chartYAxisLabel(ParamText.label(ay.name), position: .leading)
            .frame(height: 300)
            .padding(.vertical, 4)
        } header: {
            Text("히트맵")
        } footer: {
            Text("밝을수록 점수가 높습니다. 회색 칸은 제약 위반(추천 제외)입니다. 밝은 칸이 넓게 뭉쳐 있으면 안정적인 값이고, 한 칸만 밝으면 우연일 가능성이 큽니다.\(res.axes.count > 2 ? " 칸마다 나머지 파라미터 중 가장 좋은 조합의 점수입니다." : "")")
        }
    }

    private func cellColor(_ cell: Optimizer.Row?, _ v: Double?, _ lo: Double, _ hi: Double) -> Color {
        guard let cell, let v else { return Color.secondary.opacity(0.08) }
        if cell.excluded != nil { return Color.secondary.opacity(0.3) }
        let t = hi > lo ? (v - lo) / (hi - lo) : 1
        // 남색 → 청록 → 노랑 (색각이상에도 밝기로 구분된다)
        let stops: [(Double, Double, Double)] = [(0.17, 0.11, 0.38), (0.08, 0.57, 0.55), (0.99, 0.88, 0.25)]
        let (a, b, f) = t < 0.5 ? (stops[0], stops[1], t * 2) : (stops[1], stops[2], (t - 0.5) * 2)
        return Color(red: a.0 + (b.0 - a.0) * f, green: a.1 + (b.1 - a.1) * f, blue: a.2 + (b.2 - a.2) * f)
    }

    private func oneParamSection(_ res: Optimizer.Result) -> some View {
        let ax = res.axes[0]
        let rows = res.rows.sorted { $0.params[ax.name]! < $1.params[ax.name]! }
        return Section("값에 따른 점수") {
            Chart {
                ForEach(ScoreView.allCases) { s in
                    ForEach(rows) { r in
                        if let v = s.value(r) {
                            LineMark(x: .value(ax.name, r.params[ax.name]!), y: .value("점수", v), series: .value("s", s.label))
                                .foregroundStyle(by: .value("s", s.label))
                        }
                    }
                }
            }
            .frame(height: 220)
        }
    }

    private func topRow(_ r: Optimizer.Row, _ res: Optimizer.Result) -> some View {
        let dropped = PickCard.dropped(r)
        let conc = r.full?.concentration
        return VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(ParamText.of(r.params, specs: report.params)).font(.caption.bold())
                if r.params == res.recommended { Text("★").font(.caption.bold()) }
                if r.params == res.original { Text("○").font(.caption).foregroundStyle(.secondary) }
                Spacer()
                Button("비교에 추가") { add(r.params) }.font(.caption).buttonStyle(.borderless)
            }
            Text("고원 \(PickCard.score(resultGoal, r.scoreRobust)) · 선택 \(PickCard.score(resultGoal, r.scoreIn)) · 검증 \(PickCard.score(resultGoal, r.scoreOut))")
                .font(.caption.monospacedDigit())
                .foregroundStyle(dropped ? Theme.negative : .primary)
            Text("CAGR \(PickCard.pct(r.inSample?.cagr)) / \(PickCard.pct(r.outOfSample?.cagr)) · MDD -\(r.full.map { String(format: "%.1f", $0.maxDrawdown) } ?? "—")% · 진입 \(r.full.map { "\($0.entries)" } ?? "—") · 집중도 \(conc.map { "\(Int($0.rounded()))%" } ?? "—")")
                .font(.caption2.monospacedDigit())
                .foregroundStyle(conc.map { $0 > Optimizer.concentrationWarn } == true ? Color.orange : .secondary)
        }
    }
}

/// ★ 안정 추천 / ▲ 최고점 / ○ 원래 값 카드
private struct PickCard: View {
    let symbol: String
    let label: String
    let hint: String
    let row: Optimizer.Row?
    let res: Optimizer.Result
    let goal: Optimizer.Goal
    let specs: [ParamSpec]
    let route: (([String: Double]) -> TearSheetRoute)?
    let onAdd: (([String: Double]) -> Void)?

    /// 검증 구간에서 점수가 크게 떨어졌다 — 선택 구간에 맞춰진 값일 가능성이 높다
    static func dropped(_ r: Optimizer.Row) -> Bool {
        guard let i = r.scoreIn, let o = r.scoreOut else { return false }
        return o < i - Swift.max(abs(i) * 0.5, 1e-9)
    }

    /// 목표별 점수 표기. 하락 방어는 부호를 되돌려 노출률로 보인다.
    static func score(_ goal: Optimizer.Goal, _ v: Double?) -> String {
        guard let v else { return "—" }
        switch goal {
        case .consistency: return String(format: "%.1f점", v)
        case .riskAdjusted: return String(format: "%.2f", v)
        case .defense: return String(format: "노출 %.0f%%", -v)
        case .trend: return String(format: "포착 %.0f%%", v)
        case .maxReturn: return "\(v > 0 ? "+" : "")\(String(format: "%.1f", v))%"
        }
    }

    static func pct(_ v: Double?) -> String { v.map { Fmt.pct($0) } ?? "—" }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("\(symbol) \(label)").font(.subheadline.bold())
                Spacer()
                if let row, let onAdd {
                    Button("비교에 추가") { onAdd(row.params) }.buttonStyle(.bordered).font(.caption)
                }
                if let row, let route {
                    NavigationLink(value: route(row.params)) { Text("Tear Sheet").font(.caption) }.fixedSize()
                }
            }
            if let row {
                Text(ParamText.of(row.params, specs: specs)).font(.caption)
                Grid(alignment: .trailing, horizontalSpacing: 12, verticalSpacing: 3) {
                    GridRow {
                        Text("").gridColumnAlignment(.leading)
                        Text("선택 구간").foregroundStyle(.secondary)
                        Text("검증 구간").foregroundStyle(.secondary)
                    }
                    GridRow {
                        Text("목표 점수").foregroundStyle(.secondary)
                        Text(Self.score(goal, row.scoreIn))
                        Text(Self.score(goal, row.scoreOut)).bold()
                            .foregroundStyle(Self.dropped(row) ? Theme.negative : .primary)
                    }
                    GridRow {
                        Text("CAGR").foregroundStyle(.secondary)
                        Text("\(Self.pct(row.inSample?.cagr)) / \(Self.pct(res.benchmarkIn?.cagr))")
                        Text("\(Self.pct(row.outOfSample?.cagr)) / \(Self.pct(res.benchmarkOut?.cagr))")
                    }
                    GridRow {
                        Text("MDD").foregroundStyle(.secondary)
                        Text(row.inSample.map { String(format: "-%.1f%%", $0.maxDrawdown) } ?? "—")
                        Text(row.outOfSample.map { String(format: "-%.1f%%", $0.maxDrawdown) } ?? "—")
                    }
                    GridRow {
                        Text("진입").foregroundStyle(.secondary)
                        Text(row.inSample.map { "\($0.entries)회" } ?? "—")
                        Text(row.outOfSample.map { "\($0.entries)회" } ?? "—")
                    }
                }
                .font(.caption.monospacedDigit())
                Text("CAGR 은 전략 / 같은 구간 B&H").font(.caption2).foregroundStyle(.tertiary)
                if Self.dropped(row) {
                    Text("⚠ 검증 구간에서 점수가 크게 떨어짐 — 선택 구간에 맞춰진 값일 수 있음")
                        .font(.caption2).foregroundStyle(Theme.negative)
                }
                if let c = row.full?.concentration, c > Optimizer.concentrationWarn {
                    Text("⚠ 수익의 \(Int(c.rounded()))%가 추세 구간 하나에서 나옴").font(.caption2).foregroundStyle(.orange)
                }
                if let why = row.excluded {
                    Text("추천 제외: \(why)").font(.caption2).foregroundStyle(.secondary)
                }
            } else {
                Text("조건을 만족하는 조합이 없습니다. 최소 진입이나 한도를 완화해 보세요.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }
}

/// 진행률 (계산은 다른 스레드에서, 표시는 메인에서)
@MainActor
@Observable
final class OptimizeProgress {
    var done = 0
    var total = 0
}

/// 멈추기 버튼 → 계산 스레드
final class OptimizeControl: @unchecked Sendable {
    private let lock = NSLock()
    private var flag = false

    var cancelled: Bool { lock.withLock { flag } }
    func cancel() { lock.withLock { flag = true } }
}
