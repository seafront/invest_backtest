import Foundation

/// backend/utils/metrics.py
enum Metrics {
    /// 일간 수익률. 입금이 있으면 그날 들어온 돈은 수익에서 뺀다 (시간가중수익률).
    static func dailyReturns(_ equity: [Double], contributions: [Double]?) -> [Double] {
        guard equity.count >= 2 else { return [] }
        var out: [Double] = []
        for i in 1..<equity.count where equity[i - 1] != 0 {
            let flow = contributions?[i] ?? 0
            out.append((equity[i] - flow) / equity[i - 1] - 1)
        }
        return out
    }

    /// 연환산 Sharpe (×√252, 무위험 2%). np.std 는 모표준편차(ddof=0)다.
    static func sharpe(_ equity: [Double], riskFree: Double = 0.02, contributions: [Double]? = nil) -> Double {
        guard equity.count >= 2 else { return 0 }
        let r = dailyReturns(equity, contributions: contributions)
        guard r.count >= 2 else { return 0 }
        let excess = r.map { $0 - riskFree / 252 }
        let sd = std(excess)
        guard std(r) != 0, sd != 0 else { return 0 }
        return mean(excess) / sd * 252.0.squareRoot()
    }

    /// 최대 낙폭(%). 입금이 있으면 입금 효과를 뺀 수익률 지수로 잰다.
    static func maxDrawdown(_ equity: [Double], contributions: [Double]? = nil) -> Double {
        guard equity.count >= 2 else { return 0 }
        var curve = equity
        if let c = contributions, c.contains(where: { $0 != 0 }) {
            var idx = 1.0
            curve = [1.0]
            for r in dailyReturns(equity, contributions: c) {
                idx *= 1 + r
                curve.append(idx)
            }
        }
        var peak = curve[0], mdd = 0.0
        for v in curve {
            if v > peak { peak = v }
            if peak > 0 { mdd = Swift.max(mdd, (peak - v) / peak * 100) }
        }
        return mdd
    }

    static func cagr(invested: Double, finalValue: Double, days: Int) -> Double {
        guard invested > 0, finalValue > 0, days > 0 else { return 0 }
        let years = Double(days) / 365.25
        guard years >= 0.1 else { return 0 }
        return (pow(finalValue / invested, 1 / years) - 1) * 100
    }

    /// 입금 시점을 반영한 연환산 수익률(IRR, %). NPV 가 이율에 단조라 이분법으로 찾는다.
    static func moneyWeightedCAGR(flows: [(Day, Double)], finalValue: Double, end: Day) -> Double {
        let flows = flows.filter { $0.1 > 0 }
        guard let first = flows.first, finalValue > 0 else { return 0 }
        guard Double(end - first.0) / 365.25 >= 0.1 else { return 0 }
        func grown(_ rate: Double) -> Double {
            flows.reduce(0) { $0 + $1.1 * pow(1 + rate, Double(end - $1.0) / 365.25) }
        }
        var lo = -0.9999, hi = 1.0
        while grown(hi) < finalValue && hi < 1e6 { hi *= 2 }
        for _ in 0..<200 {
            let mid = (lo + hi) / 2
            if grown(mid) < finalValue { lo = mid } else { hi = mid }
        }
        return (lo + hi) / 2 * 100
    }

    /// 청산(SELL)한 매매 중 이익을 낸 비율(%)
    static func winRate(_ pnls: [Double]) -> Double {
        pnls.isEmpty ? 0 : Double(pnls.filter { $0 > 0 }.count) / Double(pnls.count) * 100
    }

    private static func mean(_ xs: [Double]) -> Double { xs.reduce(0, +) / Double(xs.count) }

    private static func std(_ xs: [Double]) -> Double {
        let m = mean(xs)
        return (xs.reduce(0) { $0 + ($1 - m) * ($1 - m) } / Double(xs.count)).squareRoot()
    }
}
