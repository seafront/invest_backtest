import BacktestCore
import SwiftUI

/// Strategy Tear Sheet · 전략 성과 리포트 (웹 /results/:id).
///
/// Leaderboard 와 같은 시세·조건으로 전략 하나를 다시 돌려 만든다. 계산 구간을 좁히면 그 구간으로
/// 다시 돌린다. 웹 결과 화면의 파라미터 비교와 최적화는 아직 없다 — 모두 기본 파라미터 결과다.
struct TearSheetView: View {
    let model: LeaderboardModel
    let route: TearSheetRoute
    @State private var report: StrategyReport?
    @State private var error: String?
    /// 계산 구간. nil 이면 Leaderboard 와 같은 전체 구간.
    @State private var period: ClosedRange<Day>?
    /// 파라미터 비교에 넣은 변형 (직접 입력·최적값 찾기)
    @State private var variants: [Variant] = []

    init(model: LeaderboardModel, route: TearSheetRoute) {
        self.model = model
        self.route = route
        _period = State(initialValue: route.period)
    }

    private var strategyName: String { route.strategy }
    @State private var computing = false
    /// 좁힌 구간을 계산하지 못했을 때. 직전 화면은 남겨 두고 사유만 보여 준다.
    @State private var periodFailure: String?

    var body: some View {
        Group {
            if let report {
                content(report)
            } else if let error {
                ContentUnavailableView("계산하지 못했습니다", systemImage: "exclamationmark.triangle", description: Text(error))
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Tear Sheet")
        .navigationBarTitleDisplayMode(.inline)
        #if DEBUG
        // 화면 확인용: -debugMonths 12 면 "최근 1년" 구간으로 연다
        .onAppear {
            let m = UserDefaults.standard.integer(forKey: "debugMonths")
            if m > 0, period == nil, let r = model.result { period = r.endDate.monthsBefore(m)...r.endDate }
            // -debugVariant "fast_period=20,slow_period=100" 이면 그 변형을 비교에 넣고 연다
            if variants.isEmpty, let v = UserDefaults.standard.string(forKey: "debugVariant") {
                let params = Dictionary(uniqueKeysWithValues: v.split(separator: ",").compactMap { kv -> (String, Double)? in
                    let parts = kv.split(separator: "=")
                    return parts.count == 2 ? (String(parts[0]), Double(parts[1]) ?? 0) : nil
                })
                let base = Strategies.all.first { $0.name == strategyName }!
                variants = [Variant(id: 1, color: 1, params: base.with(params).resolvedParams)]
            }
        }
        #endif
        .task(id: period) {
            computing = true
            defer { computing = false }
            do {
                report = try await model.report(for: strategyName, params: route.params, period: period)
                periodFailure = nil
            } catch {
                if report == nil { self.error = error.localizedDescription } else { periodFailure = error.localizedDescription }
            }
        }
    }

    private func content(_ r: StrategyReport) -> some View {
        let currency = Currency(ticker: r.ticker)
        #if DEBUG
        // 화면 확인용: -debugSkip N 이면 앞 섹션 N개를 건너뛴다 (시뮬레이터는 명령으로 스크롤할 수 없다)
        let skip = UserDefaults.standard.integer(forKey: "debugSkip")
        #else
        let skip = 0
        #endif
        return List {
            if skip < 1 { header(r, currency) }
            if skip < 1, let full = model.result.map({ $0.startDate...$0.endDate }) {
                PeriodPicker(full: full, period: $period, loading: computing, failure: periodFailure)
            }
            if !r.params.isEmpty {
                if skip < 2 { paramsSection(r) }
                if skip < 3 { ParamCompareSection(model: model, report: r, period: period, variants: $variants) }
                if skip < 4 {
                    OptimizerSection(model: model, report: r, period: period) { params in
                        ParamCompareSection.add(params, to: &variants, specs: r.params, original: r.values)
                    }
                }
            }
            if skip < 5 { metricsSection(r, currency) }
            if skip < 6 { returnSection(r) }
            if skip < 7, !r.isBenchmark { rollingSection(r) }
            if skip < 8, !r.regimes.isEmpty { regimeSection(r) }
            if skip < 9 { Section {
                EquityChart(report: r, currency: currency).frame(height: 200).padding(.vertical, 6)
            } header: {
                Text("평가금액")
            } footer: {
                Text(r.mode == .dca
                     ? "현금 + 주식. 매달 넣은 돈이 쌓이면서 오르는 부분도 들어 있어, 수익률은 곡선 높이가 아니라 위 지표로 봅니다."
                     : "현금 + 주식의 날짜별 합계입니다.")
            } }
            PriceSection(report: r, currency: currency)
            tradeSection(r, currency)
        }
        .listStyle(.insetGrouped)
    }

    // MARK: 머리말

    private func header(_ r: StrategyReport, _ c: Currency) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 6) {
                Text("STRATEGY TEAR SHEET · 전략 성과 리포트")
                    .font(.caption2.weight(.semibold)).foregroundStyle(.secondary).tracking(0.8)
                Text("\(r.ticker) — \(r.displayName)").font(.title3.bold())
                Text(model.name(for: r.ticker)).font(.subheadline).foregroundStyle(.secondary)
                Text("\(r.dataStart.description) ~ \(r.dataEnd.description)")
                    .font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
                Text(r.mode == .dca
                     ? "적립식 · 매달 \(Fmt.money(r.monthlyContribution, c))"
                     : "거치식 · 초기 자본 \(Fmt.money(r.initialCapital, c))")
                    .font(.subheadline)
                Text(r.summary).font(.caption).foregroundStyle(.secondary).padding(.top, 2)
                NavigationLink(value: GuideRoute(strategy: r.strategyName)) {
                    Label("전략 가이드에서 작동 원리 보기", systemImage: "book").font(.caption)
                }
            }
        }
    }

    // MARK: 파라미터

    private func paramsSection(_ r: StrategyReport) -> some View {
        Section("전략 파라미터") {
            ForEach(r.params, id: \.name) { p in
                let v = r.values[p.name] ?? p.defaultValue
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(p.name.replacingOccurrences(of: "_", with: " ")).font(.subheadline)
                        Text(p.description).font(.caption).foregroundStyle(.secondary)
                        Text("기본값 \(Fmt.param(p.defaultValue)) · 범위 \(Fmt.param(p.range.lowerBound))–\(Fmt.param(p.range.upperBound))")
                            .font(.caption2).foregroundStyle(.tertiary)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(Fmt.param(v)).font(.title3.bold().monospacedDigit())
                        if v != p.defaultValue {
                            Text("기본값에서 변경").font(.caption2.bold()).foregroundStyle(.orange)
                        }
                    }
                }
            }
        }
    }

    // MARK: 성과 지표

    private func metricsSection(_ r: StrategyReport, _ c: Currency) -> some View {
        let dca = r.mode == .dca
        var tiles: [(String, String, Color)] = [
            ("Total Return", Fmt.pct(r.totalReturn, digits: 2), Theme.signed(r.totalReturn)),
            (dca ? "IRR (연환산)" : "CAGR", Fmt.pct(r.cagr, digits: 2), Theme.signed(r.cagr)),
        ]
        if dca { tiles.append(("Total Invested", Fmt.money(r.totalInvested, c), .primary)) }
        tiles += [
            ("Final Value", Fmt.money(r.finalValue, c), .primary),
            ("Sharpe Ratio", r.sharpeRatio.formatted(.number.precision(.fractionLength(2))),
             r.sharpeRatio >= 1 ? Theme.positive : .primary),
            ("Max Drawdown", "-\(r.maxDrawdown.formatted(.number.precision(.fractionLength(2))))%", Theme.negative),
            ("Win Rate", "\(r.winRate.formatted(.number.precision(.fractionLength(1))))%", .primary),
            ("청산 횟수", "\(r.trades.filter { $0.action == .sell }.count)회", .primary),
        ]
        return Section {
            LazyVGrid(columns: [GridItem(.flexible(), alignment: .leading), GridItem(.flexible(), alignment: .leading)],
                      spacing: 14) {
                ForEach(tiles, id: \.0) { label, value, color in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(label).font(.caption).foregroundStyle(.secondary)
                        Text(value).font(.headline.monospacedDigit()).foregroundStyle(color)
                            .lineLimit(1).minimumScaleFactor(0.7)
                    }
                }
            }
            .padding(.vertical, 6)
        } header: {
            Text("성과 지표")
        } footer: {
            Text("Sharpe 는 연환산, 무위험수익률 2%. Win Rate 는 청산한 매매 중 이익을 낸 비율로, 성과 지표가 아닙니다.")
        }
    }

    // MARK: 누적 수익률 · 롤링

    private func returnSection(_ r: StrategyReport) -> some View {
        Section {
            TearSheetReturnChart(report: r).frame(height: 230).padding(.vertical, 6)
            HStack(spacing: 14) {
                legend(Theme.series[0], r.displayName, dashed: false, value: r.curve.last?.ret)
                if !r.isBenchmark { legend(Theme.benchmark, "Buy & Hold", dashed: true, value: r.benchmarkCurve.last?.ret) }
            }
            .font(.caption)
        } header: {
            Text("누적 수익률")
        } footer: {
            Text(r.regimes.isEmpty ? "" : "배경 초록은 상승 구간, 빨강은 하락 구간입니다 (아래 추세 구간별 성과).")
        }
    }

    private func legend(_ color: Color, _ name: String, dashed: Bool, value: Double?) -> some View {
        HStack(spacing: 5) {
            Capsule().stroke(color, style: StrokeStyle(lineWidth: 2.5, dash: dashed ? [3, 2] : []))
                .frame(width: 14, height: 2)
            Text(name).lineLimit(1)
            if let value { Text(Fmt.pct(value)).monospacedDigit().foregroundStyle(Theme.signed(value)) }
        }
    }

    private func rollingSection(_ r: StrategyReport) -> some View {
        let points = r.curve.count
        let weeks = Rolling.allowed(weeks: model.windowWeeks, points: points)
            ? model.windowWeeks
            : Rolling.windows.reversed().first { Rolling.allowed(weeks: $0.weeks, points: points) }?.weeks
        let stats = weeks.flatMap { Rolling.vsBenchmark(r.curve, bench: r.benchmarkCurve, weeks: $0) }
        let excess = weeks.map { Rolling.excess(r.curve, bench: r.benchmarkCurve, weeks: $0) } ?? []
        let label = Rolling.windows.first { $0.weeks == weeks }?.label ?? ""

        return Section {
            HStack(spacing: 6) {
                ForEach(Rolling.windows) { w in
                    Button(w.label) { model.windowWeeks = w.weeks }
                        .buttonStyle(.bordered)
                        .tint(weeks == w.weeks ? .accentColor : .gray)
                        .fontWeight(weeks == w.weeks ? .bold : .regular)
                        .disabled(!Rolling.allowed(weeks: w.weeks, points: points))
                }
            }
            .font(.subheadline)
            if let stats {
                HStack(spacing: 20) {
                    VStack(alignment: .leading) {
                        Text("B&H 승률").font(.caption).foregroundStyle(.secondary)
                        Text("\(Int(stats.winRate.rounded()))%").font(.title3.bold().monospacedDigit())
                            .foregroundStyle(stats.winRate > 50 ? Theme.positive : .primary)
                    }
                    VStack(alignment: .leading) {
                        Text("초과 중앙값").font(.caption).foregroundStyle(.secondary)
                        Text(Fmt.pp(stats.medianExcess)).font(.title3.bold().monospacedDigit())
                            .foregroundStyle(Theme.signed(stats.medianExcess))
                    }
                    Spacer()
                    Text("\(label) 구간 \(stats.windows)개").font(.caption).foregroundStyle(.secondary)
                }
                ExcessChart(points: excess, range: (r.curve.first?.date, r.curve.last?.date))
                    .frame(height: 160).padding(.vertical, 4)
            }
        } header: {
            Text("B&H 대비 롤링 초과수익")
        } footer: {
            Text("구간 끝 날짜마다 \"직전 \(label) 동안 전략 − B&H\"입니다. 0선 위면 그 구간은 B&H를 이겼습니다.")
        }
    }

    // MARK: 추세 구간

    private func regimeSection(_ r: StrategyReport) -> some View {
        let up = Regimes.capture(r.regimeReturns, regimes: r.regimes, firstTrade: r.firstTrade, kind: .up)
        let down = Regimes.capture(r.regimeReturns, regimes: r.regimes, firstTrade: r.firstTrade, kind: .down)
        return Section {
            ForEach(Array(r.regimes.enumerated()), id: \.element.id) { i, g in
                RegimeRow(regime: g, value: r.regimeReturns[i],
                          entry: Regimes.entry(firstTrade: r.firstTrade, g), isBenchmark: r.isBenchmark)
            }
            if !r.isBenchmark {
                HStack {
                    captureTile("상승 구간 포착률", up, better: "높을수록 추세를 잘 따라감")
                    captureTile("하락 구간 노출률", down, better: "낮을수록 방어를 잘함")
                }
            }
        } header: {
            Text("추세 구간별 성과")
        } footer: {
            Text("Buy & Hold 가 고점·저점에서 \(Int((r.regimeThreshold * 100).rounded()))% 넘게 되돌린 곳을 전환점으로 나눴습니다(종목 변동성에 비례). 전환점은 지나고 나서야 확정되므로 과거를 설명하는 구분이지 매매 신호가 아닙니다.")
        }
    }

    private func captureTile(_ label: String, _ v: Double?, better: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(v.map { "\(Int($0.rounded()))%" } ?? "—").font(.title3.bold().monospacedDigit())
            Text(better).font(.caption2).foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: 매매 기록

    private func tradeSection(_ r: StrategyReport, _ c: Currency) -> some View {
        // 누적 손익은 SELL 줄에서만 늘어난다. 아직 들고 있는 포지션의 평가손익은 넣지 않는다.
        var cum = 0.0
        let rows = r.trades.enumerated().map { i, t -> (Int, Trade, Double?) in
            if t.action == .sell { cum += t.pnl; return (i + 1, t, cum) }
            return (i + 1, t, nil)
        }
        return Section {
            if rows.isEmpty {
                Text("기간 안에 매매가 없었습니다").foregroundStyle(.secondary)
            }
            ForEach(rows, id: \.0) { n, t, cumPnl in
                HStack(alignment: .firstTextBaseline) {
                    Text("\(n)").font(.caption.monospacedDigit()).foregroundStyle(.tertiary).frame(width: 28, alignment: .leading)
                    VStack(alignment: .leading, spacing: 1) {
                        HStack(spacing: 6) {
                            Text(t.action.rawValue).font(.caption.bold())
                                .foregroundStyle(t.action == .buy ? Theme.positive : Theme.negative)
                            Text(t.date.description).font(.caption.monospacedDigit())
                        }
                        Text("\(t.shares.formatted())주 × \(Fmt.price(t.price, c))")
                            .font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
                    }
                    Spacer()
                    if t.action == .sell {
                        VStack(alignment: .trailing, spacing: 1) {
                            Text(Fmt.money(t.pnl, c)).font(.caption.monospacedDigit()).foregroundStyle(Theme.signed(t.pnl))
                            if let cumPnl {
                                Text("누적 \(Fmt.money(cumPnl, c))").font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
        } header: {
            Text("매매 기록 · \(r.trades.count)건")
        } footer: {
            Text(r.mode == .dca ? "체결가는 신호가 난 날의 종가입니다. 적립식의 월 자동 매수도 BUY 로 나옵니다." : "체결가는 신호가 난 날의 종가입니다. 수수료·세금은 넣지 않았습니다.")
        }
    }
}

private struct RegimeRow: View {
    let regime: Regime
    let value: Double?
    let entry: Regimes.Entry
    let isBenchmark: Bool

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 1) {
                Text(kindLabel).font(.subheadline.bold()).foregroundStyle(kindColor)
                Text("\(month(regime.start)) ~ \(month(regime.end)) · \(regime.weeks)주")
                    .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 1) {
                Text("B&H \(Fmt.pct(regime.benchmarkReturn))").font(.caption.monospacedDigit())
                    .foregroundStyle(isBenchmark ? Theme.signed(regime.benchmarkReturn) : .secondary)
                if !isBenchmark { strategyValue }
            }
        }
    }

    @ViewBuilder
    private var strategyValue: some View {
        if entry == .before {
            Text("첫 매매 전").font(.caption).foregroundStyle(.tertiary)
        } else if let value {
            let diff = value - regime.benchmarkReturn
            Text("\(Fmt.pct(value))\(entry == .partial ? "*" : "") (\(Fmt.pp(diff)))")
                .font(.subheadline.monospacedDigit().bold())
                .foregroundStyle(Theme.signed(value))
        }
    }

    private var kindLabel: String {
        switch regime.kind {
        case .up: "▲ 상승"
        case .down: "▼ 하락"
        case .flat: "– 횡보"
        }
    }

    private var kindColor: Color {
        switch regime.kind {
        case .up: Theme.positive
        case .down: Theme.negative
        case .flat: .secondary
        }
    }

    private func month(_ d: Day) -> String { String(d.description.prefix(7)) }
}
