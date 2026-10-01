import Foundation

/// 투자 목표에 맞는 파라미터 찾기 (backend/services/optimizer.py).
///
/// 같은 기간으로 고르고 같은 기간으로 평가하면 1등은 거의 항상 우연히 맞은 값이다. 그래서
/// 1. 앞 60% 구간으로만 고르고 뒤 40% 로 검증한다. 신호는 과거만 보므로 한 번 돌린 곡선을 날짜로
///    잘라도 미래 정보가 섞이지 않는다 — 조합당 실행은 한 번이다.
/// 2. 한 점의 점수가 아니라 주변 조합들의 평균 점수(고원)로 추천값을 고른다. 최고점은 따로 보인다.
/// 3. 수익이 추세 구간 하나에서만 나왔는지(집중도)를 표시한다.
public enum Optimizer {
    static let steps = 11  // 파라미터마다 범위를 몇 칸으로 나눌지
    static let budget = 300  // 격자가 이보다 크면 무작위로 뽑는다
    static let refine = 100  // 무작위 뒤 상위 근처를 더 볼 횟수
    static let topForRefine = 10
    static let neighbors = 8  // 고원 점수에 쓰는 이웃 수
    static let inSampleRatio = 0.6
    static let riskFree = 0.02
    public static let concentrationWarn = 60.0  // 수익의 60% 넘게가 한 구간에서 나오면 경고
    /// 검증 구간을 나누려면 이만큼은 있어야 한다
    public static let minSpanDays = 365

    /// 서로 순서가 있어야 하는 파라미터. 범위가 겹쳐 fast ≥ slow 조합이 격자에 생긴다.
    static let orderedPairs = [("fast_period", "slow_period")]

    public enum Goal: String, CaseIterable, Identifiable, Sendable {
        case consistency
        case riskAdjusted = "risk_adjusted"
        case defense, trend
        case maxReturn = "return"

        public var id: String { rawValue }

        public var label: String {
            switch self {
            case .consistency: "꾸준히 B&H 이기기"
            case .riskAdjusted: "위험 대비 수익"
            case .defense: "하락 방어"
            case .trend: "추세 추종"
            case .maxReturn: "수익 극대화"
            }
        }

        public var summary: String {
            switch self {
            case .consistency: "1년씩 잘라 본 구간에서 B&H보다 나았던 비율이 높고, 초과수익 중앙값이 큰 값"
            case .riskAdjusted: "Sharpe가 높은 값. 최대 낙폭 한도를 줄 수 있다"
            case .defense: "하락 구간에서 B&H 하락을 덜 맞는 값. 상승 구간 포착률 50% 이상 유지"
            case .trend: "상승 구간에서 B&H 상승을 많이 가져가는 값. 하락 구간 노출률 80% 이하"
            case .maxReturn: "CAGR이 가장 높은 값. 과최적화에 가장 취약하다"
            }
        }
    }

    public struct Metrics: Sendable {
        public let totalReturn, cagr, sharpeRatio, maxDrawdown: Double
        /// 청산 횟수
        public let tradesCount: Int
        /// 현금 상태에서 산 횟수 (적립식 월 자동 매수는 세지 않는다)
        public let entries: Int
        public let winRateVsBH, medianExcess, upCapture, downExposure, concentration: Double?
    }

    public struct Row: Sendable, Identifiable {
        public let params: [String: Double]
        public let inSample, outOfSample, full: Metrics?
        public let scoreIn, scoreOut: Double?
        /// 제약을 어겨 추천에서 뺀 사유
        public let excluded: String?
        public internal(set) var scoreRobust: Double?
        public var id: String { Optimizer.key(params) }
    }

    public struct Axis: Sendable {
        public let name: String
        public let values: [Double]
    }

    public struct Result: Sendable {
        public let goal: Goal
        public let random: Bool
        public let evaluated: Int
        public let gridSize: Int
        public let startDate, splitDate, endDate: Day
        public let regimeThreshold: Double
        public let axes: [Axis]
        public let benchmarkIn, benchmarkOut: Metrics?
        /// 고원 점수 내림차순
        public let rows: [Row]
        public let recommended, peak: [String: Double]?
        public let original: [String: Double]

        public func row(_ params: [String: Double]?) -> Row? {
            params.flatMap { p in rows.first { Optimizer.key($0.params) == Optimizer.key(p) } }
        }
    }

    // MARK: 조합

