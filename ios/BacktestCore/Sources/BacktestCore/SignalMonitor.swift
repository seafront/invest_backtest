import Foundation

/// 워치리스트의 매매 신호 판정 (backend/services/signal_monitor.py).
///
/// 백테스트와 같은 코드로 판정한다: 지표 준비 구간을 붙여 신호를 돌리고, 엔진처럼 비어 있을 때의
/// BUY 와 보유 중의 SELL 만 매매로 친다. 그래서 여기서 "보유 중"이면 같은 파라미터의 백테스트도
/// 지금 보유 중이다. 일봉뿐이라 판단은 장 마감 뒤 하루 한 번이다.
public enum SignalMonitor {
    /// 상태를 다시 짜는 기간. 보유 여부가 이 앞의 매매에 좌우되지 않을 만큼 길면 된다.
    public static let lookbackDays = 3 * 365

    public enum Market: Sendable {
        case kr, us

        public init(ticker: String) {
            let t = ticker.uppercased()
            self = t.hasSuffix(".KS") || t.hasSuffix(".KQ") ? .kr : .us
        }

        var timeZone: TimeZone {
            TimeZone(identifier: self == .kr ? "Asia/Seoul" : "America/New_York")!
        }

        /// 장 마감 + 여유(분). 마감 직후에는 야후의 마지막 봉이 아직 확정되지 않았을 수 있다.
        var closeMinutes: Int { self == .kr ? 15 * 60 + 30 + 30 : 16 * 60 + 30 }
    }

    /// 그 시장에서 장이 끝난 마지막 평일. 휴장일은 모른다 — 그날은 야후가 봉을 주지 않는다.
    /// 장중의 미완성 봉은 쓰지 않는다 (웹 Signals 와 같은 기준).
    public static func lastClosedDay(_ ticker: String, now: Date = Date()) -> Day {
        let m = Market(ticker: ticker)
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = m.timeZone
        let c = cal.dateComponents([.year, .month, .day, .hour, .minute], from: now)
        var d = Day(year: c.year!, month: c.month!, day: c.day!)
        if c.hour! * 60 + c.minute! < m.closeMinutes { d = d.adding(days: -1) }
        while d.isoWeekday >= 6 { d = d.adding(days: -1) }
        return d
    }

    /// 다음으로 장이 끝나는 시각 (백그라운드 확인 예약용). 주말은 건너뛴다.
    public static func nextClose(_ market: Market, after now: Date = Date()) -> Date {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = market.timeZone
        var day = cal.startOfDay(for: now)
        while true {
            let close = day.addingTimeInterval(TimeInterval(market.closeMinutes * 60))
            let weekday = cal.component(.weekday, from: day)  // 1 일요일, 7 토요일
            if close > now && weekday != 1 && weekday != 7 { return close }
            day = cal.date(byAdding: .day, value: 1, to: day)!
        }
    }

    public struct Transition: Sendable, Hashable, Codable {
        public let date: Day
        public let action: Action
        public let price: Double
    }

    public struct Status: Sendable {
        /// 실제 매매가 되는 신호 전부 (날짜순)
        public let transitions: [Transition]
        public let lastBar: Day
        public let lastClose: Double
        /// 마지막 매매 신호가 BUY 면 보유 중
        public var holding: Bool { transitions.last?.action == .buy }
        public var lastSignal: Transition? { transitions.last }
        /// 마지막 신호 뒤 지난 거래일 수 (0 이면 마지막 봉에서 났다)
        public let barsSince: Int?
        /// 마지막 신호 뒤 종가 변화(%)
        public var sinceReturn: Double? {
            guard let s = lastSignal, s.price != 0 else { return nil }
            return pyRound((lastClose / s.price - 1) * 100, 2)
        }
        public var isNew: Bool { lastSignal?.date == lastBar }
        /// 날짜 → 거래일 번호 (감지가 몇 거래일 늦었는지 잴 때)
        let barIndex: [Day: Int]

        public func barsBetween(_ a: Day, _ b: Day) -> Int? {
            guard let i = barIndex[a], let j = barIndex[b] else { return nil }
            return j - i
        }
    }

    /// `bars` 는 장이 끝난 봉까지만, 준비 구간을 포함해 담겨 있어야 한다.
    public static func status(bars allBars: [Bar], strategyName: String, params: [String: Double]) throws -> Status {
        guard let strategy = Strategies.all.first(where: { $0.name == strategyName })?.with(params)
        else { throw ReportError.unknownStrategy(strategyName) }
        guard let last = allBars.last?.date else { throw AutoBacktestError.notEnoughData(strategyName) }
        let from = last.adding(days: -(lookbackDays + strategy.warmupDays))
        let bars = allBars.filter { $0.date >= from && $0.date <= last }
        var actions: [Int: Action] = [:]
        for s in strategy.signals(bars) { actions[s.index] = s.action }
        var holding = false
        var out: [Transition] = []
        for (i, b) in bars.enumerated() {
            guard let a = actions[i] else { continue }
            if (a == .buy && !holding) || (a == .sell && holding) {
                holding = a == .buy
                out.append(Transition(date: b.date, action: a, price: pyRound(b.close, 4)))
            }
        }
        let index = Dictionary(uniqueKeysWithValues: bars.enumerated().map { ($1.date, $0) })
        let since = out.last.flatMap { index[$0.date] }.map { bars.count - 1 - $0 }
        return Status(transitions: out, lastBar: last, lastClose: pyRound(bars.last!.close, 4),
                      barsSince: since, barIndex: index)
    }
}
