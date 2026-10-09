import Foundation
import Testing
@testable import BacktestCore

/// 워치리스트 판정 (services/signal_monitor.py) — 전략마다 기본값과 변형 둘
struct SignalFixture: Decodable {
    struct T: Decodable { let date: Day; let action: String; let price: Double }
    struct Item: Decodable {
        let strategy_name: String
        let params: [String: Double]
        let transitions: [T]
        let last_bar_date: Day
        let last_close: Double
        let position: String
        let bars_since: Int?
        let since_return: Double?
        let is_new: Bool
    }
    let signals: [Item]
}

@Test(arguments: Fixture.tickers)
func signalsMatchBackend(ticker: String) throws {
    let fx = try JSONDecoder().decode(SignalFixture.self, from: Data(contentsOf: Fixture.url(ticker)))
    let bars = try Fixture.load(ticker).bars
    for e in fx.signals {
        let l = "\(ticker) \(e.strategy_name) \(e.params)"
        let s = try SignalMonitor.status(bars: bars, strategyName: e.strategy_name, params: e.params)
        #expect(s.transitions.map(\.date) == e.transitions.map(\.date)
                && s.transitions.map(\.action.rawValue) == e.transitions.map(\.action), "\(l) 매매 신호 \(s.transitions.count) vs \(e.transitions.count)")
        #expect(zip(s.transitions, e.transitions).allSatisfy { abs($0.price - $1.price) < 1e-9 }, "\(l) 가격")
        #expect(s.lastBar == e.last_bar_date && abs(s.lastClose - e.last_close) < 1e-9, "\(l) 마지막 봉")
        #expect((s.holding ? "long" : "flat") == e.position, "\(l) 상태")
        #expect(s.barsSince == e.bars_since && s.isNew == e.is_new, "\(l) 경과 \(String(describing: s.barsSince))")
        #expect(s.sinceReturn == e.since_return, "\(l) 그 뒤 변화 \(String(describing: s.sinceReturn))")
    }
}

/// signal_monitor.last_closed_day 와 같은 날짜 (python 으로 뽑은 값)
@Test func lastClosedDayMatchesBackend() {
    let cases: [(String, String, String)] = [
        ("AAPL", "2026-10-02T19:00:00Z", "2026-10-01"),
        ("AAPL", "2026-10-02T20:31:00Z", "2026-10-02"),
        ("AAPL", "2026-10-03T21:00:00Z", "2026-10-02"),
        ("005930.KS", "2026-10-02T06:59:00Z", "2026-10-01"),
        ("005930.KS", "2026-10-02T07:00:00Z", "2026-10-02"),
        ("005930.KS", "2026-10-04T03:00:00Z", "2026-10-02"),
        ("AAPL", "2026-01-15T21:29:00Z", "2026-01-14"),  // 겨울(EST): 16:30 ET = 21:30 UTC
        ("AAPL", "2026-01-15T21:30:00Z", "2026-01-15"),
    ]
    let f = ISO8601DateFormatter()
    for (t, iso, want) in cases {
        #expect(SignalMonitor.lastClosedDay(t, now: f.date(from: iso)!) == Day(want)!, "\(t) \(iso)")
    }
    // 금요일 장 마감 뒤 다음 마감은 월요일
    let fri = f.date(from: "2026-10-02T21:00:00Z")!
    #expect(f.string(from: SignalMonitor.nextClose(.us, after: fri)) == "2026-10-05T20:30:00Z")
    #expect(f.string(from: SignalMonitor.nextClose(.kr, after: fri)) == "2026-10-05T07:00:00Z")
}