    static func axisValues(_ p: ParamSpec) -> [Double] {
        let lo = p.range.lowerBound, hi = p.range.upperBound
        if p.isInt {
            // 파이썬 round() 는 짝수 쪽 반올림이다 (2.5 → 2)
            let step = Swift.max(1, Int(((hi - lo) / Double(steps - 1)).rounded(.toNearestOrEven)))
            var vals = Array(stride(from: Int(lo), through: Int(hi), by: step)).map(Double.init)
            if vals.last != hi { vals.append(Double(Int(hi))) }
            return vals
        }
        return (0..<steps).map { pyRound(lo + (hi - lo) * Double($0) / Double(steps - 1), 4) }
    }

    static func valid(_ params: [String: Double]) -> Bool {
        orderedPairs.allSatisfy { a, b in
            guard let x = params[a], let y = params[b] else { return true }
            return x < y
        }
    }

    static func key(_ params: [String: Double]) -> String {
        params.keys.sorted().map { "\($0)=\(params[$0]!)" }.joined(separator: ",")
    }

    /// 각 축에서 한 칸씩 움직인 조합들(자기 자신 제외). itertools.product 순서.
    static func neighbors(_ params: [String: Double], _ axes: [Axis]) -> [[String: Double]] {
        let idx = axes.compactMap { a in a.values.firstIndex(of: params[a.name]!).map { (a, $0) } }
        var out: [[String: Double]] = []
        var deltas = [Int](repeating: -1, count: idx.count)
        while true {
            if deltas.contains(where: { $0 != 0 }) {
                var cand = params
                var ok = true
                for ((axis, i), d) in zip(idx, deltas) {
                    let j = i + d
                    guard axis.values.indices.contains(j) else { ok = false; break }
                    cand[axis.name] = axis.values[j]
                }
                if ok && valid(cand) { out.append(cand) }
            }
            // 마지막 축부터 -1 → 0 → 1 로 올린다
            var k = deltas.count - 1
            while k >= 0 && deltas[k] == 1 { deltas[k] = -1; k -= 1 }
            if k < 0 { break }
            deltas[k] += 1
        }
        return out
    }

    // MARK: 구간 지표

    private struct Run {
        let daily: [CurvePoint]
        let trades: [Trade]
        let dates: [Day]
        let byDate: [Day: Double]

        init(daily: [CurvePoint], trades: [Trade]) {
            self.daily = daily
            self.trades = trades
            dates = daily.map(\.date)
            byDate = Dictionary(daily.map { ($0.date, $0.idx) }, uniquingKeysWith: { _, b in b })
        }
    }

