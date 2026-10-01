import Foundation
import Testing
@testable import BacktestCore

/// Tear Sheet 에 더 쓰는 값: 매매 기록, 최종 평가금액, 추세 구간, 차트 지표, 전략 정의.
struct TearSheetFixture: Decodable {
    struct Trade: Decodable { let date: Day; let action: String; let price: Double; let shares: Int; let pnl: Double }
    struct StrategyDetail: Decodable {
        let final_value: Double
        let trades: [Trade]
        let regime_returns: [Double?]
    }
    struct RegimeJSON: Decodable {
        let start, end: Day
        let kind: String
        let start_index, end_index: Int
        let benchmark_return: Double
    }
    struct Detail: Decodable {
        let regime_threshold: Double
        let regimes: [RegimeJSON]
        let strategies: [String: StrategyDetail]
    }
    struct Case: Decodable {
        let invest_mode: InvestMode
        let initial_capital, monthly_contribution: Double
        let detail: Detail
    }
    struct Param: Decodable {
        let name: String, type: String, description: String
        let `default`, min, max: Double
    }
    struct StrategyDef: Decodable {
        let name, display_name, description: String
        let params: [Param]
    }
    let ticker: String
    let end_date: Day
    let years: Int
    let cases: [Case]
    /// 전략 → 지표 이름 → [날짜, 값] (INDICATOR_STEP 간격으로 뽑은 점)
    let indicators: [String: [String: [[IndicatorValue]]]]
    let strategies: [StrategyDef]

    enum IndicatorValue: Decodable {
        case date(Day), value(Double)
        init(from decoder: Decoder) throws {
            let c = try decoder.singleValueContainer()
            if let d = try? c.decode(Double.self) { self = .value(d) } else { self = .date(try c.decode(Day.self)) }
        }
    }

    static func load(_ ticker: String) throws -> TearSheetFixture {
        let data = try Data(contentsOf: Fixture.url(ticker))
        return try JSONDecoder().decode(TearSheetFixture.self, from: data)
    }
}

private func near(_ a: Double, _ b: Double, _ tol: Double) -> Bool { abs(a - b) <= tol + 1e-9 }

@Test(arguments: Fixture.tickers)
func tearSheetMatchesBackend(ticker: String) throws {
    let fx = try TearSheetFixture.load(ticker)
    let bars = try Fixture.load(ticker).bars

    for c in fx.cases {
        for (name, exp) in c.detail.strategies.sorted(by: { $0.key < $1.key }) {
            let l = "\(ticker) \(c.invest_mode.rawValue) \(name)"
            let r = try runStrategyReport(ticker: ticker, bars: bars, end: fx.end_date, years: fx.years,
                                          strategyName: name, mode: c.invest_mode,
                                          initialCapital: c.initial_capital,
                                          monthlyContribution: c.monthly_contribution)
            #expect(near(r.finalValue, exp.final_value, 0.01), "\(l) 최종 평가금액 \(r.finalValue) vs \(exp.final_value)")
            #expect(r.trades.count == exp.trades.count, "\(l) 매매 수 \(r.trades.count) vs \(exp.trades.count)")
            let bad = zip(r.trades, exp.trades).first { g, e in
                g.date != e.date || g.action.rawValue != e.action || g.shares != e.shares
                    || !near(g.price, e.price, 0.0001) || !near(g.pnl, e.pnl, 0.01)
            }
            #expect(bad == nil, "\(l) 매매 \(String(describing: bad))")

            // 추세 구간은 B&H 로 나누므로 전략마다 같다
            #expect(near(r.regimeThreshold, c.detail.regime_threshold, 1e-12), "\(l) 임계값")
            #expect(r.regimes.map { [$0.start, $0.end] } == c.detail.regimes.map { [$0.start, $0.end] }, "\(l) 구간")
            #expect(r.regimes.map(\.kind.rawValue) == c.detail.regimes.map(\.kind), "\(l) 구간 종류")
            #expect(zip(r.regimes, c.detail.regimes).allSatisfy {
                $0.startIndex == $1.start_index && $0.endIndex == $1.end_index
                    && near($0.benchmarkReturn, $1.benchmark_return, 0.01)
            }, "\(l) 구간 B&H 수익률")
            #expect(r.regimeReturns.count == exp.regime_returns.count
                && zip(r.regimeReturns, exp.regime_returns).allSatisfy { g, e in
                    switch (g, e) {
                    case (nil, nil): true
                    case let (g?, e?): near(g, e, 0.01)
                    default: false
                    }
                }, "\(l) 구간별 전략 수익률 \(r.regimeReturns) vs \(exp.regime_returns)")

            // 지표는 투자 방식과 무관하다 — 거치식에서만 본다
            if c.invest_mode == .lumpSum {
                let expected = fx.indicators[name] ?? [:]
                #expect(Set(r.indicators.map(\.name)) == Set(expected.keys), "\(l) 지표 이름")
                for ind in r.indicators {
                    let want = expected[ind.name] ?? []
                    let sampled = ind.points.enumerated()
                        .filter { $0.offset % 20 == 0 || $0.offset == ind.points.count - 1 }
                        .map(\.element)
                    #expect(sampled.count == want.count, "\(l) \(ind.name) 점 수 \(sampled.count) vs \(want.count)")
                    let tol = ind.pane == .price ? 0.0001 : 0.01  // 반올림 한 자리 차이까지
                    let mismatch = zip(sampled, want).first { p, w in
                        guard case .date(let d) = w[0], case .value(let v) = w[1] else { return true }
                        return p.date != d || !near(p.value, v, tol)
                    }
                    #expect(mismatch == nil, "\(l) \(ind.name) \(String(describing: mismatch))")
                }
            }
        }
    }
}

