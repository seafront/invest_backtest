import Foundation

/// pandas 연산을 옮긴 것. 빈 값은 pandas 처럼 NaN 으로 두어, NaN 과의 비교가 늘 거짓이 되는
/// 성질까지 그대로 가져온다 (지표가 준비되기 전 구간에서 신호가 나지 않는 이유가 이것이다).
///
/// 창 계산은 창마다 새로 더한다. pandas 는 이동하며 더하고 빼지만(보정 합), 결과 차이는
/// 1e-15 수준이고, 창 안 값이 모두 0이면 둘 다 정확히 0을 낸다 — RSI 의 "손실 0 → NaN" 처리가
/// 여기에 기대므로 중요하다.
enum Series {
    /// rolling(window).mean() — 창에 NaN 이 하나라도 있으면 NaN (min_periods = window)
    static func mean(_ xs: [Double], _ window: Int) -> [Double] {
        rolling(xs, window) { w in
            // pandas 는 창 안 값이 모두 같으면 그 값을 그대로 낸다. 더해서 나누면 끝자리가 달라질 수 있다.
            allEqual(w) ? w.first! : w.reduce(0, +) / Double(w.count)
        }
    }

    static func sum(_ xs: [Double], _ window: Int) -> [Double] {
        rolling(xs, window) { w in w.reduce(0, +) }
    }

    static func max(_ xs: [Double], _ window: Int) -> [Double] {
        rolling(xs, window) { w in w.max()! }
    }

    static func min(_ xs: [Double], _ window: Int) -> [Double] {
        rolling(xs, window) { w in w.min()! }
    }

    /// rolling(window).std() — 표본 표준편차(ddof=1)
    static func std(_ xs: [Double], _ window: Int) -> [Double] {
        rolling(xs, window) { w in
            guard w.count > 1 else { return .nan }
            // pandas 는 값이 모두 같으면 정확히 0을 낸다. 직접 계산하면 평균의 끝자리 오차로 1e-15 쯤이
            // 남아, 볼린저 밴드가 가격과 같아지는(하단 터치) 판정이 뒤집힌다. 상장 전 구간을 같은
            // 가격으로 채운 종목(FER: 2020–2024 거래량 0)에서 매매 횟수가 41 → 19로 어긋났다.
            if allEqual(w) { return 0 }
            let m = w.reduce(0, +) / Double(w.count)
            let ss = w.reduce(0) { $0 + ($1 - m) * ($1 - m) }
            return (ss / Double(w.count - 1)).squareRoot()
        }
    }

    private static func allEqual(_ w: ArraySlice<Double>) -> Bool {
        w.allSatisfy { $0 == w.first! }
    }

    private static func rolling(_ xs: [Double], _ window: Int, _ f: (ArraySlice<Double>) -> Double) -> [Double] {
        var out = [Double](repeating: .nan, count: xs.count)
        guard window > 0, xs.count >= window else { return out }
        for i in (window - 1)..<xs.count {
            let w = xs[(i - window + 1)...i]
            if w.contains(where: { $0.isNaN }) { continue }
            out[i] = f(w)
        }
        return out
    }

    /// ewm(span, adjust=False).mean() — y0 = x0, yt = (1-a)·yt-1 + a·xt
    static func ewm(_ xs: [Double], span: Int) -> [Double] {
        let a = 2.0 / (Double(span) + 1)
        var out = [Double](repeating: .nan, count: xs.count)
        var prev: Double?
        for (i, x) in xs.enumerated() {
            guard !x.isNaN else { out[i] = prev ?? .nan; continue }
            let y = prev.map { (1 - a) * $0 + a * x } ?? x
            out[i] = y
            prev = y
        }
        return out
    }

    /// shift(n)
    static func shift(_ xs: [Double], _ n: Int) -> [Double] {
        xs.indices.map { $0 >= n ? xs[$0 - n] : .nan }
    }

    /// diff()
    static func diff(_ xs: [Double]) -> [Double] {
        xs.indices.map { $0 >= 1 ? xs[$0] - xs[$0 - 1] : .nan }
    }

    /// 행마다 여러 열이 모두 NaN 이 아닌 행 번호. df.dropna() 에 해당한다.
    static func validRows(_ columns: [[Double]], count: Int) -> [Int] {
        (0..<count).filter { i in columns.allSatisfy { !$0[i].isNaN } }
    }

    /// 열끼리 NaN 을 건너뛴 최댓값. df[[a, b, c]].max(axis=1)
    static func rowMax(_ columns: [[Double]]) -> [Double] {
        columns[0].indices.map { i in
            let vals = columns.map { $0[i] }.filter { !$0.isNaN }
            return vals.max() ?? .nan
        }
    }
}

/// 파이썬 round(x, n). 이진 값 그대로를 기준으로 가장 가까운 짝수 쪽으로 반올림한다.
/// x·10ⁿ 을 곱해 반올림하면 곱셈 오차로 경계값에서 결과가 달라진다.
/// 백엔드가 평가금액을 매일 반올림한 뒤 지표를 계산하므로 똑같이 해야 결과가 맞는다.
@inline(__always)
func pyRound(_ x: Double, _ n: Int) -> Double {
    guard x.isFinite else { return x }
    return Double(String(format: "%.\(n)f", x))!
}

/// 파이썬 a // b (float). CPython float_floor_div 를 그대로 옮겼다.
/// a / b 를 내림하면, 몫이 정수 바로 아래일 때 나눗셈 반올림으로 정수가 되어 1주를 더 사게 된다.
func pyFloorDiv(_ a: Double, _ b: Double) -> Double {
    var mod = fmod(a, b)
    var div = (a - mod) / b
    if mod != 0 {
        if (b < 0) != (mod < 0) {
            mod += b
            div -= 1
        }
    }
    guard div != 0 else { return (0.0).copysign(a / b) }
    var floordiv = div.rounded(.down)
    if div - floordiv > 0.5 { floordiv += 1 }
    return floordiv
}

private extension Double {
    func copysign(_ s: Double) -> Double { Double(signOf: s, magnitudeOf: self) }
}
