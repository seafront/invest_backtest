import Foundation

/// 일봉 한 줄. 가격은 수정주가(분할·배당 반영)다.
public struct Bar: Codable, Hashable, Sendable {
    public let date: Day
    public let open: Double
    public let high: Double
    public let low: Double
    public let close: Double
    public let volume: Double

    public init(date: Day, open: Double, high: Double, low: Double, close: Double, volume: Double) {
        self.date = date
        self.open = open
        self.high = high
        self.low = low
        self.close = close
        self.volume = volume
    }
}

public enum Action: String, Sendable {
    case buy = "BUY"
    case sell = "SELL"
}

/// 매매 신호. 백엔드는 날마다 HOLD 까지 내지만 엔진은 BUY/SELL 만 쓰므로 그것만 싣는다.
public struct Signal: Sendable {
    /// 전략에 넘긴 bars 안의 위치
    public let index: Int
    public let action: Action
}

public struct ParamSpec: Sendable {
    public let name: String
    public let defaultValue: Double
    public let isInt: Bool
    public let description: String

    public init(_ name: String, _ defaultValue: Double, int isInt: Bool = true, _ description: String) {
        self.name = name
        self.defaultValue = defaultValue
        self.isInt = isInt
        self.description = description
    }
}

/// backend/services/strategies/base.py 의 Strategy. 앱은 기본 파라미터로만 돌린다.
public protocol Strategy: Sendable {
    var name: String { get }
    var displayName: String { get }
    var summary: String { get }
    var params: [ParamSpec] { get }
    func signals(_ bars: [Bar]) -> [Signal]
    /// 시작일 전에 더 불러올 거래일 수
    var warmupBars: Int { get }
}

extension Strategy {
    /// 이름이 period 로 끝나는 파라미터 중 가장 긴 것의 2배 + 20일.
    public var warmupBars: Int {
        let periods = params.filter { $0.name.hasSuffix("period") }.map(\.defaultValue)
        guard let longest = periods.max() else { return 0 }
        return Int(longest * 2) + 20
    }

    /// 시작일 전에 더 불러올 달력 일수 (backtest_engine.warmup_days)
    public var warmupDays: Int {
        warmupBars > 0 ? Int(Double(warmupBars) * 365 / 252) + 10 : 0
    }

    func param(_ name: String) -> Double {
        params.first { $0.name == name }!.defaultValue
    }

    func intParam(_ name: String) -> Int { Int(param(name)) }
}

/// 신호 루프에서 쓰는 보조. 파이썬 전략들의 `position` 플래그와 BUY/SELL 기록을 한데 묶었다.
struct SignalLog {
    private(set) var signals: [Signal] = []
    private(set) var position = false

    mutating func buy(_ i: Int) {
        signals.append(Signal(index: i, action: .buy))
        position = true
    }

    mutating func sell(_ i: Int) {
        signals.append(Signal(index: i, action: .sell))
        position = false
    }
}

/// 두 선의 교차로 매매하는 전략 (Golden Cross, MA/EMA 교차, MACD, Parabolic SAR).
///
/// 지표가 처음 계산된 날 이미 교차 이후 상태면 그날 진입한다. 교차 "순간"만 보면 지표가 준비되기
/// 전에 일어난 교차를 영영 놓쳐, 다음 반대 교차까지 기다리게 된다.
/// `rows` 는 dropna() 뒤 남은 행 번호, `above(i)` 는 그 행에서 빠른 선이 느린 선 위인지.
func crossoverSignals(rows: [Int], above: (Int) -> Bool, below: (Int) -> Bool) -> [Signal] {
    var log = SignalLog()
    guard let first = rows.first else { return [] }
    if above(first) { log.buy(first) }
    for k in rows.indices.dropFirst() {
        let prev = rows[k - 1], cur = rows[k]
        if !above(prev) && above(cur) && !log.position {
            log.buy(cur)
        } else if !below(prev) && below(cur) && log.position {
            log.sell(cur)
        }
    }
    return log.signals
}

public enum Strategies {
    /// backend STRATEGY_REGISTRY 와 같은 순서
    public static let all: [any Strategy] = [
        BuyAndHold(), GoldenCross(), MACrossover(), MACDStrategy(), DualMARSI(),
        EMACrossover(), MomentumROC(), ADXTrend(), ParabolicSAR(), KeltnerChannel(),
        BreakoutStrategy(), RSIStrategy(), BollingerBands(), StochasticOscillator(), VWAPStrategy(),
    ]

    public static let benchmark = "buy_and_hold"
}
