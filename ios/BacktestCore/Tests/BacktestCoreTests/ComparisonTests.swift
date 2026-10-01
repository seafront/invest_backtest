import Foundation
import Testing
@testable import BacktestCore

/// 파라미터 비교 (POST /backtests/simulate): 원래 값 + 변형 둘, 최근 5년 거치식.
/// 변형은 15개 전략 모두 기본값과 다른 값이라, 전략이 바꾼 파라미터를 제대로 쓰는지도 함께 본다.
struct ComparisonFixture: Decodable {
    struct Row: Decodable {
        let params: [String: Double]
        let total_return, cagr, sharpe_ratio, max_drawdown, win_rate: Double
        let trades_count: Int
        let regime_returns: [Double?]
        let first_trade: Day?
        /// [날짜, ret, idx] 10주 간격
        let curve: [[TearSheetFixture.IndicatorValue]]
    }
    struct RegimeJSON: Decodable { let start, end: Day; let kind: String; let weeks: Int; let benchmark_return: Double }
    struct Item: Decodable {
        let strategy_name: String
        let benchmark: Row
        let results: [Row]
        let regimes: [RegimeJSON]
        let regime_threshold: Double
    }
    let ticker: String
    let end_date: Day
    let years: Int
    let comparisons: [Item]
}

private func near(_ a: Double, _ b: Double, _ tol: Double) -> Bool { abs(a - b) <= tol + 1e-9 }

private func check(_ g: Comparison.Row, _ e: ComparisonFixture.Row, _ l: String) {
    let r = g.result
    #expect(r.params == e.params, "\(l) params")
    #expect(near(r.totalReturn, e.total_return, 0.01) && near(r.cagr, e.cagr, 0.01)
            && near(r.sharpeRatio, e.sharpe_ratio, 0.0001) && near(r.maxDrawdown, e.max_drawdown, 0.01)
            && near(r.winRate, e.win_rate, 0.01), "\(l) 지표 \(r.totalReturn) vs \(e.total_return)")
    #expect(r.tradesCount == e.trades_count && r.firstTrade == e.first_trade,
            "\(l) 거래 \(r.tradesCount)/\(e.trades_count) 첫 매매 \(String(describing: r.firstTrade))")
    #expect(g.regimeReturns.count == e.regime_returns.count && zip(g.regimeReturns, e.regime_returns).allSatisfy {
        switch ($0, $1) {
        case (nil, nil): true
        case let (a?, b?): near(a, b, 0.01)
        default: false
        }
    }, "\(l) 구간 수익률")
    let sampled = r.curve.enumerated().filter { $0.offset % 10 == 0 }.map(\.element)
    #expect(sampled.count == e.curve.count && zip(sampled, e.curve).allSatisfy { p, w in
        guard case .date(let d) = w[0], case .value(let ret) = w[1], case .value(let idx) = w[2] else { return false }
        return p.date == d && near(p.ret, ret, 0.01) && near(p.idx, idx, 0.000001)
    }, "\(l) 곡선")
}

@Test(arguments: Fixture.tickers)
func comparisonMatchesBackend(ticker: String) throws {
    let fx = try JSONDecoder().decode(ComparisonFixture.self, from: Data(contentsOf: Fixture.url(ticker)))
    let bars = try Fixture.load(ticker).bars
    let capital = Day.krwTicker(ticker) ? 100_000_000.0 : 100_000.0
    for item in fx.comparisons {
        let c = try runComparison(ticker: ticker, bars: bars, start: fx.end_date.yearsBefore(fx.years),
                                  end: fx.end_date, strategyName: item.strategy_name,
                                  paramSets: item.results.map(\.params), mode: .lumpSum,
                                  initialCapital: capital, monthlyContribution: 0)
        let l = "\(ticker) \(item.strategy_name)"
        check(c.benchmark, item.benchmark, "\(l) B&H")
        #expect(c.rows.count == item.results.count)
        for (i, (g, e)) in zip(c.rows, item.results).enumerated() { check(g, e, "\(l) #\(i)") }
        #expect(near(c.regimeThreshold * 100, item.regime_threshold, 0.05), "\(l) 임계값")
        #expect(c.regimes.map { [$0.start, $0.end] } == item.regimes.map { [$0.start, $0.end] }
                && c.regimes.map(\.weeks) == item.regimes.map(\.weeks), "\(l) 구간")
    }
}

/// "원래" 줄은 변형을 무엇을 넣든 Tear Sheet 와 같아야 한다 (조합마다 자기 준비 구간).
@Test func originalRowMatchesTearSheet() throws {
    let fx = try Fixture.load("TQQQ")
    let start = fx.end_date.yearsBefore(5)
    for name in ["ema_crossover", "macd", "parabolic_sar", "keltner"] {
        let report = try runStrategyReport(ticker: "TQQQ", bars: fx.bars, start: start, end: fx.end_date,
                                           strategyName: name, mode: .lumpSum, initialCapital: 100_000,
                                           monthlyContribution: 0)
        // 준비 구간이 가장 긴 변형을 함께 넣는다
        let longest = Strategies.all.first { $0.name == name }!.params.reduce(into: [String: Double]()) {
            $0[$1.name] = $1.name.hasSuffix("period") ? $1.range.upperBound : $1.defaultValue
        }
        let c = try runComparison(ticker: "TQQQ", bars: fx.bars, start: start, end: fx.end_date, strategyName: name,
                                  paramSets: [report.values, longest], mode: .lumpSum,
                                  initialCapital: 100_000, monthlyContribution: 0)
        #expect(c.rows[0].result.totalReturn == report.totalReturn, "\(name)")
        #expect(c.rows[0].result.sharpeRatio == report.sharpeRatio, "\(name)")
    }
}

extension Day {
    static func krwTicker(_ t: String) -> Bool { t.hasSuffix(".KS") || t.hasSuffix(".KQ") }
}
