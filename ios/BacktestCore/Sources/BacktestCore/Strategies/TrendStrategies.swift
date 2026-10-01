import Foundation

// 추세 추종 전략. 파일 하나에 하나씩인 backend/services/strategies/*.py 를 옮겼다.
// 이름·설명·기본값·범위는 백엔드와 같아야 한다 (정답 테스트가 전략 정의까지 비교한다).

struct BuyAndHold: Strategy {
    var values: [String: Double] = [:]
    let name = "buy_and_hold"
    let displayName = "Buy & Hold"
    let summary = "Buy on the first day and hold until the end. The simplest benchmark strategy."
    let params: [ParamSpec] = []

    func signals(_ bars: [Bar]) -> [Signal] {
        bars.isEmpty ? [] : [Signal(index: 0, action: .buy)]
    }
}

/// Golden Cross 와 MA Crossover 는 기본값만 다르고 계산이 같다.
private struct SMACross {
    let fast: [Double], slow: [Double]

    init(_ bars: [Bar], fast f: Int, slow s: Int) {
        let close = bars.map(\.close)
        fast = Series.mean(close, f)
        slow = Series.mean(close, s)
    }

    func signals(_ bars: [Bar]) -> [Signal] {
        crossoverSignals(rows: Series.validRows([fast, slow], count: bars.count),
                         above: { fast[$0] > slow[$0] }, below: { fast[$0] < slow[$0] })
    }

    func indicators(_ bars: [Bar], fast f: Int, slow s: Int) -> [Indicator] {
        [indicator("MA\(f)", .price, bars, fast, rows: rowsWhere(fast), digits: 4),
         indicator("MA\(s)", .price, bars, slow, rows: rowsWhere(slow), digits: 4)]
    }
}

struct GoldenCross: Strategy {
    var values: [String: Double] = [:]
    let name = "golden_cross"
    let displayName = "Golden Cross (50/200)"
    let summary = "Buy on 50/200 MA golden cross, sell on death cross. Long-term trend strategy."
    let params = [
        ParamSpec("fast_period", 50, 20...100, "Short-term MA period"),
        ParamSpec("slow_period", 200, 100...500, "Long-term MA period"),
    ]

    private func calc(_ bars: [Bar]) -> SMACross {
        SMACross(bars, fast: intParam("fast_period"), slow: intParam("slow_period"))
    }

    func signals(_ bars: [Bar]) -> [Signal] { calc(bars).signals(bars) }

    func indicators(_ bars: [Bar]) -> [Indicator] {
        calc(bars).indicators(bars, fast: intParam("fast_period"), slow: intParam("slow_period"))
    }
}

struct MACrossover: Strategy {
    var values: [String: Double] = [:]
    let name = "ma_crossover"
    let displayName = "Moving Average Crossover"
    let summary = "Buy when fast MA crosses above slow MA, sell when it crosses below."
    let params = [
        ParamSpec("fast_period", 10, 2...200, "Fast moving average period"),
        ParamSpec("slow_period", 50, 5...500, "Slow moving average period"),
    ]

    private func calc(_ bars: [Bar]) -> SMACross {
        SMACross(bars, fast: intParam("fast_period"), slow: intParam("slow_period"))
    }

    func signals(_ bars: [Bar]) -> [Signal] { calc(bars).signals(bars) }

    func indicators(_ bars: [Bar]) -> [Indicator] {
        calc(bars).indicators(bars, fast: intParam("fast_period"), slow: intParam("slow_period"))
    }
}

struct EMACrossover: Strategy {
    var values: [String: Double] = [:]
    let name = "ema_crossover"
    let displayName = "EMA Crossover (Short-term)"
    let summary = "Buy when fast EMA crosses above slow EMA, sell when it crosses below. Faster than SMA crossover."
    let params = [
        ParamSpec("fast_period", 5, 2...50, "Fast EMA period"),
        ParamSpec("slow_period", 20, 5...100, "Slow EMA period"),
    ]

    private func calc(_ bars: [Bar]) -> (fast: [Double], slow: [Double]) {
        let close = bars.map(\.close)
        return (Series.ewm(close, span: intParam("fast_period")), Series.ewm(close, span: intParam("slow_period")))
    }

    func signals(_ bars: [Bar]) -> [Signal] {
        let (f, s) = calc(bars)
        return crossoverSignals(rows: Series.validRows([f, s], count: bars.count),
                                above: { f[$0] > s[$0] }, below: { f[$0] < s[$0] })
    }

