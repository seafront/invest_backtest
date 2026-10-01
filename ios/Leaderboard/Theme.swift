import SwiftUI

/// 웹(frontend/src/theme.ts)과 같은 색. 색각이상 검증을 거친 값이라 임의로 바꾸지 않는다.
enum Theme {
    static let positive = Color(hex: 0x10B981)  // 상승, 이익
    static let negative = Color(hex: 0xEF4444)  // 하락, 손실
    static let benchmark = Color.gray

    /// 그래프 계열 색. 앞 4색은 모든 쌍이 색각이상 검증(ΔE ≥ 8)을 통과하지만 5색부터는
    /// 통과하지 못해, 그래프에 올리는 전략을 4개로 제한한다.
    static let series: [Color] = [
        Color(hex: 0xD97706),  // amber
        Color(hex: 0x8B5CF6),  // violet
        Color(hex: 0x0891B2),  // cyan
        Color(hex: 0xEC4899),  // pink
    ]

    static func signed(_ v: Double) -> Color {
        v > 0 ? positive : v < 0 ? negative : .secondary
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}

enum Fmt {
    static func pct(_ v: Double, digits: Int = 1) -> String {
        "\(v > 0 ? "+" : "")\(v.formatted(.number.precision(.fractionLength(digits))))%"
    }

    static func pp(_ v: Double) -> String {
        "\(v > 0 ? "+" : "")\(v.formatted(.number.precision(.fractionLength(1))))%p"
    }

    static func money(_ v: Double, _ c: Currency, digits: Int = 0) -> String {
        v.formatted(.currency(code: c.rawValue).precision(.fractionLength(c == .krw ? 0 : digits)))
    }

    /// 좁은 곳(축 눈금)용. ₩1.2억, $1.5M
    static func compactMoney(_ v: Double, _ c: Currency) -> String {
        let a = abs(v)
        switch c {
        case .krw:
            if a >= 1e8 { return "₩\((v / 1e8).formatted(.number.precision(.fractionLength(a >= 1e9 ? 0 : 1))))억" }
            if a >= 1e4 { return "₩\((v / 1e4).formatted(.number.precision(.fractionLength(0))))만" }
            return "₩\(Int(v))"
        case .usd:
            if a >= 1e6 { return "$\((v / 1e6).formatted(.number.precision(.fractionLength(1))))M" }
            if a >= 1e3 { return "$\((v / 1e3).formatted(.number.precision(.fractionLength(0))))K" }
            return "$\(Int(v))"
        }
    }

    /// 주가. 원화는 소수점 없이, 달러는 둘째 자리까지
    static func price(_ v: Double, _ c: Currency) -> String { money(v, c, digits: 2) }

    /// 2.0 같은 실수는 2로 줄인다 (웹 fmtParam)
    static func param(_ v: Double) -> String {
        v == v.rounded() ? String(Int(v)) : String(v)
    }
}
