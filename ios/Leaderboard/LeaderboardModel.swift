import BacktestCore
import Foundation
import Observation

/// 표 한 줄. 롤링 지표는 구간 길이에 따라 화면에서 계산하며, B&H 자신은 nil 이다.
struct Row: Identifiable {
    let result: AutoStrategyResult
    let rollWin: Double?
    let rollExcess: Double?
    var id: String { result.strategyName }
    var isBenchmark: Bool { result.strategyName == Strategies.benchmark }
    /// 롤링 구간의 절반 넘게 B&H 보다 수익이 높았다
    var beatsBenchmark: Bool { (rollWin ?? 0) > 50 }
}

enum SortKey: String, CaseIterable, Identifiable {
    case rollWin, rollExcess, totalReturn, cagr, sharpe, maxDrawdown, winRate, trades
    var id: String { rawValue }

    func label(dca: Bool) -> String {
        switch self {
        case .rollWin: "B&H 승률"
        case .rollExcess: "초과 중앙값"
        case .totalReturn: "총수익률"
        case .cagr: dca ? "IRR" : "CAGR"
        case .sharpe: "Sharpe"
        case .maxDrawdown: "MDD (작은 순)"
        case .winRate: "매매 승률"
        case .trades: "거래 횟수"
        }
    }

    func value(_ r: Row) -> Double? {
        switch self {
        case .rollWin: r.rollWin
        case .rollExcess: r.rollExcess
        case .totalReturn: r.result.totalReturn
        case .cagr: r.result.cagr
        case .sharpe: r.result.sharpeRatio
        case .maxDrawdown: r.result.maxDrawdown
        case .winRate: r.result.winRate
        case .trades: Double(r.result.tradesCount)
        }
    }

    /// MDD 만 작을수록 좋다
    var ascending: Bool { self == .maxDrawdown }
}

@MainActor
@Observable
final class LeaderboardModel {
    static let years = 5
    static let maxPlotted = 4
    static let defaultPlotted = 3

    var ticker: String { didSet { save() } }
    var mode: InvestMode { didSet { save() } }
    /// 금액은 통화별로 따로 들고 있는다. 종목을 AAPL ↔ 005930.KS 로 바꿔도 각자 입력값이 남는다.
    var amounts: [String: [Double]] { didSet { save() } }
    var windowWeeks: Int { didSet { save() } }
    var sortKey: SortKey { didSet { save() } }
    /// 그래프에 켠 전략 → 색 번호. 색은 순위가 아니라 전략에 붙는다 — 다른 전략을 켜고 꺼도
    /// 이미 켜진 선의 색은 바뀌지 않는다.
    var plotted: [String: Int] { didSet { save() } }
    /// 목록에 없어 직접 입력한 티커 (최근 것부터, 시세를 받는 데 성공한 것만)와 Yahoo 가 알려 준 이름
    private(set) var customTickers: [String] { didSet { save() } }
    private(set) var customNames: [String: String] { didSet { save() } }

    private(set) var result: AutoBacktestResult?
    /// 결과를 만든 조건. 폼을 바꿔도 Tear Sheet 는 표와 같은 조건으로 다시 돌린다.
    private(set) var ran: (bars: [Bar], end: Day, capital: Double, monthly: Double)?
    private(set) var loading = false
    var error: String?
    /// 시세를 새로 받지 못해 저장된 시세로 계산했을 때의 안내
    private(set) var notice: String?
    private(set) var pricesFetchedAt: Date?

    private let store = PriceStore()
    private let defaults = UserDefaults.standard

    init() {
        let d = UserDefaults.standard
        ticker = d.string(forKey: "ticker") ?? "AAPL"
        mode = InvestMode(rawValue: d.string(forKey: "mode") ?? "") ?? .lumpSum
        amounts = d.dictionary(forKey: "amounts") as? [String: [Double]] ?? [:]
        windowWeeks = d.object(forKey: "windowWeeks") as? Int ?? 52
        sortKey = SortKey(rawValue: d.string(forKey: "sortKey") ?? "") ?? .rollWin
        plotted = d.dictionary(forKey: "plotted") as? [String: Int] ?? [:]
        customTickers = d.stringArray(forKey: "customTickers") ?? []
        customNames = d.dictionary(forKey: "customNames") as? [String: String] ?? [:]
    }

    private func save() {
        defaults.set(ticker, forKey: "ticker")
        defaults.set(mode.rawValue, forKey: "mode")
        defaults.set(amounts, forKey: "amounts")
        defaults.set(windowWeeks, forKey: "windowWeeks")
        defaults.set(sortKey.rawValue, forKey: "sortKey")
        defaults.set(plotted, forKey: "plotted")
        defaults.set(customTickers, forKey: "customTickers")
        defaults.set(customNames, forKey: "customNames")
    }

    var listing: Listing? { Listing.find(ticker) }

    /// 목록 종목은 목록 이름, 직접 입력한 종목은 Yahoo 이름
    func name(for t: String) -> String { Listing.find(t)?.name ?? customNames[t] ?? "" }