    func indicators(_ bars: [Bar]) -> [Indicator] {
        let (f, s) = calc(bars)
        let rows = Series.validRows([f, s], count: bars.count)
        return [indicator("EMA\(intParam("fast_period"))", .price, bars, f, rows: rows, digits: 4),
                indicator("EMA\(intParam("slow_period"))", .price, bars, s, rows: rows, digits: 4)]
    }
}

struct MACDStrategy: Strategy {
    var values: [String: Double] = [:]
    let name = "macd"
    let displayName = "MACD"
    let summary = "Buy when MACD line crosses above signal line, sell when it crosses below."
    let params = [
        ParamSpec("fast_period", 12, 5...50, "Fast EMA period"),
        ParamSpec("slow_period", 26, 10...100, "Slow EMA period"),
        ParamSpec("signal_period", 9, 3...30, "Signal line period"),
    ]

    private func calc(_ bars: [Bar]) -> (macd: [Double], signal: [Double], rows: [Int]) {
        let close = bars.map(\.close)
        let fast = Series.ewm(close, span: intParam("fast_period"))
        let slow = Series.ewm(close, span: intParam("slow_period"))
        let macd = zip(fast, slow).map { $0 - $1 }
        let signal = Series.ewm(macd, span: intParam("signal_period"))
        return (macd, signal, Series.validRows([fast, slow, macd, signal], count: bars.count))
    }

    func signals(_ bars: [Bar]) -> [Signal] {
        let (macd, signal, rows) = calc(bars)
        return crossoverSignals(rows: rows, above: { macd[$0] > signal[$0] }, below: { macd[$0] < signal[$0] })
    }

    func indicators(_ bars: [Bar]) -> [Indicator] {
        let (macd, signal, rows) = calc(bars)
        return [indicator("MACD", .oscillator, bars, macd, rows: rows, digits: 4),
                indicator("Signal", .oscillator, bars, signal, rows: rows, digits: 4)]
    }
}

struct MomentumROC: Strategy {
    var values: [String: Double] = [:]
    let name = "momentum_roc"
    let displayName = "Momentum (ROC)"
    let summary = "Buy when Rate of Change exceeds threshold, sell when it drops below negative threshold."
    let params = [
        ParamSpec("period", 10, 3...50, "ROC lookback period"),
        ParamSpec("buy_threshold", 3.0, 0.5...20, int: false, "Buy when ROC > N%"),
        ParamSpec("sell_threshold", -3.0, -20 ... -0.5, int: false, "Sell when ROC < -N%"),
    ]

    private func roc(_ bars: [Bar]) -> [Double] {
        let close = bars.map(\.close)
        let prev = Series.shift(close, intParam("period"))
        return close.indices.map { (close[$0] - prev[$0]) / prev[$0] * 100 }
    }

    func signals(_ bars: [Bar]) -> [Signal] {
        let roc = roc(bars)
        let buy = param("buy_threshold"), sell = param("sell_threshold")
        var log = SignalLog()
        for i in Series.validRows([roc], count: bars.count) {
            if roc[i] > buy && !log.position { log.buy(i) }
            else if roc[i] < sell && log.position { log.sell(i) }
        }
        return log.signals
    }

    func indicators(_ bars: [Bar]) -> [Indicator] {
        let roc = roc(bars)
        return [indicator("ROC", .oscillator, bars, roc, rows: rowsWhere(roc), digits: 2)]
    }
}

/// True Range. 첫 행은 전일 종가가 없어 h_pc·l_pc 가 NaN 이고, 그 행은 dropna() 로 빠진다.
private func trueRange(_ bars: [Bar]) -> (tr: [Double], hpc: [Double]) {
    let prevClose = Series.shift(bars.map(\.close), 1)
    let hl = bars.map { $0.high - $0.low }
    let hpc = bars.indices.map { abs(bars[$0].high - prevClose[$0]) }
    let lpc = bars.indices.map { abs(bars[$0].low - prevClose[$0]) }
    return (Series.rowMax([hl, hpc, lpc]), hpc)
}

struct ADXTrend: Strategy {
    var values: [String: Double] = [:]
    let name = "adx_trend"
    let displayName = "ADX Trend"
    let summary = "Buy when ADX shows strong trend and +DI > -DI, sell when trend weakens or reverses."
    let params = [
        ParamSpec("period", 14, 5...50, "ADX calculation period"),
        ParamSpec("adx_threshold", 25, 15...50, "ADX strength threshold"),
    ]

