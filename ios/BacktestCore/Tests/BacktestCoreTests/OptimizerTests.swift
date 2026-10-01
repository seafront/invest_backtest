import Foundation
import Testing
@testable import BacktestCore

/// ios/Fixtures/make_optimizer_fixtures.py 가 backend/services/optimizer.py 로 만든 정답과 비교한다.
struct OptimizerFixture: Decodable {
    struct Case: Decodable {
        let ticker, strategy, goal: String
        let mode: InvestMode
        let initial_capital, monthly_contribution: Double
        let start, end: Day
        let min_trades: Int?
        let max_mdd: Double?
    }
    struct M: Decodable {
        let total_return, cagr, sharpe_ratio, max_drawdown: Double
        let trades_count, entries: Int
        let win_rate_vs_bh, median_excess, up_capture, down_exposure, concentration: Double?
    }
    struct Row: Decodable {
        let params: [String: Double]
        let score_in, score_out, score_robust: Double?
        let excluded: String?
        let in_sample, out_of_sample, full: M?
    }
    struct Axis: Decodable { let name: String; let values: [Double] }
    struct Bench: Decodable { let in_sample, out_of_sample: M? }
    struct Expected: Decodable {
        let goal, mode: String
        let evaluated, grid_size: Int
        let regime_threshold: Double
        let recommended, peak: [String: Double]?
        let original: [String: Double]
        let benchmark: Bench
        let start_date, split_date, end_date: Day
        let axes: [Axis]
        let results: [Row]
    }
    let `case`: Case
    let prices: [Fixture.Price]
    let expected: Expected

    static var files: [String] {
        let dir = Bundle.module.resourceURL!.appendingPathComponent("Optimizer")
        return ((try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []).filter { $0.hasSuffix(".json") }.sorted()
    }

    static func load(_ file: String) throws -> OptimizerFixture {
        let url = Bundle.module.resourceURL!.appendingPathComponent("Optimizer/\(file)")
        return try JSONDecoder().decode(OptimizerFixture.self, from: Data(contentsOf: url))
    }
}

private func same(_ a: Double?, _ b: Double?, _ tol: Double) -> Bool {
    switch (a, b) {
    case (nil, nil): true
    case let (x?, y?): abs(x - y) <= tol + 1e-9
    default: false
    }
}

private func sameMetrics(_ g: Optimizer.Metrics?, _ e: OptimizerFixture.M?) -> Bool {
    guard let g, let e else { return g == nil && e == nil }
    return same(g.totalReturn, e.total_return, 0.01) && same(g.cagr, e.cagr, 0.01)
        && same(g.sharpeRatio, e.sharpe_ratio, 0.001) && same(g.maxDrawdown, e.max_drawdown, 0.01)
        && g.tradesCount == e.trades_count && g.entries == e.entries
        && same(g.winRateVsBH, e.win_rate_vs_bh, 0.1) && same(g.medianExcess, e.median_excess, 0.01)
        && same(g.upCapture, e.up_capture, 0.1) && same(g.downExposure, e.down_exposure, 0.1)
        && same(g.concentration, e.concentration, 0.1)
}

@Test(arguments: OptimizerFixture.files)
func optimizerMatchesBackend(file: String) throws {
    let fx = try OptimizerFixture.load(file)
    let c = fx.case, e = fx.expected
    let bars = fx.prices.map { Bar(date: $0.date, open: $0.open, high: $0.high, low: $0.low, close: $0.close, volume: $0.volume) }
    let clock = ContinuousClock()
    var res: Optimizer.Result!
    let elapsed = try clock.measure {
        res = try Optimizer.optimize(
            bars: bars, strategyName: c.strategy, start: c.start, end: c.end, goal: Optimizer.Goal(rawValue: c.goal)!,
            mode: c.mode, initialCapital: c.initial_capital, monthlyContribution: c.monthly_contribution,
            original: [:], minTrades: c.min_trades ?? 1, maxMDD: c.max_mdd)
    }
    print("\(file): \(res.evaluated) combos in \(elapsed)")

    #expect((res.random ? "random" : "grid") == e.mode, "\(file) 탐색 방식")
    #expect(res.gridSize == e.grid_size && res.evaluated == e.evaluated, "\(file) 조합 수 \(res.evaluated) vs \(e.evaluated)")
    #expect(res.splitDate == e.split_date && res.endDate == e.end_date, "\(file) 구간")
    #expect(same(res.regimeThreshold, e.regime_threshold, 0.05), "\(file) 임계값")
    #expect(res.axes.map(\.name) == e.axes.map(\.name) && res.axes.map(\.values) == e.axes.map(\.values), "\(file) 축")
    #expect(res.recommended == e.recommended, "\(file) 추천 \(String(describing: res.recommended)) vs \(String(describing: e.recommended))")
    #expect(res.peak == e.peak, "\(file) 최고점 \(String(describing: res.peak)) vs \(String(describing: e.peak))")
    #expect(res.original == e.original, "\(file) 원래 값")
    #expect(sameMetrics(res.benchmarkIn, e.benchmark.in_sample) && sameMetrics(res.benchmarkOut, e.benchmark.out_of_sample),
            "\(file) B&H 지표")

    // 줄 순서(고원 점수 순)와 점수·제외 사유까지 같아야 한다
    #expect(res.rows.count == e.results.count)
    for (i, (g, w)) in zip(res.rows, e.results).enumerated() {
        let l = "\(file) #\(i) \(w.params)"
        #expect(g.params == w.params, "\(l) 조합 \(g.params)")
        #expect(same(g.scoreIn, w.score_in, 0.001) && same(g.scoreOut, w.score_out, 0.001)
                && same(g.scoreRobust, w.score_robust, 0.001), "\(l) 점수 \(String(describing: g.scoreIn))/\(String(describing: g.scoreRobust))")
        #expect(g.excluded == w.excluded, "\(l) 제외 \(String(describing: g.excluded))")
        if w.in_sample != nil || w.full != nil {
            #expect(sameMetrics(g.inSample, w.in_sample) && sameMetrics(g.outOfSample, w.out_of_sample)
                    && sameMetrics(g.full, w.full), "\(l) 지표")
        }
        if g.params != w.params { break }  // 한 번 어긋나면 뒤는 모두 어긋난다
    }
}

@Test func pythonRandomMatchesCPython() {
    // python3 -c "import random; r = random.Random(0); print([r.choice(list(range(11))) for _ in range(12)])"
    var r = PythonRandom(seed: 0)
    #expect((0..<12).map { _ in r.choice(Array(0..<11)) } == [6, 6, 0, 4, 8, 7, 6, 4, 7, 5, 9, 3])
    var r2 = PythonRandom(seed: 0)
    #expect((0..<8).map { _ in r2.choice(Array(1...13)) } == [7, 13, 7, 1, 5, 9, 8, 7])
}
