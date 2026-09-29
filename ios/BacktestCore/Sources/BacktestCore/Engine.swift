import Foundation

public enum InvestMode: String, Codable, Sendable, CaseIterable {
    /// 거치식: 첫날 원금을 한 번에 넣는다
    case lumpSum = "lump_sum"
    /// 적립식: 매달 같은 금액을 넣는다
    case dca
}

public struct Trade: Sendable {
    public let date: Day
    public let action: Action
    public let price: Double
    public let shares: Int
    public let pnl: Double
}

struct EngineResult {
    let totalReturn: Double
    let cagr: Double
    let sharpe: Double
    let maxDrawdown: Double
    let winRate: Double
    let totalInvested: Double
    /// 매매 구간의 날짜별 평가금액 (소수 둘째 자리 반올림)
    let equity: [(date: Day, equity: Double)]
    let trades: [Trade]
}

/// backend/services/backtest_engine.py run_backtest().
///
/// `bars` 에 `tradeStart` 보다 앞의 시세(지표 준비 구간)가 있으면 신호는 전체로 계산하되
/// 매매·입금·평가금액은 `tradeStart` 부터 센다. 준비 구간의 마지막 신호가 BUY 였다면
/// 전략은 시작일에 이미 보유 중이어야 하므로 첫 거래일에 산다.
func runBacktest(
    bars: [Bar], strategy: any Strategy, initialCapital: Double,
    monthlyContribution: Double, mode: InvestMode, tradeStart: Day
) -> EngineResult {
    var actions: [Int: Action] = [:]
    var carried: Action?
    for s in strategy.signals(bars) {
        actions[s.index] = s.action
        if bars[s.index].date < tradeStart { carried = s.action }
    }
    let first = bars.firstIndex { $0.date >= tradeStart } ?? bars.count
    if carried == .buy, first < bars.count, actions[first] == nil {
        actions[first] = .buy
    }

    var cash: Double
    var totalInvested: Double
    switch mode {
    case .dca: cash = monthlyContribution; totalInvested = monthlyContribution
    case .lumpSum: cash = initialCapital; totalInvested = initialCapital
    }
    var shares = 0
    var buyPrice = 0.0
    var equity: [(date: Day, equity: Double)] = []
    var trades: [Trade] = []
    var lastMonth: (Int, Int)?
    // 날마다 평가금액에 더해진 입금액. 적립식 지표에서 입금 효과를 걷어내는 데 쓴다.
    var contributions: [Double] = []
    // (입금일, 금액). 적립식 IRR 용. 첫 입금은 첫 거래일이다.
    var flows: [(Day, Double)] = []

    for i in first..<bars.count {
        let bar = bars[i]
        let close = bar.close

        if mode == .dca {
            let month = (bar.date.year, bar.date.month)
            var contributed = 0.0
            if lastMonth == nil {
                lastMonth = month
                flows.append((bar.date, monthlyContribution))
            } else if month != lastMonth! {
                cash += monthlyContribution
                totalInvested += monthlyContribution
                lastMonth = month
                flows.append((bar.date, monthlyContribution))
                contributed = monthlyContribution
                // 보유 중이면 새로 넣은 돈으로 바로 더 산다
                if shares > 0 {
                    let newShares = Int(pyFloorDiv(monthlyContribution, close))
                    if newShares > 0 {
                        let cost = buyPrice * Double(shares) + close * Double(newShares)
                        shares += newShares
                        buyPrice = cost / Double(shares)
                        cash -= Double(newShares) * close
                        trades.append(Trade(date: bar.date, action: .buy, price: pyRound(close, 4),
                                            shares: newShares, pnl: 0))
                    }
                }
            }
            contributions.append(contributed)
        }

        switch actions[i] {
        case .buy where shares == 0:
            shares = Int(pyFloorDiv(cash, close))
            if shares > 0 {
                buyPrice = close
                cash -= Double(shares) * close
                trades.append(Trade(date: bar.date, action: .buy, price: pyRound(close, 4), shares: shares, pnl: 0))
            }
        case .sell where shares > 0:
            let pnl = (close - buyPrice) * Double(shares)
            cash += Double(shares) * close
            trades.append(Trade(date: bar.date, action: .sell, price: pyRound(close, 4), shares: shares,
                                pnl: pyRound(pnl, 2)))
            shares = 0
        default:
            break
        }

        equity.append((bar.date, pyRound(cash + Double(shares) * close, 2)))
    }

    let values = equity.map(\.equity)
    let sellPnls = trades.filter { $0.action == .sell }.map(\.pnl)
    let finalEquity = values.last ?? totalInvested
    let ret = totalInvested > 0 ? (finalEquity - totalInvested) / totalInvested * 100 : 0
    let span = equity.count >= 2 ? equity.last!.date - equity.first!.date : 0

    let flowsByDay: [Double]?
    let cagrValue: Double
    if mode == .dca && equity.count >= 2 {
        flowsByDay = contributions
        cagrValue = Metrics.moneyWeightedCAGR(flows: flows, finalValue: finalEquity, end: equity.last!.date)
    } else {
        flowsByDay = nil
        cagrValue = Metrics.cagr(invested: totalInvested, finalValue: finalEquity, days: span)
    }

    return EngineResult(
        totalReturn: pyRound(ret, 2),
        cagr: pyRound(cagrValue, 2),
        sharpe: pyRound(Metrics.sharpe(values, contributions: flowsByDay), 4),
        maxDrawdown: pyRound(Metrics.maxDrawdown(values, contributions: flowsByDay), 2),
        winRate: pyRound(Metrics.winRate(sellPnls), 2),
        totalInvested: pyRound(totalInvested, 2),
        equity: equity,
        trades: trades
    )
}
