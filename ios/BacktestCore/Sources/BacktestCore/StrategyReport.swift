import Foundation

/// Tear Sheet 한 장에 필요한 전부. 전략 하나를 Leaderboard 와 같은 조건으로 다시 돌려 만든다
/// (웹의 "상세 보기" = /backtests/run). 저장하지 않는다 — 몇십 밀리초면 다시 계산된다.
public struct StrategyReport: Sendable {
    public struct EquityPoint: Sendable, Hashable {
        public let date: Day
        public let equity: Double
    }

    public let ticker: String
    public let strategyName: String
    public let displayName: String
    public let summary: String
    public let params: [ParamSpec]
    /// 실제로 쓴 값 (기본값 + 바꾼 값)
    public let values: [String: Double]

    public let mode: InvestMode
    public let initialCapital: Double
    public let monthlyContribution: Double
    public let startDate: Day
    public let endDate: Day
    public let dataStart: Day
    public let dataEnd: Day

    public let totalReturn: Double
    /// 적립식이면 IRR
    public let cagr: Double
    public let sharpeRatio: Double
    public let maxDrawdown: Double
    public let winRate: Double
    public let totalInvested: Double
    public let finalValue: Double

    /// 날짜별 평가금액 (현금 + 주식)
    public let equity: [EquityPoint]
    public let trades: [Trade]
    public var firstTrade: Day? { trades.first?.date }

    /// 주 단위 누적 수익률 — 전략과 같은 조건의 Buy & Hold
    public let curve: [CurvePoint]
    public let benchmarkCurve: [CurvePoint]

    /// 매매 구간의 일봉과 차트 지표
    public let bars: [Bar]
    public let indicators: [Indicator]

    /// B&H 경로로 나눈 추세 구간과, 구간마다의 전략 수익률(%)
    public let regimes: [Regime]
    public let regimeThreshold: Double
    public let regimeReturns: [Double?]

    public var isBenchmark: Bool { strategyName == Strategies.benchmark }
}

public enum ReportError: Error, LocalizedError {
    case unknownStrategy(String)

    public var errorDescription: String? {
        switch self {
        case .unknownStrategy(let n): "알 수 없는 전략: \(n)"
        }
    }
}

/// Leaderboard 와 같은 최근 `years`년 구간
public func runStrategyReport(
    ticker: String, bars: [Bar], end: Day, years: Int = 5, strategyName: String, params: [String: Double] = [:],
    mode: InvestMode, initialCapital: Double, monthlyContribution: Double
) throws -> StrategyReport {
    try runStrategyReport(ticker: ticker, bars: bars, start: end.yearsBefore(years), end: end,
                          strategyName: strategyName, params: params, mode: mode, initialCapital: initialCapital,
                          monthlyContribution: monthlyContribution)
}

/// 고른 구간 [start, end] 로 다시 돌린다 (웹 Tear Sheet 의 "계산 구간", GET /backtests/{id}?start&end).
/// 지표는 구간 앞 시세로 준비해 두므로, 그때 이미 매수 상태면 첫날 산다. `bars` 는 start 에서
/// 전략의 준비 구간만큼 앞선 날부터 담겨 있어야 한다.
public func runStrategyReport(
    ticker: String, bars allBars: [Bar], start: Day, end: Day, strategyName: String, params: [String: Double] = [:],
    mode: InvestMode, initialCapital: Double, monthlyContribution: Double
) throws -> StrategyReport {
    guard let strategy = Strategies.all.first(where: { $0.name == strategyName })?.with(params),
          let benchmark = Strategies.all.first(where: { $0.name == Strategies.benchmark })
    else { throw ReportError.unknownStrategy(strategyName) }
    let inRange = allBars.filter { $0.date <= end }
    let trading = inRange.filter { $0.date >= start }
    guard trading.count >= 2 else { throw AutoBacktestError.notEnoughData(ticker) }

    func run(_ s: any Strategy) -> (EngineResult, [Bar]) {
        let frame = inRange.filter { $0.date >= start.adding(days: -s.warmupDays) }
        return (runBacktest(bars: frame, strategy: s, initialCapital: initialCapital,
                            monthlyContribution: monthlyContribution, mode: mode, tradeStart: start), frame)
    }
    let (r, frame) = run(strategy)
    let (bench, _) = run(benchmark)
    let curve = Curves.weekly(r.equity, mode: mode, initialCapital: initialCapital, monthlyContribution: monthlyContribution)
    let benchCurve = Curves.weekly(bench.equity, mode: mode, initialCapital: initialCapital,
                                   monthlyContribution: monthlyContribution)
    let (regimes, threshold) = Regimes.segment(benchCurve)

    // 지표는 준비 구간까지 넣어 계산하고, 차트에는 매매 구간만 싣는다 (backtest_engine)
    let indicators = strategy.indicators(frame).map {
        Indicator(name: $0.name, pane: $0.pane, points: $0.points.filter { $0.date >= start })
    }

    return StrategyReport(
        ticker: ticker, strategyName: strategy.name, displayName: strategy.displayName,
        summary: strategy.summary, params: strategy.params, values: strategy.resolvedParams,
        mode: mode, initialCapital: initialCapital, monthlyContribution: monthlyContribution,
        startDate: start, endDate: end, dataStart: trading.first!.date, dataEnd: trading.last!.date,
        totalReturn: r.totalReturn, cagr: r.cagr, sharpeRatio: r.sharpe, maxDrawdown: r.maxDrawdown,
        winRate: r.winRate, totalInvested: r.totalInvested, finalValue: r.equity.last?.equity ?? r.totalInvested,
        equity: r.equity.map { StrategyReport.EquityPoint(date: $0.date, equity: $0.equity) },
        trades: r.trades, curve: curve, benchmarkCurve: benchCurve,
        bars: trading, indicators: indicators,
        regimes: regimes, regimeThreshold: threshold, regimeReturns: Regimes.returns(curve, in: regimes)
    )
}
