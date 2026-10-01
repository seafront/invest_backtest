import BacktestCore
import Foundation

enum Universe: String, CaseIterable, Identifiable, Decodable {
    case nasdaq100, sp500, kospi200, etf
    var id: String { rawValue }

    var label: String {
        switch self {
        case .nasdaq100: "나스닥 100"
        case .sp500: "S&P 500"
        case .kospi200: "코스피 200"
        case .etf: "ETF"
        }
    }

    /// 구성 종목. 지수 셋은 백엔드 DB(index_members, companies)에서 뽑았고, ETF 는 자주 보는 것만 골라 넣었다.
    var listings: [Listing] { Self.all[self] ?? [] }

    private static let all: [Universe: [Listing]] = {
        guard let url = Bundle.main.url(forResource: "Universes", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let raw = try? JSONDecoder().decode([String: [Listing]].self, from: data)
        else { return [:] }
        return Dictionary(uniqueKeysWithValues: raw.compactMap { k, v in Universe(rawValue: k).map { ($0, v) } })
    }()
}

struct Listing: Decodable, Hashable, Identifiable {
    let ticker: String
    let name: String
    var id: String { ticker }

    /// 여러 지수에 겹치는 종목(AAPL 은 나스닥 100 과 S&P 500)은 먼저 나오는 쪽 이름을 쓴다
    static func find(_ ticker: String) -> Listing? {
        for u in Universe.allCases {
            if let l = u.listings.first(where: { $0.ticker == ticker }) { return l }
        }
        return nil
    }

    static func universe(of ticker: String) -> Universe? {
        Universe.allCases.first { u in u.listings.contains { $0.ticker == ticker } }
    }
}

/// 통화는 티커로 정한다 (웹 utils/money.ts 와 같다)
enum Currency: String {
    case usd = "USD", krw = "KRW"

    init(ticker: String) {
        self = ticker.hasSuffix(".KS") || ticker.hasSuffix(".KQ") ? .krw : .usd
    }

    /// 입력 기본값. 원화는 1주가 수십만 원이라 달러의 1,000배로 잡는다.
    var defaultCapital: Double { self == .krw ? 100_000_000 : 100_000 }
    var defaultMonthly: Double { self == .krw ? 1_000_000 : 1_000 }
}

/// 종목별 시세를 Yahoo 에서 받아 기기에 저장한다.
///
/// 수정주가는 배당·분할이 생길 때마다 과거 전체가 바뀐다. 그래서 새 날짜만 덧붙이지 않고 매번
/// 전체 구간을 다시 받는다 (종목 하나 6년치가 170KB, 0.5초). 백엔드 캐시는 덧붙이는 방식이라
/// 배당주는 웹 결과와 조금 다를 수 있고, 이쪽이 최신 기준이다.
actor PriceStore {
    struct Prices: Codable {
        let ticker: String
        let fetchedAt: Date
        let bars: [Bar]
        /// Yahoo 가 알려 준 종목명·통화. 목록에 없는 티커를 직접 넣었을 때 이름을 보여 주는 데 쓴다.
        var name: String?
        var currency: String?
        /// 요청한 첫 날짜. 상장이 늦은 종목은 시세가 이보다 늦게 시작해도 더 받을 것이 없다.
        var requestedFrom: Day?

        /// `from` 부터의 시세를 이미 받아 두었는지
        func covers(_ from: Day) -> Bool {
            if let requestedFrom, requestedFrom <= from { return true }
            return (bars.first?.date).map { $0 <= from.adding(days: 7) } ?? false
        }
    }

    enum PriceError: Error, LocalizedError {
        case unsupportedCurrency(String, String)

        var errorDescription: String? {
            switch self {
            case let .unsupportedCurrency(t, c):
                "\(t) 는 \(c) 종목입니다. 달러(USD)·원화(KRW, .KS/.KQ) 종목만 지원합니다"
            }
        }
    }

    struct Loaded {
        let prices: Prices
        /// 받기에 실패해 저장된 시세를 쓴 경우 그 이유
        let fallbackReason: String?
    }

    /// 이 시간 안에 받은 시세는 다시 받지 않는다
    private let freshFor: TimeInterval = 60 * 60

    private var directory: URL {
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("prices", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private func file(_ ticker: String) -> URL { directory.appendingPathComponent("\(ticker).json") }

    func cached(_ ticker: String) -> Prices? {
        guard let data = try? Data(contentsOf: file(ticker)) else { return nil }
        return try? JSONDecoder().decode(Prices.self, from: data)
    }

    func load(_ ticker: String, from: Day, to: Day, force: Bool = false) async throws -> Loaded {
        let saved = cached(ticker)
        if !force, let saved, Date().timeIntervalSince(saved.fetchedAt) < freshFor, saved.covers(from) {
            return Loaded(prices: saved, fallbackReason: nil)
        }
        // 한 번 길게 받은 종목(최적화)은 새로 받을 때도 그만큼 받는다 — 다시 짧아지지 않게
        let from = Swift.min(from, saved?.requestedFrom ?? from)
        do {
            var req = URLRequest(url: YahooChart.url(ticker: ticker, from: from, to: to))
            // 기본 User-Agent 는 Yahoo 가 거절할 때가 있다
            req.setValue("Mozilla/5.0", forHTTPHeaderField: "User-Agent")
            req.timeoutInterval = 20
            let (data, response) = try await URLSession.shared.data(for: req)
            if let http = response as? HTTPURLResponse, http.statusCode != 200 {
                // 404 등도 본문에 오류 설명이 오므로 먼저 파싱해 본다
                _ = try YahooChart.parse(data)
                throw URLError(.badServerResponse)
            }
            let (bars, meta) = try YahooChart.parse(data)
            // 금액 입력·표시는 티커로 정한 통화(달러·원화)를 쓴다. 엔화·유로 등은 단위가 맞지 않는다.
            let expected = Currency(ticker: ticker).rawValue
            if let c = meta.currency, c != expected { throw PriceError.unsupportedCurrency(ticker, c) }
            let prices = Prices(ticker: ticker, fetchedAt: Date(), bars: bars, name: meta.name, currency: meta.currency,
                                requestedFrom: from)
            try? JSONEncoder().encode(prices).write(to: file(ticker), options: .atomic)
            return Loaded(prices: prices, fallbackReason: nil)
        } catch let error as PriceError {
            throw error
        } catch {
            guard let saved else { throw error }
            return Loaded(prices: saved, fallbackReason: error.localizedDescription)
        }
    }
}
