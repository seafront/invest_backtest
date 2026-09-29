import BacktestCore
import Foundation

struct Listing: Decodable, Hashable, Identifiable {
    let ticker: String
    let name: String
    var id: String { ticker }

    /// 나스닥 100 구성 종목. 백엔드 DB(index_members)에서 뽑아 앱에 넣었다.
    static let nasdaq100: [Listing] = {
        guard let url = Bundle.main.url(forResource: "Nasdaq100", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let list = try? JSONDecoder().decode([Listing].self, from: data)
        else { return [] }
        return list
    }()
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
        if !force, let saved, Date().timeIntervalSince(saved.fetchedAt) < freshFor,
           let first = saved.bars.first, first.date <= from.adding(days: 7) {
            return Loaded(prices: saved, fallbackReason: nil)
        }
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
            let prices = Prices(ticker: ticker, fetchedAt: Date(), bars: try YahooChart.parse(data).bars)
            try? JSONEncoder().encode(prices).write(to: file(ticker), options: .atomic)
            return Loaded(prices: prices, fallbackReason: nil)
        } catch {
            guard let saved else { throw error }
            return Loaded(prices: saved, fallbackReason: error.localizedDescription)
        }
    }
}