@Test func strategyDefinitionsMatchBackend() throws {
    let fx = try JSONDecoder().decode(TearSheetFixture.self, from: Data(contentsOf: Fixture.bundled("AAPL")))
    #expect(Strategies.all.map(\.name) == fx.strategies.map(\.name), "등록 순서")
    for (s, e) in zip(Strategies.all, fx.strategies) {
        #expect(s.displayName == e.display_name, "\(s.name) 이름")
        #expect(s.summary == e.description, "\(s.name) 설명")
        #expect(s.params.map(\.name) == e.params.map(\.name), "\(s.name) 파라미터")
        for (p, q) in zip(s.params, e.params) {
            let l = "\(s.name).\(p.name)"
            #expect(p.defaultValue == q.default && p.range == q.min...q.max, "\(l) 기본값·범위")
            #expect(p.isInt == (q.type == "int") && p.description == q.description, "\(l) 형식·설명")
        }
    }
}

@Test func captureUsesLogReturnsAndSkipsBeforeFirstTrade() {
    let d: (Int) -> Day = { Day(year: 2024, month: 1, day: $0) }
    let regimes = [
        Regime(start: d(1), end: d(2), kind: .up, startIndex: 0, endIndex: 1, benchmarkReturn: 100),
        Regime(start: d(2), end: d(3), kind: .down, startIndex: 1, endIndex: 2, benchmarkReturn: -50),
        Regime(start: d(3), end: d(4), kind: .up, startIndex: 2, endIndex: 3, benchmarkReturn: 100),
    ]
    // 첫 매매가 셋째 구간 시작이면 앞 두 구간은 미진입이라 빠진다
    let up = Regimes.capture([0, 0, 50], regimes: regimes, firstTrade: d(3), kind: .up)
    #expect(abs(up! - log(1.5) / log(2) * 100) < 1e-9)
    #expect(Regimes.capture([0, 0, 50], regimes: regimes, firstTrade: d(3), kind: .down) == nil)
}

/// Tear Sheet 계산 구간 (_backtest_over_period): 최근 1년과 가운데 임의 구간
struct PeriodFixture: Decodable {
    struct Result: Decodable {
        let total_return, cagr, sharpe_ratio, max_drawdown, win_rate, total_invested, final_value: Double
        let trades: [TearSheetFixture.Trade]
    }
    struct Period: Decodable { let start, end: Day; let strategies: [String: Result] }
    struct Case: Decodable {
        let invest_mode: InvestMode
        let initial_capital, monthly_contribution: Double
        let periods: [Period]
    }
    let end_date: Day
    let cases: [Case]
}

@Test(arguments: Fixture.tickers)
func periodMatchesBackend(ticker: String) throws {
    let fx = try JSONDecoder().decode(PeriodFixture.self, from: Data(contentsOf: Fixture.url(ticker)))
    let bars = try Fixture.load(ticker).bars
    // 빠른 선택 "최근 1년"은 웹과 같은 날짜 규칙으로 시작일을 잡아야 한다
    #expect(fx.cases.first?.periods.first?.start == fx.end_date.monthsBefore(12))

    for c in fx.cases {
        for p in c.periods {
            for s in Strategies.all {
                let l = "\(ticker) \(c.invest_mode.rawValue) \(p.start)~\(p.end) \(s.name)"
                let run = { try runStrategyReport(ticker: ticker, bars: bars, start: p.start, end: p.end,
                                                  strategyName: s.name, mode: c.invest_mode,
                                                  initialCapital: c.initial_capital,
                                                  monthlyContribution: c.monthly_contribution) }
                guard let e = p.strategies[s.name] else {
                    // 백엔드도 거래일이 2일 미만이면 돌리지 않는다
                    #expect(throws: (any Error).self, "\(l) 시세 부족") { try run() }
                    continue
                }
                let r = try run()
                #expect(near(r.totalReturn, e.total_return, 0.01) && near(r.cagr, e.cagr, 0.01)
                        && near(r.sharpeRatio, e.sharpe_ratio, 0.0001) && near(r.maxDrawdown, e.max_drawdown, 0.01)
                        && near(r.winRate, e.win_rate, 0.01) && near(r.totalInvested, e.total_invested, 0.01)
                        && near(r.finalValue, e.final_value, 0.01),
                        "\(l) 지표 \(r.totalReturn)/\(e.total_return) \(r.finalValue)/\(e.final_value)")
                #expect(r.trades.map(\.date) == e.trades.map(\.date)
                        && r.trades.map(\.shares) == e.trades.map(\.shares), "\(l) 매매")
            }
        }
    }
}

@Test func monthsBeforeFollowsJavaScriptDate() {
    #expect(Day("2026-08-31")!.monthsBefore(6) == Day("2026-03-03")!)  // 2월 31일 → 3월 3일
    #expect(Day("2026-09-30")!.monthsBefore(12) == Day("2025-09-30")!)
    #expect(Day("2026-01-15")!.monthsBefore(36) == Day("2023-01-15")!)
    #expect(Day("2024-03-31")!.monthsBefore(1) == Day("2024-03-02")!)  // 윤년 2월 31일 → 3월 2일
}