    static let maxCustomTickers = 10
    var currency: Currency { Currency(ticker: ticker) }
    var resultCurrency: Currency { Currency(ticker: result?.ticker ?? ticker) }

    var capital: Double {
        get { amounts[currency.rawValue]?[0] ?? currency.defaultCapital }
        set { amounts[currency.rawValue] = [newValue, monthly] }
    }

    var monthly: Double {
        get { amounts[currency.rawValue]?[1] ?? currency.defaultMonthly }
        set { amounts[currency.rawValue] = [capital, newValue] }
    }

    // MARK: 실행

    /// 앱을 열었을 때 마지막 종목을 바로 보여 준다. 받은 지 한 시간이 안 된 시세는 다시 받지 않는다.
    func restore() async {
        guard result == nil else { return }
        await run(keepPlotted: true)
    }

    /// - Parameter force: 저장된 시세가 최근 것이어도 다시 받는다
    func run(force: Bool = false, keepPlotted: Bool = false) async {
        guard !loading else { return }
        loading = true
        error = nil
        defer { loading = false }

        let ticker = ticker, mode = mode
        let capital = mode == .lumpSum ? capital : 0
        let monthly = mode == .dca ? monthly : 0
        let end = Self.today()
        do {
            let loaded = try await store.load(ticker, from: requiredStart(end: end, years: Self.years),
                                              to: end, force: force)
            let res = try await Task.detached(priority: .userInitiated) {
                try runAutoBacktest(ticker: ticker, bars: loaded.prices.bars, end: end, years: Self.years,
                                    mode: mode, initialCapital: capital, monthlyContribution: monthly)
            }.value
            result = res
            ran = (loaded.prices.bars, end, capital, monthly)
            if Listing.find(ticker) == nil {
                customTickers = Array(([ticker] + customTickers.filter { $0 != ticker }).prefix(Self.maxCustomTickers))
                if let n = loaded.prices.name { customNames[ticker] = n }
            }
            pricesFetchedAt = loaded.prices.fetchedAt
            notice = loaded.fallbackReason.map { "시세를 새로 받지 못해 저장된 시세로 계산했습니다 (\($0))" }
            if !keepPlotted || plotted.keys.contains(where: { name in !res.results.contains { $0.strategyName == name } }) {
                plotted = defaultPlotted(res)
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// 표와 같은 조건으로 전략 하나를 다시 돌린다 (웹의 "상세 보기").
    /// `period` 를 주면 그 구간만 (Tear Sheet 의 계산 구간). 없으면 표와 같은 최근 5년.
    func report(for strategyName: String, params: [String: Double] = [:],
                period: ClosedRange<Day>? = nil) async throws -> StrategyReport {
        let (c, start, end) = try conditions(period)
        let bars = try await bars(from: start.adding(days: -warmupDays(strategyName, [params])))
        return try await Task.detached(priority: .userInitiated) {
            try runStrategyReport(ticker: c.ticker, bars: bars, start: start, end: end, strategyName: strategyName,
                                  params: params, mode: c.mode, initialCapital: c.capital,
                                  monthlyContribution: c.monthly)
        }.value
    }

    /// 파라미터 비교 — 원래 값과 변형들을 같은 구간·같은 투자 방식으로 (웹 /backtests/simulate)
    func comparison(for strategyName: String, paramSets: [[String: Double]],
                    period: ClosedRange<Day>?) async throws -> Comparison {
        let (c, start, end) = try conditions(period)
        let bars = try await bars(from: start.adding(days: -warmupDays(strategyName, paramSets)))
        return try await Task.detached(priority: .userInitiated) {
            try runComparison(ticker: c.ticker, bars: bars, start: start, end: end, strategyName: strategyName,
                              paramSets: paramSets, mode: c.mode, initialCapital: c.capital,
                              monthlyContribution: c.monthly)
        }.value
    }

    /// 최적값 찾기. 파라미터 최댓값 조합의 준비 구간까지 시세를 더 받는다 (최대 4년쯤).
    func optimize(_ strategyName: String, original: [String: Double], period: ClosedRange<Day>?,
                  goal: Optimizer.Goal, minTrades: Int, maxMDD: Double?,
                  progress: @escaping Optimizer.Progress) async throws -> Optimizer.Result {
        let (c, start, end) = try conditions(period)
        let bars = try await bars(from: Optimizer.requiredStart(strategyName: strategyName, start: start))
        return try await Task.detached(priority: .userInitiated) {
            try Optimizer.optimize(bars: bars, strategyName: strategyName, start: start, end: end, goal: goal,
                                   mode: c.mode, initialCapital: c.capital, monthlyContribution: c.monthly,
                                   original: original, minTrades: minTrades, maxMDD: maxMDD, progress: progress)
        }.value
    }

    /// 표를 만든 조건과 계산 구간 (없으면 표와 같은 최근 5년)
    private func conditions(_ period: ClosedRange<Day>?) throws
        -> ((ticker: String, mode: InvestMode, capital: Double, monthly: Double), Day, Day) {
        guard let ran, let result else { throw AutoBacktestError.notEnoughData(ticker) }
        return ((result.ticker, result.mode, ran.capital, ran.monthly),
                period?.lowerBound ?? result.startDate, period?.upperBound ?? result.endDate)
    }

    private func warmupDays(_ strategyName: String, _ paramSets: [[String: Double]]) -> Int {
        guard let s = Strategies.all.first(where: { $0.name == strategyName }) else { return 0 }
        return paramSets.map { s.with($0).warmupDays }.max() ?? s.warmupDays
    }

    /// `from` 부터의 시세. 표를 만들 때 받은 것보다 더 앞이 필요하면(긴 준비 구간) 더 받는다.
    private func bars(from: Day) async throws -> [Bar] {
        guard let ran, let result else { throw AutoBacktestError.notEnoughData(ticker) }
        if let first = ran.bars.first, first.date <= from.adding(days: 7) { return ran.bars }
        let loaded = try await store.load(result.ticker, from: from, to: ran.end)
        // 표와 같은 종목·조건일 때만 바꿔 넣는다 (그사이 다른 종목을 돌렸으면 건드리지 않는다)
        if self.result?.ticker == result.ticker { self.ran?.bars = loaded.prices.bars }
        return loaded.prices.bars
    }

    /// 백엔드처럼 기기 날짜를 오늘로 쓴다 (끝 날짜 = 오늘, 시작 = 5년 전 같은 날)
    static func today() -> Day {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: Date())
        return Day(year: c.year!, month: c.month!, day: c.day!)
    }

    /// 그래프 기본 선택은 표의 기본 순위(롤링 B&H 승률) 상위 3개
    private func defaultPlotted(_ res: AutoBacktestResult) -> [String: Int] {
        let weeks = effectiveWeeks(for: res)
        let score = { (r: AutoStrategyResult) -> Double in
            guard let bench = res.benchmark, let weeks else { return r.totalReturn }
            return Rolling.vsBenchmark(r.curve, bench: bench.curve, weeks: weeks)?.winRate ?? -1
        }
        let top = res.results.filter { $0.strategyName != Strategies.benchmark }
            .enumerated().sorted { a, b in
                let (x, y) = (score(a.element), score(b.element))
                return x != y ? x > y : a.offset < b.offset
            }
            .prefix(Self.defaultPlotted)
        return Dictionary(uniqueKeysWithValues: top.enumerated().map { ($0.element.element.strategyName, $0.offset) })
    }

    // MARK: 표

    /// 데이터가 짧으면(상장이 늦은 종목) 고른 길이를 못 쓸 수 있다. 쓸 수 있는 가장 긴 길이로 내린다.
    func effectiveWeeks(for res: AutoBacktestResult? = nil) -> Int? {
        let points = (res ?? result)?.results.first?.curve.count ?? 0
        if Rolling.allowed(weeks: windowWeeks, points: points) { return windowWeeks }
        return Rolling.windows.reversed().first { Rolling.allowed(weeks: $0.weeks, points: points) }?.weeks
    }

    func windowAllowed(_ weeks: Int) -> Bool {
        Rolling.allowed(weeks: weeks, points: result?.results.first?.curve.count ?? 0)
    }

    var rows: [Row] {
        guard let result else { return [] }
        let bench = result.benchmark
        let weeks = effectiveWeeks()
        let rows = result.results.map { r -> Row in
            guard let bench, let weeks, r.strategyName != Strategies.benchmark,
                  let s = Rolling.vsBenchmark(r.curve, bench: bench.curve, weeks: weeks)
            else { return Row(result: r, rollWin: nil, rollExcess: nil) }
            return Row(result: r, rollWin: s.winRate, rollExcess: s.medianExcess)
        }
        // 값이 없는 줄(B&H 자신, 구간 부족)은 정렬 방향과 상관없이 맨 아래로 보낸다.
        return rows.enumerated().sorted { a, b in
            switch (sortKey.value(a.element), sortKey.value(b.element)) {
            case (nil, nil): return a.offset < b.offset
            case (nil, _): return false
            case (_, nil): return true
            case let (x?, y?):
                if x == y { return a.offset < b.offset }
                return sortKey.ascending ? x < y : x > y
            }
        }.map(\.element)
    }

    /// 롤링 구간 수 (B&H 가 아닌 아무 줄에서나 같다)
    var windowCount: Int {
        guard let result, let bench = result.benchmark, let weeks = effectiveWeeks(),
              let other = result.results.first(where: { $0.strategyName != Strategies.benchmark })
        else { return 0 }
        return Rolling.vsBenchmark(other.curve, bench: bench.curve, weeks: weeks)?.windows ?? 0
    }

    // MARK: 그래프

    func togglePlot(_ name: String) {
        if plotted[name] != nil {
            plotted[name] = nil
            return
        }
        let used = Set(plotted.values)
        if let free = (0..<Self.maxPlotted).first(where: { !used.contains($0) }) {
            plotted[name] = free
        }
    }

    var plotFull: Bool { plotted.count >= Self.maxPlotted }
}