    private func calc(_ bars: [Bar]) -> (adx: [Double], plusDI: [Double], minusDI: [Double], rows: [Int]) {
        let period = intParam("period")
        let (tr, hpc) = trueRange(bars)
        let prevHigh = Series.shift(bars.map(\.high), 1)
        let prevLow = Series.shift(bars.map(\.low), 1)
        let up = bars.indices.map { bars[$0].high - prevHigh[$0] }
        let down = bars.indices.map { prevLow[$0] - bars[$0].low }
        // np.where: NaN 비교는 거짓이라 첫 행은 0.0
        let plusDM = bars.indices.map { up[$0] > down[$0] && up[$0] > 0 ? up[$0] : 0.0 }
        let minusDM = bars.indices.map { down[$0] > up[$0] && down[$0] > 0 ? down[$0] : 0.0 }
        let atr = Series.mean(tr, period)
        let pdmMean = Series.mean(plusDM, period), mdmMean = Series.mean(minusDM, period)
        let plusDI = bars.indices.map { pdmMean[$0] / atr[$0] * 100 }
        let minusDI = bars.indices.map { mdmMean[$0] / atr[$0] * 100 }
        let dx = bars.indices.map { i -> Double in
            let total = plusDI[i] + minusDI[i]
            return total == 0 ? .nan : abs(plusDI[i] - minusDI[i]) / total * 100
        }
        let adx = Series.mean(dx, period)
        // up/down 은 hpc 와 같은 행(첫 행)만 NaN 이라 hpc 로 대신 거른다
        return (adx, plusDI, minusDI, Series.validRows([hpc, atr, plusDI, minusDI, dx, adx], count: bars.count))
    }

    func signals(_ bars: [Bar]) -> [Signal] {
        let threshold = Double(intParam("adx_threshold"))
        let (adx, plusDI, minusDI, rows) = calc(bars)
        var log = SignalLog()
        for i in rows {
            if adx[i] > threshold && plusDI[i] > minusDI[i] && !log.position { log.buy(i) }
            else if (adx[i] < threshold || minusDI[i] > plusDI[i]) && log.position { log.sell(i) }
        }
        return log.signals
    }

    func indicators(_ bars: [Bar]) -> [Indicator] {
        let (adx, plusDI, minusDI, rows) = calc(bars)
        return [indicator("ADX", .oscillator, bars, adx, rows: rows, digits: 2),
                indicator("+DI", .oscillator, bars, plusDI, rows: rows, digits: 2),
                indicator("-DI", .oscillator, bars, minusDI, rows: rows, digits: 2)]
    }
}

struct ParabolicSAR: Strategy {
    var values: [String: Double] = [:]
    let name = "parabolic_sar"
    let displayName = "Parabolic SAR"
    let summary = "Buy when SAR flips below price (uptrend), sell when SAR flips above price (downtrend)."
    let params = [
        ParamSpec("af_start", 0.02, 0.01...0.1, int: false, "Acceleration factor start"),
        ParamSpec("af_max", 0.2, 0.1...0.5, int: false, "Acceleration factor maximum"),
    ]

    /// 기간 파라미터가 없어 기본 규칙으로는 0이 된다. SAR 은 첫 봉에서 재귀로 이어지므로
    /// 60일을 먼저 돌려 궤적을 안정시킨다.
    var warmupBars: Int { 60 }

    func sar(_ bars: [Bar]) -> [Double] {
        let afStart = param("af_start"), afMax = param("af_max")
        let n = bars.count
        guard n > 0 else { return [] }
        let high = bars.map(\.high), low = bars.map(\.low)
        var sar = [Double](repeating: 0, count: n)
        var af = afStart
        var uptrend = true
        var ep = high[0]
        sar[0] = low[0]
        for i in 1..<n {
            if uptrend {
                sar[i] = sar[i - 1] + af * (ep - sar[i - 1])
                sar[i] = Swift.min(sar[i], low[i - 1])
                if i >= 2 { sar[i] = Swift.min(sar[i], low[i - 2]) }
                if low[i] < sar[i] {
                    uptrend = false
                    sar[i] = ep
                    ep = low[i]
                    af = afStart
                } else if high[i] > ep {
                    ep = high[i]
                    af = Swift.min(af + afStart, afMax)
                }
            } else {
                sar[i] = sar[i - 1] + af * (ep - sar[i - 1])
                sar[i] = Swift.max(sar[i], high[i - 1])
                if i >= 2 { sar[i] = Swift.max(sar[i], high[i - 2]) }
                if high[i] > sar[i] {
                    uptrend = true
                    sar[i] = ep
                    ep = high[i]
                    af = afStart
                } else if low[i] < ep {
                    ep = low[i]
                    af = Swift.min(af + afStart, afMax)
                }
            }
        }
        return sar
    }

