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
    var capital: Double { didSet { save() } }
    var monthly: Double { didSet { save() } }
    var windowWeeks: Int { didSet { save() } }
    var sortKey: SortKey { didSet { save() } }
    /// 그래프에 켠 전략 → 색 번호. 색은 순위가 아니라 전략에 붙는다 — 다른 전략을 켜고 꺼도
    /// 이미 켜진 선의 색은 바뀌지 않는다.
    var plotted: [String: Int] { didSet { save() } }

    private(set) var result: AutoBacktestResult?
    /// 결과를 만든 입력. 폼을 바꿔도 결과 화면은 이 조건을 보여 준다.
    private(set) var ranCapital: Double = 0
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
        capital = d.object(forKey: "capital") as? Double ?? 100_000
        monthly = d.object(forKey: "monthly") as? Double ?? 1_000
        windowWeeks = d.object(forKey: "windowWeeks") as? Int ?? 52
        sortKey = SortKey(rawValue: d.string(forKey: "sortKey") ?? "") ?? .rollWin
        plotted = d.dictionary(forKey: "plotted") as? [String: Int] ?? [:]
    }

    private func save() {
        defaults.set(ticker, forKey: "ticker")
        defaults.set(mode.rawValue, forKey: "mode")
        defaults.set(capital, forKey: "capital")
        defaults.set(monthly, forKey: "monthly")
        defaults.set(windowWeeks, forKey: "windowWeeks")
        defaults.set(sortKey.rawValue, forKey: "sortKey")
        defaults.set(plotted, forKey: "plotted")
    }

    var listing: Listing? { Listing.nasdaq100.first { $0.ticker == ticker } }

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
            ranCapital = capital
            pricesFetchedAt = loaded.prices.fetchedAt
            notice = loaded.fallbackReason.map { "시세를 새로 받지 못해 저장된 시세로 계산했습니다 (\($0))" }
            if !keepPlotted || plotted.keys.contains(where: { name in !res.results.contains { $0.strategyName == name } }) {
                plotted = defaultPlotted(res)
            }
        } catch {
            self.error = error.localizedDescription
        }
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
