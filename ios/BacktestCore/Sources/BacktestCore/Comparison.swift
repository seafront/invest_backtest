import Foundation

/// 파라미터 비교 (웹 Tear Sheet 의 "파라미터 비교", POST /backtests/simulate).
///
/// 한 전략을 파라미터 조합 여러 개로 같은 구간·같은 투자 방식으로 돌리고, 같은 구간의 Buy & Hold 를
/// 기준으로 함께 돌린다. 조합마다 자기 준비 구간만 쓴다 — 그래야 "원래" 줄이 Tear Sheet 와 같다.
public struct Comparison: Sendable {
    public struct Row: Sendable {
        public let result: AutoStrategyResult
        /// 추세 구간마다의 수익률(%), `regimes` 와 같은 순서
        public let regimeReturns: [Double?]
    }

    public let benchmark: Row
    /// 넘긴 파라미터 조합 순서 그대로
    public let rows: [Row]
    public let regimes: [Regime]
    public let regimeThreshold: Double
    public let dataStart: Day
    public let dataEnd: Day
    public let totalInvested: Double
}

public func runComparison(
    ticker: String, bars allBars: [Bar], start: Day, end: Day, strategyName: String,
    paramSets: [[String: Double]], mode: InvestMode, initialCapital: Double, monthlyContribution: Double
) throws -> Comparison {
    guard let base = Strategies.all.first(where: { $0.name == strategyName }),
          let bench = Strategies.all.first(where: { $0.name == Strategies.benchmark })
    else { throw ReportError.unknownStrategy(strategyName) }
    let inRange = allBars.filter { $0.date <= end }
    let trading = inRange.filter { $0.date >= start }
    guard trading.count >= 2 else { throw AutoBacktestError.notEnoughData(ticker) }

    func run(_ s: any Strategy) -> (AutoStrategyResult, Double) {
        let frame = inRange.filter { $0.date >= start.adding(days: -s.warmupDays) }
        let r = runBacktest(bars: frame, strategy: s, initialCapital: initialCapital,
                            monthlyContribution: monthlyContribution, mode: mode, tradeStart: start)
        return (summarize(s, r, mode: mode, initialCapital: initialCapital,
                          monthlyContribution: monthlyContribution), r.totalInvested)
    }

    let (benchResult, invested) = run(bench)
    let results = paramSets.map { run(base.with($0)).0 }
    // 추세 구간은 B&H 경로로 나누고, 모든 곡선을 같은 주 단위 점에서 잰다
    let (regimes, threshold) = Regimes.segment(benchResult.curve)
    func row(_ r: AutoStrategyResult) -> Comparison.Row {
        Comparison.Row(result: r, regimeReturns: Regimes.returns(r.curve, in: regimes))
    }
    return Comparison(
        benchmark: row(benchResult), rows: results.map(row), regimes: regimes, regimeThreshold: threshold,
        dataStart: trading.first!.date, dataEnd: trading.last!.date, totalInvested: invested
    )
}
