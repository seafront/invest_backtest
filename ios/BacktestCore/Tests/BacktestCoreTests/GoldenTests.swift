import Foundation
import Testing
@testable import BacktestCore

/// ios/Fixtures/make_fixtures.py 가 백엔드 코드로 만든 정답과 비교한다.
/// 같은 시세를 넣었으니 결과도 같아야 한다 — 다르면 옮기다 계산이 어긋난 것이다.
struct Fixture: Decodable {
    struct Price: Decodable {
        let date: Day, open: Double, high: Double, low: Double, close: Double, volume: Double
    }
    struct Result: Decodable {
        let strategy_name: String
        let params: [String: Double]
        let total_return, cagr, sharpe_ratio, max_drawdown, win_rate: Double
        let trades_count: Int
        let curve: [CurvePoint]
        let first_trade: Day?
    }
    struct Expected: Decodable {
        let start_date, end_date, data_start, data_end: Day
        let total_invested: Double
        let results: [Result]
        let failed: [[String: String]]
    }
    struct Stats: Decodable { let winRate, medianExcess: Double; let windows: Int }
    struct Case: Decodable {
        let invest_mode: InvestMode
        let initial_capital, monthly_contribution: Double
        let expected: Expected
        let rolling: [String: [String: Stats?]]
    }
    let ticker: String
    let end_date: Day
    let years: Int
    let prices: [Price]
    let cases: [Case]

    var bars: [Bar] {
        prices.map { Bar(date: $0.date, open: $0.open, high: $0.high, low: $0.low, close: $0.close, volume: $0.volume) }
    }

    /// 저장소에 넣은 5종목 대신 다른 폴더를 쓴다 — 나스닥 100 전부로 넓게 볼 때:
    /// `python make_fixtures.py --universe --out DIR` 뒤 `BACKTEST_FIXTURES=DIR swift test`
    private static var directory: URL {
        if let dir = ProcessInfo.processInfo.environment["BACKTEST_FIXTURES"] {
            return URL(fileURLWithPath: dir)
        }
        return Bundle.module.resourceURL!.appendingPathComponent("Fixtures")
    }

    static func url(_ ticker: String) -> URL { directory.appendingPathComponent("\(ticker).json") }

    /// 저장소에 넣은 정답. 특정 종목을 보는 테스트는 BACKTEST_FIXTURES 와 상관없이 이것을 쓴다.
    static func bundled(_ ticker: String) -> URL {
        Bundle.module.resourceURL!.appendingPathComponent("Fixtures/\(ticker).json")
    }

    static func load(_ ticker: String) throws -> Fixture {
        try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url(ticker)))
    }

    static var tickers: [String] {
        let files = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
        return files.filter { $0.hasSuffix(".json") }.map { String($0.dropLast(5)) }.sorted()
    }
}

/// 반올림된 값끼리 비교한다. 계산 순서 차이(1e-15)가 반올림 경계를 넘으면 마지막 자리가 1 다를 수 있다.
private func close(_ a: Double, _ b: Double, _ tol: Double) -> Bool { abs(a - b) <= tol + 1e-9 }