    /// [from, to] 구간의 성과. 곡선은 입금 효과를 뺀 지수로 잰다.
    private static func metrics(_ run: Run, bench: Run, legs: [Regime], from: Day, to: Day) -> Metrics? {
        let pts = run.daily.filter { $0.date >= from && $0.date <= to }
        let bpts = bench.daily.filter { $0.date >= from && $0.date <= to }
        guard pts.count >= 20, bpts.count >= 20 else { return nil }
        let idx = pts.map(\.idx)
        let ret = idx.last! / idx.first! - 1
        let years = Double(pts.last!.date - pts.first!.date) / 365.25
        let cagr = years > 0.1 && idx.last! > 0 ? pow(idx.last! / idx.first!, 1 / years) - 1 : 0

        let rets = zip(idx, idx.dropFirst()).compactMap { a, b in a > 0 ? b / a - 1 : nil }
        var sharpe = 0.0
        if rets.count > 1 {
            let mean = rets.reduce(0, +) / Double(rets.count)
            let sd = (rets.reduce(0) { $0 + ($1 - mean) * ($1 - mean) } / Double(rets.count - 1)).squareRoot()
            sharpe = sd > 0 ? (mean - riskFree / 252) / sd * 252.0.squareRoot() : 0
        }

        var peak = idx[0], mdd = 0.0
        for v in idx {
            peak = Swift.max(peak, v)
            if peak > 0 { mdd = Swift.max(mdd, (peak - v) / peak) }
        }

        let inSeg = run.trades.filter { $0.date >= from && $0.date <= to }
        let sells = inSeg.filter { $0.action == .sell }.count
        // 진입 횟수: 구간 시작 때 보유 중이었는지 앞선 매매로 되짚은 뒤, 현금 상태에서 산 것만 센다
        var holding = false
        for t in run.trades {
            if t.date >= from { break }
            holding = t.action == .buy || (holding && t.action != .sell)
        }
        var entries = 0
        for t in inSeg {
            if t.action == .buy && !holding { entries += 1; holding = true }
            else if t.action == .sell { holding = false }
        }
        let firstTrade = run.trades.first?.date

        // 롤링 B&H 승률: 주 단위, 1년 창(구간이 2년 미만이면 반년 창)
        let w = Curves.weeklyPoints(pts)
        let bw = Dictionary(Curves.weeklyPoints(bpts).map { ($0.date, $0.idx) }, uniquingKeysWith: { _, b in b })
        let pairs = w.compactMap { p in bw[p.date].map { (p.idx, $0) } }
        let window = pairs.count >= 104 ? 52 : 26
        var excess: [Double] = []
        if pairs.count > window {
            for i in 0..<(pairs.count - window) where pairs[i].0 > 0 && pairs[i].1 > 0 {
                excess.append((pairs[i + window].0 / pairs[i].0 - pairs[i + window].1 / pairs[i].1) * 100)
            }
        }
        let winRate = excess.isEmpty ? nil : Double(excess.filter { $0 > 0 }.count) / Double(excess.count) * 100
        let medianExcess = excess.isEmpty ? nil : excess.sorted()[excess.count / 2]

        // 추세 구간: 이 구간과 겹치는 부분만, 첫 매매 전 부분은 뺀다(미진입이지 방어가 아니다)
        func onOrBefore(_ d: Day) -> Day? {
            // bisect_right(dates, d) - 1
            var lo = 0, hi = run.dates.count
            while lo < hi {
                let mid = (lo + hi) / 2
                if d < run.dates[mid] { hi = mid } else { lo = mid + 1 }
            }
            return lo > 0 ? run.dates[lo - 1] : nil
        }
        var upS = 0.0, upB = 0.0, dnS = 0.0, dnB = 0.0
        var legLogs: [Double] = []
        for leg in legs {
            let a = Swift.max(leg.start, from, firstTrade ?? to)
            let b = Swift.min(leg.end, to)
            if a >= b || leg.kind == .flat { continue }
            guard let da = onOrBefore(a), let db = onOrBefore(b), da != db,
                  let sa = run.byDate[da], sa > 0, let ba = bench.byDate[da], ba > 0
            else { continue }
            let s = log(run.byDate[db]! / sa)
            let bm = log(bench.byDate[db]! / ba)
            legLogs.append(s)
            if leg.kind == .up { upS += s; upB += bm } else { dnS += s; dnB += bm }
        }
        let positive = legLogs.filter { $0 > 0 }
        let concentration = positive.isEmpty ? nil : positive.max()! / positive.reduce(0, +)

        return Metrics(
            totalReturn: pyRound(ret * 100, 2),
            cagr: pyRound(cagr * 100, 2),
            sharpeRatio: pyRound(sharpe, 3),
            maxDrawdown: pyRound(mdd * 100, 2),
            tradesCount: sells,
            entries: entries,
            winRateVsBH: winRate.map { pyRound($0, 1) },
            medianExcess: medianExcess.map { pyRound($0, 2) },
            upCapture: upB != 0 ? pyRound(upS / upB * 100, 1) : nil,
            downExposure: dnB != 0 ? pyRound(dnS / dnB * 100, 1) : nil,
            concentration: concentration.map { pyRound($0 * 100, 1) }
        )
    }

    /// (점수, 제외 사유). 점수가 클수록 좋다. 제약을 어기면 점수는 있어도 추천에서 뺀다.
    static func score(_ goal: Goal, _ m: Metrics?, minTrades: Int, maxMDD: Double?) -> (Double?, String?) {
        guard let m else { return (nil, "데이터 부족") }
        let s: Double
        switch goal {
        case .consistency:
            guard let w = m.winRateVsBH else { return (nil, "구간 부족") }
            s = w + 0.1 * (m.medianExcess ?? 0)
        case .riskAdjusted: s = m.sharpeRatio
        case .defense:
            guard let d = m.downExposure else { return (nil, "하락 구간 없음") }
            s = -d
        case .trend:
            guard let u = m.upCapture else { return (nil, "상승 구간 없음") }
            s = u
        case .maxReturn: s = m.cagr
        }
        var reason: String?
        if m.entries < minTrades {
            reason = "진입 \(m.entries)회 (최소 \(minTrades))"
        } else if goal == .riskAdjusted, let maxMDD, m.maxDrawdown > maxMDD {
            reason = String(format: "MDD %.0f%% > %.0f%%", m.maxDrawdown, maxMDD)
        } else if goal == .defense && (m.upCapture ?? 0) < 50 {
            reason = "상승 포착률 50% 미만"
        } else if goal == .trend, let d = m.downExposure, d > 80 {
            reason = "하락 노출률 80% 초과"
        }
        return (pyRound(s, 3), reason)
    }

