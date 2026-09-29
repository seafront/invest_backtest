import Foundation

/// 롤링 구간 비교 (frontend/src/utils/rolling.ts).
///
/// "오늘 기준 총수익률"은 끝 날짜에 크게 좌우된다. 그래서 같은 길이의 구간을 한 주씩 밀어 가며
/// 전부 잘라 보고, 몇 번이나 B&H 보다 나았는지로 비교한다.
public enum Rolling {
    public struct Window: Hashable, Sendable, Identifiable {
        public let weeks: Int
        public let label: String
        public var id: Int { weeks }
    }

    public static let windows = [
        Window(weeks: 13, label: "3개월"),
        Window(weeks: 26, label: "6개월"),
        Window(weeks: 52, label: "1년"),
        Window(weeks: 104, label: "2년"),
    ]

    /// 구간 길이가 쓸 만한지. 데이터 기간의 절반을 넘으면 구간들이 대부분 겹쳐 표본이 한두 개다.
    public static func allowed(weeks: Int, points: Int) -> Bool { weeks * 2 <= points }

    public struct Stats: Hashable, Sendable {
        /// B&H 보다 구간 수익률이 높았던 구간 비율(%)
        public let winRate: Double
        /// 구간별 초과수익(%p)의 중앙값
        public let medianExcess: Double
        public let windows: Int
    }

    public struct ExcessPoint: Hashable, Sendable {
        /// 구간 끝 날짜
        public let date: Day
        /// 그 날짜로 끝나는 구간의 전략 수익률 − B&H 수익률(%p)
        public let excess: Double
    }

    public static func excess(_ curve: [CurvePoint], bench: [CurvePoint], weeks: Int) -> [ExcessPoint] {
        let benchByDate = Dictionary(bench.map { ($0.date, $0.idx) }, uniquingKeysWith: { _, b in b })
        // 같은 데이터로 돌린 결과라 날짜가 같지만, 어긋나도 틀리지 않게 공통 날짜만 쓴다.
        let pts = curve.compactMap { p in benchByDate[p.date].map { (date: p.date, s: p.idx, b: $0) } }
        var out: [ExcessPoint] = []
        var i = 0
        while i + weeks < pts.count {
            let a = pts[i], z = pts[i + weeks]
            if a.s > 0 && a.b > 0 {
                out.append(ExcessPoint(date: z.date, excess: (z.s / a.s - z.b / a.b) * 100))
            }
            i += 1
        }
        return out
    }

    public static func vsBenchmark(_ curve: [CurvePoint], bench: [CurvePoint], weeks: Int) -> Stats? {
        let ex = excess(curve, bench: bench, weeks: weeks).map(\.excess)
        guard !ex.isEmpty else { return nil }
        let sorted = ex.sorted()
        let mid = sorted.count / 2
        return Stats(
            winRate: Double(ex.filter { $0 > 0 }.count) / Double(ex.count) * 100,
            medianExcess: sorted.count % 2 == 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
            windows: ex.count
        )
    }
}