@Test(arguments: Fixture.tickers)
func matchesBackend(ticker: String) throws {
    let fx = try Fixture.load(ticker)
    for c in fx.cases {
        let exp = c.expected
        let got = try runAutoBacktest(ticker: fx.ticker, bars: fx.bars, end: fx.end_date, years: fx.years,
                                      mode: c.invest_mode, initialCapital: c.initial_capital,
                                      monthlyContribution: c.monthly_contribution)
        let label = "\(ticker) \(c.invest_mode.rawValue)"
        #expect(exp.failed.isEmpty, "\(label): 백엔드에서 실패한 전략이 있다")
        #expect(got.startDate == exp.start_date && got.dataStart == exp.data_start && got.dataEnd == exp.data_end,
                "\(label) 구간")
        #expect(close(got.totalInvested, exp.total_invested, 0.01), "\(label) 원금")
        #expect(got.results.map(\.strategyName) == exp.results.map(\.strategy_name), "\(label) 순서")

        let byName = Dictionary(uniqueKeysWithValues: got.results.map { ($0.strategyName, $0) })
        for e in exp.results {
            let g = try #require(byName[e.strategy_name], "\(label) \(e.strategy_name) 없음")
            let l = "\(label) \(e.strategy_name)"
            #expect(g.params == e.params, "\(l) params")
            #expect(g.tradesCount == e.trades_count, "\(l) 거래 \(g.tradesCount) vs \(e.trades_count)")
            #expect(g.firstTrade == e.first_trade, "\(l) 첫 매매 \(String(describing: g.firstTrade)) vs \(String(describing: e.first_trade))")
            #expect(close(g.totalReturn, e.total_return, 0.01), "\(l) 총수익률 \(g.totalReturn) vs \(e.total_return)")
            #expect(close(g.cagr, e.cagr, 0.01), "\(l) CAGR \(g.cagr) vs \(e.cagr)")
            #expect(close(g.sharpeRatio, e.sharpe_ratio, 0.0001), "\(l) Sharpe \(g.sharpeRatio) vs \(e.sharpe_ratio)")
            #expect(close(g.maxDrawdown, e.max_drawdown, 0.01), "\(l) MDD \(g.maxDrawdown) vs \(e.max_drawdown)")
            #expect(close(g.winRate, e.win_rate, 0.01), "\(l) 매매 승률 \(g.winRate) vs \(e.win_rate)")
            #expect(g.curve.count == e.curve.count, "\(l) 곡선 길이 \(g.curve.count) vs \(e.curve.count)")
            let bad = zip(g.curve, e.curve).first {
                $0.date != $1.date || !close($0.ret, $1.ret, 0.01) || !close($0.idx, $1.idx, 0.000001)
            }
            #expect(bad == nil, "\(l) 곡선 \(String(describing: bad))")
        }

        // 롤링 비교는 웹의 rolling.ts 로 만든 정답과 비교한다 (정답 곡선을 넣어 계산만 본다)
        let bench = try #require(exp.results.first { $0.strategy_name == Strategies.benchmark })
        let expectedWeeks = Set(c.rolling.keys.compactMap(Int.init))
        let allowedWeeks = Set(Rolling.windows.map(\.weeks).filter {
            Rolling.allowed(weeks: $0, points: exp.results[0].curve.count)
        })
        #expect(expectedWeeks == allowedWeeks, "\(label) 고를 수 있는 구간")
        for (weeksKey, perStrategy) in c.rolling {
            let weeks = Int(weeksKey)!
            for e in exp.results where e.strategy_name != Strategies.benchmark {
                let want = perStrategy[e.strategy_name] ?? nil
                let have = Rolling.vsBenchmark(e.curve, bench: bench.curve, weeks: weeks)
                let l = "\(label) \(e.strategy_name) \(weeks)주"
                #expect((want == nil) == (have == nil), "\(l) 유무")
                if let want, let have {
                    #expect(have.windows == want.windows, "\(l) 구간 수")
                    #expect(close(have.winRate, want.winRate, 1e-9), "\(l) 승률")
                    #expect(close(have.medianExcess, want.medianExcess, 1e-9), "\(l) 초과 중앙값")
                }
            }
        }
    }
}

@Test func isoWeekMatchesPython() {
    // 2020-12-31(목)은 2020-W53, 2021-01-03(일)도 2020-W53, 2021-01-04(월)은 2021-W01
    #expect(Day("2020-12-31")!.isoWeek == (2020, 53))
    #expect(Day("2021-01-03")!.isoWeek == (2020, 53))
    #expect(Day("2021-01-04")!.isoWeek == (2021, 1))
    #expect(Day("2024-02-29")!.yearsBefore(5) == Day("2019-02-28")!)
    #expect(Day("2026-09-28")!.description == "2026-09-28")
}

@Test func floorDivMatchesPython() {
    // 파이썬: 0.3 // 0.1 == 2.0 (0.3 / 0.1 == 2.9999999999999996 이지만 fmod 기준으로는 2)
    #expect(pyFloorDiv(0.3, 0.1) == 2)
    #expect(pyFloorDiv(100_000, 110.5689) == 904)
    #expect(pyRound(2.675, 2) == 2.67)  // 이진수로 2.67499999…
    #expect(pyRound(0.125, 2) == 0.12)  // 정확히 절반이면 짝수 쪽
}
