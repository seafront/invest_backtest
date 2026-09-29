import Foundation

/// Yahoo Finance 차트 API (백엔드의 yfinance 가 내부에서 부르는 것과 같은 곳).
///
/// 공식 API 가 아니라 예고 없이 막히거나 형식이 바뀔 수 있다. 앱은 받은 시세를 기기에 저장해
/// 두고, 받기에 실패하면 저장된 시세로 계속 쓴다.
public enum YahooChart {
    public struct Meta: Sendable {
        public let currency: String?
        public let name: String?
    }

    public enum ParseError: Error, LocalizedError {
        case api(String)
        case empty

        public var errorDescription: String? {
            switch self {
            case .api(let m): "Yahoo 응답 오류: \(m)"
            case .empty: "Yahoo 가 시세를 보내지 않았습니다"
            }
        }
    }

    public static func url(ticker: String, from: Day, to: Day) -> URL {
        func unix(_ d: Day) -> Int { d.ordinal * 86400 }
        var c = URLComponents(string: "https://query1.finance.yahoo.com/v8/finance/chart/")!
        c.path += ticker.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? ticker
        c.queryItems = [
            .init(name: "period1", value: String(unix(from))),
            // 끝 날짜 당일까지 받는다
            .init(name: "period2", value: String(unix(to.adding(days: 1)))),
            .init(name: "interval", value: "1d"),
            .init(name: "events", value: "div,splits"),
        ]
        return c.url!
    }

    /// 수정주가 일봉으로 바꾼다. yfinance(auto_adjust)처럼 시·고·저가에 수정 비율
    /// (수정 종가 ÷ 종가)을 곱하고, 백엔드 캐시처럼 소수 넷째 자리로 반올림한다.
    /// 상장 전·거래정지로 값이 빈 날은 버린다.
    public static func parse(_ data: Data) throws -> (bars: [Bar], meta: Meta) {
        let root = try JSONDecoder().decode(Root.self, from: data)
        if let e = root.chart.error { throw ParseError.api(e.description ?? e.code ?? "unknown") }
        guard let r = root.chart.result?.first, let ts = r.timestamp, let q = r.indicators.quote.first
        else { throw ParseError.empty }
        let adj = r.indicators.adjclose?.first?.adjclose
        let offset = r.meta.gmtoffset ?? 0

        var byDay: [Day: Bar] = [:]
        for i in ts.indices {
            guard let o = q.open?[safe: i] ?? nil, let h = q.high?[safe: i] ?? nil,
                  let l = q.low?[safe: i] ?? nil, let c = q.close?[safe: i] ?? nil,
                  let v = q.volume?[safe: i] ?? nil, c > 0
            else { continue }
            let adjClose = (adj?[safe: i] ?? nil) ?? c
            let ratio = adjClose / c
            let day = Day(unixTime: ts[i], gmtOffset: offset)
            // 장중에는 마지막 줄이 같은 날짜로 한 번 더 올 수 있다 — 나중 것을 쓴다
            byDay[day] = Bar(date: day, open: pyRound(o * ratio, 4), high: pyRound(h * ratio, 4),
                             low: pyRound(l * ratio, 4), close: pyRound(adjClose, 4), volume: v)
        }
        guard !byDay.isEmpty else { throw ParseError.empty }
        let meta = Meta(currency: r.meta.currency, name: r.meta.longName ?? r.meta.shortName)
        return (byDay.values.sorted { $0.date < $1.date }, meta)
    }

    private struct Root: Decodable { let chart: Chart }
    private struct Chart: Decodable { let result: [Result]?; let error: APIError? }
    private struct APIError: Decodable { let code: String?; let description: String? }
    private struct Result: Decodable {
        let meta: MetaJSON
        let timestamp: [Int]?
        let indicators: Indicators
    }
    private struct MetaJSON: Decodable {
        let currency: String?
        let longName: String?
        let shortName: String?
        let gmtoffset: Int?
    }
    private struct Indicators: Decodable { let quote: [Quote]; let adjclose: [Adj]? }
    private struct Quote: Decodable {
        let open, high, low, close, volume: [Double?]?
    }
    private struct Adj: Decodable { let adjclose: [Double?] }
}

private extension Array {
    subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil }
}