    // MARK: 탐색

    /// 진행: (끝낸 수, 전체). false 를 돌려주면 멈춘다 (CancellationError).
    public typealias Progress = @Sendable (Int, Int) -> Bool

    /// `bars` 는 start 에서 가장 긴 조합의 준비 구간(`requiredStart`)만큼 앞선 날부터 담겨 있어야 한다.
    public static func optimize(
        bars allBars: [Bar], strategyName: String, start: Day, end: Day, goal: Goal,
        mode: InvestMode, initialCapital: Double, monthlyContribution: Double,
        original originalValues: [String: Double], minTrades: Int = 1, maxMDD: Double? = nil,
        progress: Progress? = nil
    ) throws -> Result {
        guard let strategy = Strategies.all.first(where: { $0.name == strategyName }),
              let benchStrategy = Strategies.all.first(where: { $0.name == Strategies.benchmark })
        else { throw ReportError.unknownStrategy(strategyName) }
        let bars = allBars.filter { $0.date <= end }
        let original = strategy.with(originalValues).resolvedParams
        // 원래 값을 축에 끼워 넣는다 — 격자 간격이 원래 값을 건너뛰면 히트맵에 자리가 없다
        let axes = strategy.params.map { p in
            Axis(name: p.name, values: Array(Set(axisValues(p) + [original[p.name]!])).sorted())
        }
        let split = start.adding(days: Int(Double(end - start) * inSampleRatio))

        func run(_ s: any Strategy) -> Run {
            let frame = bars.filter { $0.date >= start.adding(days: -s.warmupDays) }
            let r = runBacktest(bars: frame, strategy: s, initialCapital: initialCapital,
                                monthlyContribution: monthlyContribution, mode: mode, tradeStart: start)
            return Run(daily: Curves.daily(r.equity, mode: mode, initialCapital: initialCapital,
                                           monthlyContribution: monthlyContribution), trades: r.trades)
        }

        // B&H 는 백엔드처럼 시작 10일 전부터 (준비 구간이 없어 결과는 같다)
        let benchFrame = bars.filter { $0.date >= start.adding(days: -10) }
        let benchRaw = runBacktest(bars: benchFrame, strategy: benchStrategy, initialCapital: initialCapital,
                                   monthlyContribution: monthlyContribution, mode: mode, tradeStart: start)
        let bench = Run(daily: Curves.daily(benchRaw.equity, mode: mode, initialCapital: initialCapital,
                                            monthlyContribution: monthlyContribution), trades: benchRaw.trades)
        guard let dataEnd = bench.daily.last?.date else { throw AutoBacktestError.notEnoughData(strategyName) }
        let (legs, threshold) = Regimes.segment(Curves.weeklyPoints(bench.daily))

        // 격자가 예산 안이면 전부, 넘으면 무작위로 뽑는다. 원래 값은 항상 넣는다.
        let gridSize = axes.reduce(1) { $0 * $1.values.count }
        var candidates: [[String: Double]] = []
        let random = gridSize > budget
        if !random {
            candidates = [[:]]
            for a in axes {
                candidates = candidates.flatMap { c in a.values.map { var n = c; n[a.name] = $0; return n } }
            }
        } else {
            var rng = PythonRandom(seed: 0)
            var seen = Set<String>()
            var tries = 0
            while candidates.count < budget && tries < budget * 20 {
                tries += 1
                var c: [String: Double] = [:]
                for a in axes { c[a.name] = rng.choice(a.values) }
                if valid(c) && seen.insert(key(c)).inserted { candidates.append(c) }
            }
        }
        candidates = candidates.filter(valid)
        if !candidates.contains(where: { key($0) == key(original) }) { candidates.append(original) }

        var rows: [Row] = []
        var index: [String: Int] = [:]
        var total = candidates.count + (random ? refine : 0)

        func evaluate(_ params: [String: Double]) throws {
            let r = run(strategy.with(params))
            let ins = metrics(r, bench: bench, legs: legs, from: start, to: split)
            let oos = metrics(r, bench: bench, legs: legs, from: split.adding(days: 1), to: dataEnd)
            let full = metrics(r, bench: bench, legs: legs, from: start, to: dataEnd)
            let (sIn, why) = score(goal, ins, minTrades: minTrades, maxMDD: maxMDD)
            let (sOut, _) = score(goal, oos, minTrades: 0, maxMDD: nil)  // 검증 구간은 짧아 매매 수 제약을 걸지 않는다
            index[key(params)] = rows.count
            rows.append(Row(params: params, inSample: ins, outOfSample: oos, full: full,
                            scoreIn: sIn, scoreOut: sOut, excluded: why, scoreRobust: nil))
            if let progress, !progress(rows.count, total) { throw CancellationError() }
        }

        for c in candidates { try evaluate(c) }

        // 무작위 탐색 뒤: 앞 구간 상위 근처를 한 칸씩 더 본다
        if random {
            let ranked = rows.enumerated()
                .filter { $0.element.scoreIn != nil && $0.element.excluded == nil }
                .sorted { a, b in
                    a.element.scoreIn! != b.element.scoreIn! ? a.element.scoreIn! > b.element.scoreIn! : a.offset < b.offset
                }
                .prefix(topForRefine).map(\.element)
            var extra = 0
            for r in ranked {
                for n in neighbors(r.params, axes) {
                    if extra >= refine { break }
                    if index[key(n)] == nil {
                        try evaluate(n)
                        extra += 1
                    }
                }
            }
            total = rows.count
            _ = progress?(total, total)
        }

        // 고원 점수: 정규화한 파라미터 공간에서 가까운 조합들과 평균낸 앞 구간 점수
        func norm(_ p: [String: Double]) -> [Double] {
            axes.map { a in
                let span = a.values.last! - a.values.first!
                return (p[a.name]! - a.values.first!) / (span != 0 ? span : 1)
            }
        }
        let scored = rows.indices.filter { rows[$0].scoreIn != nil }
        let coords = Dictionary(uniqueKeysWithValues: scored.map { ($0, norm(rows[$0].params)) })
        for i in scored {
            let me = coords[i]!
            let dists = scored.filter { $0 != i }.map { j -> (Double, Double) in
                (zip(me, coords[j]!).map { abs($0 - $1) }.max() ?? 0, rows[j].scoreIn!)
            }.sorted { $0.0 != $1.0 ? $0.0 < $1.0 : $0.1 < $1.1 }
            let near = dists.prefix(neighbors).map(\.1)
            let sum = near.reduce(0, +)
            rows[i].scoreRobust = pyRound((rows[i].scoreIn! + sum) / Double(1 + near.count), 3)
        }

        let eligible = scored.map { rows[$0] }.filter { $0.excluded == nil }
        // 고원 꼭대기는 평평해 같은 점수가 여럿 나온다 — 선택 구간 점수로 가른다 (검증 점수는 쓰지 않는다)
        var recommended: Row?
        for r in eligible {
            guard let best = recommended else { recommended = r; continue }
            let (a, b) = (pyRound(r.scoreRobust!, 1), pyRound(best.scoreRobust!, 1))
            if a > b || (a == b && r.scoreIn! > best.scoreIn!) { recommended = r }
        }
        var peak: Row?
        for r in eligible where peak == nil || r.scoreIn! > peak!.scoreIn! { peak = r }

        func metricsFor(_ from: Day, _ to: Day) -> Metrics? { metrics(bench, bench: bench, legs: legs, from: from, to: to) }
        let sortedRows = rows.enumerated().sorted { a, b in
            let (x, y) = (a.element.scoreRobust, b.element.scoreRobust)
            if (x == nil) != (y == nil) { return x != nil }
            let (vx, vy) = (-(x ?? 0), -(y ?? 0))
            return vx != vy ? vx < vy : a.offset < b.offset
        }.map(\.element)

        return Result(
            goal: goal, random: random, evaluated: rows.count, gridSize: gridSize,
            startDate: start, splitDate: split, endDate: dataEnd, regimeThreshold: pyRound(threshold * 100, 1),
            axes: axes, benchmarkIn: metricsFor(start, split), benchmarkOut: metricsFor(split.adding(days: 1), dataEnd),
            rows: sortedRows, recommended: recommended?.params, peak: peak?.params, original: original
        )
    }

    /// 최적화에 필요한 시세의 첫 날짜 — 파라미터 최댓값 조합의 준비 구간까지
    public static func requiredStart(strategyName: String, start: Day) -> Day {
        guard let s = Strategies.all.first(where: { $0.name == strategyName }) else { return start }
        let longest = Dictionary(uniqueKeysWithValues: s.params.map { ($0.name, $0.range.upperBound) })
        return start.adding(days: -s.with(longest).warmupDays)
    }
}
