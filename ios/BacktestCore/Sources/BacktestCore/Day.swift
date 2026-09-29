import Foundation

/// 시간대 없는 달력 날짜. 시세는 거래소 현지 날짜로 다루므로 `Date`(시각)를 쓰지 않는다 —
/// 기기 시간대에 따라 하루씩 밀리는 일을 원천적으로 막는다.
public struct Day: Hashable, Comparable, Sendable, CustomStringConvertible {
    /// 1970-01-01 부터 센 일수
    public let ordinal: Int

    public init(ordinal: Int) { self.ordinal = ordinal }

    public init(year: Int, month: Int, day: Int) {
        // Howard Hinnant, days_from_civil
        let y = month <= 2 ? year - 1 : year
        let era = (y >= 0 ? y : y - 399) / 400
        let yoe = y - era * 400
        let mp = (month + 9) % 12
        let doy = (153 * mp + 2) / 5 + day - 1
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        ordinal = era * 146097 + doe - 719468
    }

    /// "yyyy-MM-dd"
    public init?(_ iso: String) {
        let parts = iso.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        self.init(year: parts[0], month: parts[1], day: parts[2])
    }

    public var components: (year: Int, month: Int, day: Int) {
        let z = ordinal + 719468
        let era = (z >= 0 ? z : z - 146096) / 146097
        let doe = z - era * 146097
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        let mp = (5 * doy + 2) / 153
        let d = doy - (153 * mp + 2) / 5 + 1
        let m = mp < 10 ? mp + 3 : mp - 9
        return (yoe + era * 400 + (m <= 2 ? 1 : 0), m, d)
    }

    public var year: Int { components.year }
    public var month: Int { components.month }

    /// 월=1 … 일=7 (ISO)
    public var isoWeekday: Int { ((ordinal + 3) % 7 + 7) % 7 + 1 }

    /// ISO 주 (연도, 주 번호). 파이썬 date.isocalendar()[:2] 와 같다.
    public var isoWeek: (year: Int, week: Int) {
        let thursday = Day(ordinal: ordinal - isoWeekday + 4)
        let y = thursday.year
        let week = (thursday.ordinal - Day(year: y, month: 1, day: 1).ordinal) / 7 + 1
        return (y, week)
    }

    public func adding(days: Int) -> Day { Day(ordinal: ordinal + days) }

    public static func - (a: Day, b: Day) -> Int { a.ordinal - b.ordinal }
    public static func < (a: Day, b: Day) -> Bool { a.ordinal < b.ordinal }

    /// `years`년 전 같은 날. 2월 29일이면 28일로 (routers/backtests.py _years_before).
    public func yearsBefore(_ years: Int) -> Day {
        let (y, m, d) = components
        if m == 2 && d == 29 { return Day(year: y - years, month: 2, day: 28) }
        return Day(year: y - years, month: m, day: d)
    }

    public var description: String {
        let (y, m, d) = components
        return String(format: "%04d-%02d-%02d", y, m, d)
    }

    /// 거래소 현지 날짜. Yahoo 가 주는 UTC 초 + 거래소 시차(gmtoffset).
    public init(unixTime: Int, gmtOffset: Int) {
        let local = unixTime + gmtOffset
        ordinal = Int((Double(local) / 86400).rounded(.down))
    }
}

extension Day: Codable {
    public init(from decoder: Decoder) throws {
        let s = try decoder.singleValueContainer().decode(String.self)
        guard let d = Day(s) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "bad date \(s)"))
        }
        self = d
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode(description)
    }
}
