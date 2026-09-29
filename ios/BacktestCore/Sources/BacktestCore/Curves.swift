import Foundation

public struct CurvePoint: Codable, Hashable, Sendable {
    public let date: Day
    /// 그 시점까지 넣은 원금 대비 누적 수익률(%). 그래프에 그린다.
    public let ret: Double
    /// 입금 효과를 뺀 수익률 지수(시작 1.0). 두 점의 비율이 그 구간 수익률이다.
    public let idx: Double
}

/// backend/services/curves.py — 평가금액 곡선을 비교용 수익률 곡선으로 바꾼다.
enum Curves {
    static func daily(_ equity: [(date: Day, equity: Double)], mode: InvestMode,
                      initialCapital: Double, monthlyContribution: Double) -> [CurvePoint] {
        var out: [CurvePoint] = []
        var invested = mode == .lumpSum ? initialCapital : 0
        var lastMonth: (Int, Int)?
        var index = 1.0
        var prev: Double?
        for p in equity {
            var flow = 0.0
            let month = (p.date.year, p.date.month)
            if mode == .dca && (lastMonth == nil || month != lastMonth!) {
                invested += monthlyContribution
                flow = lastMonth != nil ? monthlyContribution : 0
                lastMonth = month
            }
            if let prev, prev != 0 { index *= (p.equity - flow) / prev }
            prev = p.equity
            let ret = invested > 0 ? (p.equity - invested) / invested * 100 : 0
            out.append(CurvePoint(date: p.date, ret: ret, idx: index))
        }
        return out
    }

    /// 각 ISO 주의 마지막 거래일만 남기고 반올림한다 (API 로 내보내는 모양 그대로).
    static func weekly(_ equity: [(date: Day, equity: Double)], mode: InvestMode,
                       initialCapital: Double, monthlyContribution: Double) -> [CurvePoint] {
        var out: [CurvePoint] = []
        var lastWeek: (Int, Int)?
        for p in daily(equity, mode: mode, initialCapital: initialCapital, monthlyContribution: monthlyContribution) {
            let week = p.date.isoWeek
            if let lastWeek, lastWeek == week { out[out.count - 1] = p } else { out.append(p) }
            lastWeek = week
        }
        return out.map { CurvePoint(date: $0.date, ret: pyRound($0.ret, 2), idx: pyRound($0.idx, 6)) }
    }
}