    func signals(_ bars: [Bar]) -> [Signal] {
        let s = sar(bars)
        let above = { (i: Int) in bars[i].close > s[i] }
        return crossoverSignals(rows: Array(bars.indices), above: above, below: { !above($0) })
    }

    func indicators(_ bars: [Bar]) -> [Indicator] {
        [indicator("SAR", .price, bars, sar(bars), rows: Array(bars.indices), digits: 4)]
    }
}

struct KeltnerChannel: Strategy {
    var values: [String: Double] = [:]
    let name = "keltner"
    let displayName = "Keltner Channel"
    let summary = "Buy on upper channel breakout (trend following), sell on lower channel breakdown."
    let params = [
        ParamSpec("ema_period", 20, 5...100, "EMA period for middle line"),
        ParamSpec("atr_period", 10, 3...50, "ATR period"),
        ParamSpec("atr_mult", 2.0, 0.5...5, int: false, "ATR multiplier for channel width"),
    ]

    private func calc(_ bars: [Bar]) -> (ema: [Double], upper: [Double], lower: [Double], rows: [Int]) {
        let mult = param("atr_mult")
        let ema = Series.ewm(bars.map(\.close), span: intParam("ema_period"))
        let (tr, hpc) = trueRange(bars)
        let atr = Series.mean(tr, intParam("atr_period"))
        let upper = bars.indices.map { ema[$0] + mult * atr[$0] }
        let lower = bars.indices.map { ema[$0] - mult * atr[$0] }
        return (ema, upper, lower, Series.validRows([ema, hpc, atr, upper, lower], count: bars.count))
    }

    func signals(_ bars: [Bar]) -> [Signal] {
        let (_, upper, lower, rows) = calc(bars)
        var log = SignalLog()
        for i in rows {
            if bars[i].close > upper[i] && !log.position { log.buy(i) }
            else if bars[i].close < lower[i] && log.position { log.sell(i) }
        }
        return log.signals
    }

    func indicators(_ bars: [Bar]) -> [Indicator] {
        let (ema, upper, lower, rows) = calc(bars)
        return [indicator("EMA", .price, bars, ema, rows: rows, digits: 4),
                indicator("Upper", .price, bars, upper, rows: rows, digits: 4),
                indicator("Lower", .price, bars, lower, rows: rows, digits: 4)]
    }
}

struct BreakoutStrategy: Strategy {
    var values: [String: Double] = [:]
    let name = "breakout"
    let displayName = "Breakout (Donchian)"
    let summary = "Buy on N-day high breakout, sell on M-day low breakdown. Trend-following breakout strategy."
    let params = [
        ParamSpec("entry_period", 20, 5...100, "Entry breakout period (N-day high)"),
        ParamSpec("exit_period", 10, 3...50, "Exit breakdown period (M-day low)"),
    ]

    private func calc(_ bars: [Bar]) -> (highN: [Double], lowM: [Double], rows: [Int]) {
        let highN = Series.max(bars.map(\.high), intParam("entry_period"))
        let lowM = Series.min(bars.map(\.low), intParam("exit_period"))
        return (highN, lowM, Series.validRows([highN, lowM], count: bars.count))
    }

    func signals(_ bars: [Bar]) -> [Signal] {
        let (highN, lowM, rows) = calc(bars)
        var log = SignalLog()
        // 전날까지의 N일 고가를 넘으면 산다 — 첫 유효 행은 비교할 전날이 없다
        for k in rows.indices.dropFirst() {
            let prev = rows[k - 1], i = rows[k]
            if bars[i].close > highN[prev] && !log.position { log.buy(i) }
            else if bars[i].close < lowM[prev] && log.position { log.sell(i) }
        }
        return log.signals
    }

    func indicators(_ bars: [Bar]) -> [Indicator] {
        let (highN, lowM, rows) = calc(bars)
        return [indicator("\(intParam("entry_period"))D High", .price, bars, highN, rows: rows, digits: 4),
                indicator("\(intParam("exit_period"))D Low", .price, bars, lowM, rows: rows, digits: 4)]
    }
}
