import Foundation

// 과매수·과매도와 평균 회귀 전략, 그리고 추세 필터를 곁들인 Dual MA + RSI.

/// 단순 이동평균 RSI (Wilder 평활 아님 — 백엔드와 같다). 평균 손실이 0이면 NaN 이라 그날은 빠진다.
private func rsi(_ close: [Double], _ period: Int) -> [Double] {
    let delta = Series.diff(close)
    // delta.where(delta > 0, 0.0): 첫 행의 NaN 도 0.0 이 된다
    let gain = delta.map { $0 > 0 ? $0 : 0.0 }
    let loss = delta.map { $0 < 0 ? -$0 : 0.0 }
    let avgGain = Series.mean(gain, period), avgLoss = Series.mean(loss, period)
    return close.indices.map { i in
        guard avgLoss[i] != 0 else { return .nan }
        return 100 - 100 / (1 + avgGain[i] / avgLoss[i])
    }
}

struct DualMARSI: Strategy {
    let name = "dual_ma_rsi"
    let displayName = "Dual MA + RSI"
    let summary = "Buy when MA trend is up AND RSI is oversold. Sell when MA trend is down AND RSI is overbought."
    let params = [
        ParamSpec("fast_period", 20, "Fast MA period (trend filter)"),
        ParamSpec("slow_period", 50, "Slow MA period (trend filter)"),
        ParamSpec("rsi_period", 14, "RSI period (timing)"),
        ParamSpec("rsi_buy", 40, "RSI buy threshold (in uptrend)"),
        ParamSpec("rsi_sell", 60, "RSI sell threshold (in downtrend)"),
    ]

    func signals(_ bars: [Bar]) -> [Signal] {
        let close = bars.map(\.close)
        let fast = Series.mean(close, intParam("fast_period"))
        let slow = Series.mean(close, intParam("slow_period"))
        let r = rsi(close, intParam("rsi_period"))
        let buy = Double(intParam("rsi_buy")), sell = Double(intParam("rsi_sell"))
        var log = SignalLog()
        for i in Series.validRows([fast, slow, r], count: bars.count) {
            if fast[i] > slow[i] && r[i] < buy && !log.position { log.buy(i) }
            else if fast[i] < slow[i] && r[i] > sell && log.position { log.sell(i) }
        }
        return log.signals
    }
}

struct RSIStrategy: Strategy {
    let name = "rsi"
    let displayName = "RSI Overbought/Oversold"
    let summary = "Buy when RSI drops below oversold level, sell when it rises above overbought level."
    let params = [
        ParamSpec("period", 14, "RSI calculation period"),
        ParamSpec("oversold", 30, "Oversold threshold (buy signal)"),
        ParamSpec("overbought", 70, "Overbought threshold (sell signal)"),
    ]

    func signals(_ bars: [Bar]) -> [Signal] {
        let r = rsi(bars.map(\.close), intParam("period"))
        let oversold = Double(intParam("oversold")), overbought = Double(intParam("overbought"))
        var log = SignalLog()
        for i in Series.validRows([r], count: bars.count) {
            if r[i] < oversold && !log.position { log.buy(i) }
            else if r[i] > overbought && log.position { log.sell(i) }
        }
        return log.signals
    }
}

struct BollingerBands: Strategy {
    let name = "bollinger"
    let displayName = "Bollinger Bands"
    let summary = "Buy when price touches lower band, sell when price touches upper band (mean reversion)."
    let params = [
        ParamSpec("period", 20, "Bollinger Bands period"),
        ParamSpec("std_dev", 2.0, int: false, "Standard deviation multiplier"),
    ]

    func signals(_ bars: [Bar]) -> [Signal] {
        let close = bars.map(\.close)
        let period = intParam("period"), k = param("std_dev")
        let sma = Series.mean(close, period), sd = Series.std(close, period)
        let upper = close.indices.map { sma[$0] + k * sd[$0] }
        let lower = close.indices.map { sma[$0] - k * sd[$0] }
        var log = SignalLog()
        for i in Series.validRows([sma, sd, upper, lower], count: bars.count) {
            if close[i] <= lower[i] && !log.position { log.buy(i) }
            else if close[i] >= upper[i] && log.position { log.sell(i) }
        }
        return log.signals
    }
}

struct StochasticOscillator: Strategy {
    let name = "stochastic"
    let displayName = "Stochastic Oscillator"
    let summary = "Buy when %K crosses above %D in oversold zone, sell when crosses below in overbought zone."
    let params = [
        ParamSpec("k_period", 14, "%K lookback period"),
        ParamSpec("d_period", 3, "%D smoothing period"),
        ParamSpec("oversold", 20, "Oversold threshold"),
        ParamSpec("overbought", 80, "Overbought threshold"),
    ]

    func signals(_ bars: [Bar]) -> [Signal] {
        let kp = intParam("k_period")
        let lowMin = Series.min(bars.map(\.low), kp), highMax = Series.max(bars.map(\.high), kp)
        let k = bars.indices.map { (bars[$0].close - lowMin[$0]) / (highMax[$0] - lowMin[$0]) * 100 }
        let d = Series.mean(k, intParam("d_period"))
        let oversold = Double(intParam("oversold")), overbought = Double(intParam("overbought"))
        let rows = Series.validRows([k, d], count: bars.count)
        var log = SignalLog()
        for idx in rows.indices.dropFirst() {
            let p = rows[idx - 1], i = rows[idx]
            if k[p] <= d[p] && k[i] > d[i] && k[i] < oversold && !log.position { log.buy(i) }
            else if k[p] >= d[p] && k[i] < d[i] && k[i] > overbought && log.position { log.sell(i) }
        }
        return log.signals
    }
}

struct VWAPStrategy: Strategy {
    let name = "vwap"
    let displayName = "VWAP Reversion"
    let summary = "Buy when price drops below VWAP by threshold, sell when price rises above VWAP by threshold."
    let params = [
        ParamSpec("period", 20, "Rolling VWAP period (days)"),
        ParamSpec("buy_threshold", -2.0, int: false, "Buy when price is N% below VWAP"),
        ParamSpec("sell_threshold", 2.0, int: false, "Sell when price is N% above VWAP"),
    ]

    func signals(_ bars: [Bar]) -> [Signal] {
        let period = intParam("period")
        let volPrice = Series.sum(bars.map { $0.close * $0.volume }, period)
        let vol = Series.sum(bars.map(\.volume), period)
        let vwap = bars.indices.map { volPrice[$0] / vol[$0] }
        let pct = bars.indices.map { (bars[$0].close - vwap[$0]) / vwap[$0] * 100 }
        let buy = param("buy_threshold"), sell = param("sell_threshold")
        var log = SignalLog()
        for i in Series.validRows([volPrice, vol, vwap, pct], count: bars.count) {
            if pct[i] < buy && !log.position { log.buy(i) }
            else if pct[i] > sell && log.position { log.sell(i) }
        }
        return log.signals
    }
}
