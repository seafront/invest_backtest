import Foundation

public struct AutoStrategyResult: Sendable, Identifiable {
    public let strategyName: String
    public let displayName: String
    public let params: [String: Double]
    public let paramSpecs: [ParamSpec]
    public let totalReturn: Double
    /// 적립식이면 IRR
    public let cagr: Double
    public let sharpeRatio: Double
    public let maxDrawdown: Double
    /// 청산(SELL)한 매매 중 이익을 낸 비율
    public let winRate: Double
    /// 청산(SELL) 횟수
    public let tradesCount: Int
    /// 주 단위 누적 수익률
    public let curve: [CurvePoint]
    /// 첫 매매일. 그 전 구간의 0%는 판단이 아니라 "아직 들어가지 않음"이다.
    public let firstTrade: Day?

    public var id: String { strategyName }
}

public struct AutoBacktestResult: Sendable {
    public let ticker: String
    /// 요청 구간
    public let startDate: Day
    public let endDate: Day
    /// 실제 데이터 구간 — 상장이 늦은 종목은 요청보다 짧다
    public let dataStart: Day
    public let dataEnd: Day
    public let mode: InvestMode
    public let totalInvested: Double
    /// 총수익률 내림차순
    public let results: [AutoStrategyResult]

    public var benchmark: AutoStrategyResult? {
        results.first { $0.strategyName == Strategies.benchmark }
    }
}

public enum AutoBacktestError: Error, LocalizedError {
    case notEnoughData(String)

    public var errorDescription: String? {
        switch self {
        case .notEnoughData(let t): "\(t) 시세가 부족합니다"
        }
    }
}

/// 한 종목에 등록된 전략 전부를 기본 파라미터로 최근 `years`년 돌려 비교한다
/// (routers/backtests.py auto_backtest).
///
/// `bars` 는 시작일 전 준비 구간까지 담겨 있어야 한다 — `requiredStart(end:years:)` 부터 받으면 된다.
public func runAutoBacktest(
    ticker: String, bars allBars: [Bar], end: Day, years: Int = 5, mode: InvestMode,
    initialCapital: Double, monthlyContribution: Double
) throws -> AutoBacktestResult {
    let start = end.yearsBefore(years)
    let bars = allBars.filter { $0.date >= requiredStart(end: end, years: years) && $0.date <= end }
    let trading = bars.filter { $0.date >= start }
    guard trading.count >= 2 else { throw AutoBacktestError.notEnoughData(ticker) }

    var results: [(order: Int, result: AutoStrategyResult)] = []
    var totalInvested = 0.0
    for (order, strategy) in Strategies.all.enumerated() {
        // 전략마다 자기 준비 구간만큼만 잘라 쓴다. 가장 긴 구간으로 다 돌리면 SAR·EMA처럼 첫 봉부터
        // 재귀로 쌓는 지표가 웹의 상세 보기와 다른 신호를 낸다.
        let from = start.adding(days: -strategy.warmupDays)
        let frame = bars.filter { $0.date >= from }
        let r = runBacktest(bars: frame, strategy: strategy, initialCapital: initialCapital,
                            monthlyContribution: monthlyContribution, mode: mode, tradeStart: start)
        totalInvested = r.totalInvested
        results.append((order, summarize(strategy, r, mode: mode, initialCapital: initialCapital,
                                         monthlyContribution: monthlyContribution)))
    }
    // 파이썬 sort 는 안정 정렬이다 — 총수익률이 같으면 등록 순서를 지킨다
    let sorted = results.sorted {
        $0.result.totalReturn != $1.result.totalReturn
            ? $0.result.totalReturn > $1.result.totalReturn : $0.order < $1.order
    }.map(\.result)

    return AutoBacktestResult(
        ticker: ticker, startDate: start, endDate: end,
        dataStart: trading.first!.date, dataEnd: trading.last!.date,
        mode: mode, totalInvested: totalInvested, results: sorted
    )
}

/// 엔진 결과를 비교표 한 줄로 줄인다. 일별 곡선 대신 주 단위 곡선을 싣는다 (routers/backtests.py _summarize).
func summarize(_ strategy: any Strategy, _ r: EngineResult, mode: InvestMode,
               initialCapital: Double, monthlyContribution: Double) -> AutoStrategyResult {
    AutoStrategyResult(
        strategyName: strategy.name,
        displayName: strategy.displayName,
        params: strategy.resolvedParams,
        paramSpecs: strategy.params,
        totalReturn: r.totalReturn,
        cagr: r.cagr,
        sharpeRatio: r.sharpe,
        maxDrawdown: r.maxDrawdown,
        winRate: r.winRate,
        tradesCount: r.trades.filter { $0.action == .sell }.count,
        curve: Curves.weekly(r.equity, mode: mode, initialCapital: initialCapital,
                             monthlyContribution: monthlyContribution),
        firstTrade: r.trades.first?.date
    )
}

/// 준비 구간까지 포함해 받아야 하는 첫 날짜. 가장 긴 전략(Golden Cross)에 맞춘다.
public func requiredStart(end: Day, years: Int = 5) -> Day {
    let warm = Strategies.all.map(\.warmupDays).max() ?? 0
    return end.yearsBefore(years).adding(days: -warm)
}
