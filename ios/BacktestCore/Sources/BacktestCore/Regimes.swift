import Foundation

/// 추세 구간 (backend/services/regimes.py).
///
/// Buy & Hold 경로에서 고점·저점을 이어 상승·하락 구간으로 나눈다(지그재그). 직전 극점에서
/// 임계값 이상 되돌리면 그 극점을 전환점으로 확정한다. 임계값은 종목 변동성에 비례한다.
/// 전환점은 되돌림이 임계값을 넘은 뒤에야 확정되므로 사후 구분이다 — 매매 신호가 아니다.
public struct Regime: Sendable, Identifiable, Hashable {
    public enum Kind: String, Sendable { case up, down, flat }
    public let start: Day
    public let end: Day
    public let kind: Kind
    /// 주 단위 곡선에서의 위치
    public let startIndex: Int
    public let endIndex: Int
    /// 그 구간 B&H 수익률(%)
    public let benchmarkReturn: Double

    public var weeks: Int { endIndex - startIndex }
    public var id: Day { start }
}

public enum Regimes {
    /// 임계값 = 연 변동성 × 0.5, 10–40%
    static let volMultiple = 0.5
    static let minThreshold = 0.10
    static let maxThreshold = 0.40
    /// 마지막 미완성 구간이 임계값의 이만큼도 움직이지 않았으면 방향을 말하기 어렵다
    static let flatRatio = 0.5

    static func swingThreshold(_ values: [Double]) -> Double {
        let rets = zip(values, values.dropFirst()).compactMap { a, b in a > 0 && b > 0 ? log(b / a) : nil }
        guard rets.count >= 2 else { return minThreshold }
        let mean = rets.reduce(0, +) / Double(rets.count)
        let variance = rets.reduce(0) { $0 + ($1 - mean) * ($1 - mean) } / Double(rets.count - 1)
        let annualVol = variance.squareRoot() * 52.0.squareRoot()
        return Swift.min(maxThreshold, Swift.max(minThreshold, annualVol * volMultiple))
    }

    /// B&H 주 단위 곡선을 구간으로 나눈다. 반환: (구간, 임계값 비율)
    public static func segment(_ points: [CurvePoint]) -> (regimes: [Regime], threshold: Double) {
        guard points.count >= 3 else { return ([], minThreshold) }
        let values = points.map(\.idx)
        let thr = swingThreshold(values)

        enum Trend { case up, down }
        var pivots = [0]
        var trend: Trend?  // 첫 추세가 정해지기 전에는 고점과 저점을 모두 따라간다
        var hi = 0, lo = 0
        for i in 1..<values.count {
            let v = values[i]
            switch trend {
            case nil:
                if v > values[hi] { hi = i }
                if v < values[lo] { lo = i }
                if values[hi] >= values[0] * (1 + thr) && v <= values[hi] * (1 - thr) {
                    pivots.append(hi)  // 올랐다가 꺾였다 — 시작~고점이 상승 구간
                    trend = .down; lo = i
                } else if values[lo] <= values[0] * (1 - thr) && v >= values[lo] * (1 + thr) {
                    pivots.append(lo)
                    trend = .up; hi = i
                } else if v >= values[0] * (1 + thr) && lo == 0 {
                    trend = .up
                } else if v <= values[0] * (1 - thr) && hi == 0 {
                    trend = .down
                }
            case .up:
                if v > values[hi] {
                    hi = i
                } else if v <= values[hi] * (1 - thr) {
                    pivots.append(hi)
                    trend = .down; lo = i
                }
            case .down:
                if v < values[lo] {
                    lo = i
                } else if v >= values[lo] * (1 + thr) {
                    pivots.append(lo)
                    trend = .up; hi = i
                }
            }
        }
        if pivots.last! != values.count - 1 { pivots.append(values.count - 1) }

        var out: [Regime] = []
        for (a, b) in zip(pivots, pivots.dropFirst()) where b > a {
            let ret = values[b] / values[a] - 1
            let kind: Regime.Kind = b == values.count - 1 && abs(ret) < thr * flatRatio
                ? .flat : (ret > 0 ? .up : .down)
            let r = Regime(start: points[a].date, end: points[b].date, kind: kind, startIndex: a, endIndex: b,
                           benchmarkReturn: pyRound(ret * 100, 2))
            // 같은 방향 구간이 이어지면 합친다 (첫 추세가 정해지는 과정에서 생길 수 있다)
            if let m = out.last, m.kind == kind {
                out[out.count - 1] = Regime(
                    start: m.start, end: r.end, kind: kind, startIndex: m.startIndex, endIndex: b,
                    benchmarkReturn: pyRound((values[b] / values[m.startIndex] - 1) * 100, 2))
            } else {
                out.append(r)
            }
        }
        return (out, thr)
    }

    /// 각 구간에서 이 곡선(지수)의 수익률(%). 곡선은 구간을 만든 점과 같은 날짜여야 한다.
    public static func returns(_ curve: [CurvePoint], in regimes: [Regime]) -> [Double?] {
        regimes.map { g in
            guard g.endIndex < curve.count, curve[g.startIndex].idx > 0 else { return nil }
            return pyRound((curve[g.endIndex].idx / curve[g.startIndex].idx - 1) * 100, 2)
        }
    }

    /// 첫 매매와 구간의 관계. 첫 매매 전 구간의 0%는 방어가 아니라 미진입이다.
    public enum Entry { case before, partial, inside }

    public static func entry(firstTrade: Day?, _ g: Regime) -> Entry {
        guard let first = firstTrade, first < g.end else { return .before }
        return first > g.start ? .partial : .inside
    }

    /// 상승 구간 포착률 / 하락 구간 노출률(%): 그 종류 구간에서 B&H 움직임 중 전략이 가져간 비율.
    /// 로그 수익률 합의 비로 잰다 — 단순 합은 +100%와 -50%를 같은 크기로 보지 못한다. 첫 매매 전 구간은 뺀다.
    public static func capture(_ returns: [Double?], regimes: [Regime], firstTrade: Day?, kind: Regime.Kind) -> Double? {
        var s = 0.0, b = 0.0
        for (g, v) in zip(regimes, returns) {
            guard g.kind == kind, let v, entry(firstTrade: firstTrade, g) != .before else { continue }
            s += log(1 + v / 100)
            b += log(1 + g.benchmarkReturn / 100)
        }
        return b == 0 ? nil : s / b * 100
    }
}
