import Foundation

/// pandas 연산을 옮긴 것. 빈 값은 pandas 처럼 NaN 으로 두어, NaN 과의 비교가 늘 거짓이 되는
/// 성질까지 그대로 가져온다 (지표가 준비되기 전 구간에서 신호가 나지 않는 이유가 이것이다).
///
/// 이동 합·평균·표준편차는 pandas 2.2.3 의 알고리즘(_libs/window/aggregations.pyx)을 그대로 옮겼다.
/// 창을 밀며 Kahan 보정으로 더하고 빼므로 끝자리 오차가 창마다 새로 더한 값과 다르다. 두 선이
/// 수학적으로 같은 날(예: %K == %D)에는 그 끝자리가 교차 판정을 가른다 — 창마다 더하던 구현은
/// 007310.KS Stochastic 에서 매수일이 나흘 어긋났다. 창 안 값이 모두 같으면 그 값(표준편차는 0)을
/// 그대로 내는 규칙도 여기서 온다 (FER 상장 전 같은 가격 구간의 볼린저 밴드).
enum Series {
    /// pandas 의 이동 창 누적값 (roll_sum / roll_mean 공통). NaN 은 개수에 넣지 않는다.
    private struct KahanWindow {
        var nobs = 0, negCount = 0
        var sum = 0.0, compAdd = 0.0, compRemove = 0.0
        var sameRun = 0
        var prev: Double

        init(first: Double) { prev = first }

        mutating func add(_ v: Double) {
            guard !v.isNaN else { return }
            nobs += 1
            let y = v - compAdd
            let t = sum + y
            compAdd = t - sum - y
            sum = t
            if v.sign == .minus { negCount += 1 }  // signbit: -0.0 도 센다
            sameRun = v == prev ? sameRun + 1 : 1
            prev = v
        }

        mutating func remove(_ v: Double) {
            guard !v.isNaN else { return }
            nobs -= 1
            let y = -v - compRemove
            let t = sum + y
            compRemove = t - sum - y
            sum = t
            if v.sign == .minus { negCount -= 1 }
        }
    }

    /// 창 i 는 [i-window+1, i]. 앞 창에서 빠지는 값을 먼저 빼고 새 값을 더한다 (pandas 순서).
    private static func slide<State>(_ xs: [Double], _ window: Int, _ state: inout State,
                                     remove: (inout State, Double) -> Void, add: (inout State, Double) -> Void,
                                     output: (State) -> Double) -> [Double] {
        var out = [Double](repeating: .nan, count: xs.count)
        guard window > 0 else { return out }
        for i in xs.indices {
            if i >= window { remove(&state, xs[i - window]) }
            add(&state, xs[i])
            out[i] = output(state)
        }
        return out
    }

    /// rolling(window).mean() — 창의 NaN 아닌 값이 window 개 미만이면 NaN (min_periods = window)
    static func mean(_ xs: [Double], _ window: Int) -> [Double] {
        guard let first = xs.first else { return [] }
        var w = KahanWindow(first: first)
        return slide(xs, window, &w, remove: { $0.remove($1) }, add: { $0.add($1) }) { w in
            guard w.nobs >= window, w.nobs > 0 else { return .nan }
            if w.sameRun >= w.nobs { return w.prev }
            let r = w.sum / Double(w.nobs)
            if w.negCount == 0 && r < 0 { return 0 }
            if w.negCount == w.nobs && r > 0 { return 0 }
            return r
        }
    }

    /// rolling(window).sum()
    static func sum(_ xs: [Double], _ window: Int) -> [Double] {
        guard let first = xs.first else { return [] }
        var w = KahanWindow(first: first)
        return slide(xs, window, &w, remove: { $0.remove($1) }, add: { $0.add($1) }) { w in
            guard w.nobs >= window else { return .nan }
            return w.sameRun >= w.nobs ? w.prev * Double(w.nobs) : w.sum
        }
    }

    /// Welford 온라인 분산 (roll_var). 더할 때와 뺄 때 보정값을 따로 둔다.
    private struct WelfordWindow {
        var nobs = 0.0, mean = 0.0, ssqdm = 0.0, compAdd = 0.0, compRemove = 0.0
        var sameRun = 0
        var prev: Double

        init(first: Double) { prev = first }

        mutating func add(_ v: Double) {
            guard !v.isNaN else { return }
            nobs += 1
            sameRun = v == prev ? sameRun + 1 : 1
            prev = v
            let prevMean = mean - compAdd
            let y = v - compAdd
            let t = y - mean
            compAdd = t + mean - y
            mean = nobs != 0 ? mean + t / nobs : 0
            ssqdm += (v - prevMean) * (v - mean)
        }

        mutating func remove(_ v: Double) {
            guard !v.isNaN else { return }
            nobs -= 1
            if nobs != 0 {
                let prevMean = mean - compRemove
                let y = v - compRemove
                let t = y - mean
                compRemove = t + mean - y
                mean -= t / nobs
                ssqdm -= (v - prevMean) * (v - mean)
            } else {
                mean = 0
                ssqdm = 0
            }
        }
    }

    /// rolling(window).std() — 표본 표준편차(ddof=1). 음수로 떨어진 분산은 0 (zsqrt).
    static func std(_ xs: [Double], _ window: Int) -> [Double] {
        guard let first = xs.first else { return [] }
        var w = WelfordWindow(first: first)
        return slide(xs, window, &w, remove: { $0.remove($1) }, add: { $0.add($1) }) { w in
            guard w.nobs >= Double(Swift.max(window, 1)), w.nobs > 1 else { return .nan }
            if w.sameRun >= Int(w.nobs) { return 0 }
            let variance = w.ssqdm / (w.nobs - 1)
            return variance < 0 ? 0 : variance.squareRoot()
        }
    }

    static func max(_ xs: [Double], _ window: Int) -> [Double] {
        rolling(xs, window) { w in w.max()! }
    }

    static func min(_ xs: [Double], _ window: Int) -> [Double] {
        rolling(xs, window) { w in w.min()! }
    }

    /// 최댓값·최솟값은 더하지 않아 오차가 없다 — 창마다 그대로 고른다
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

/// numpy 실수의 round(x, n) (np.around: x·10ⁿ 을 짝수 쪽으로 반올림한 뒤 10ⁿ 으로 나눈다).
/// 지표 값은 pandas 에서 꺼낸 numpy 실수라 파이썬 round 가 아니라 이 방식으로 반올림된다.
func npRound(_ x: Double, _ n: Int) -> Double {
    guard x.isFinite else { return x }
    let scale = pow(10.0, Double(n))
    return (x * scale).rounded(.toNearestOrEven) / scale
}
