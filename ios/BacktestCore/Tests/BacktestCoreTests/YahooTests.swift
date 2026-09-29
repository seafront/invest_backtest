import Foundation
import Testing
@testable import BacktestCore

/// Yahoo/AAPL.json 은 2026-09-29 에 차트 API 에서 그대로 받은 응답이다.
@Test func parsesAdjustedDailyBars() throws {
    let url = try #require(Bundle.module.url(forResource: "AAPL", withExtension: "json", subdirectory: "Yahoo"))
    let (bars, meta) = try YahooChart.parse(Data(contentsOf: url))
    #expect(meta.currency == "USD")
    #expect(meta.name == "Apple Inc.")
    #expect(bars.count == 1507)
    #expect(zip(bars, bars.dropFirst()).allSatisfy { $0.date < $1.date })

    // 장중에 받아 마지막 줄은 그날(09-29) 진행 중인 시세다 — yfinance 도 똑같이 싣는다
    #expect(bars.last?.date == Day("2026-09-29"))
    // 최근 날은 수정할 게 없어 원래 종가와 같고, 6년 전은 그 뒤 배당만큼 낮아진다
    let recent = try #require(bars.first { $0.date == Day("2026-09-28") })
    #expect(recent.close == 338.4)  // 338.3999938964844
    let first = try #require(bars.first { $0.date == Day("2020-09-29") })
    #expect(abs(first.close - 110.5689) < 0.0001)  // 원래 종가 114.09
    #expect(first.high >= first.close && first.low <= first.close)
}

/// 같은 날짜의 시세를 백엔드 캐시(정답 데이터)와 비교한다. 캐시는 받을 때의 수정 비율로 굳어 있어
/// 그 뒤 배당만큼(AAPL 은 최대 0.18%) 차이가 날 수 있다 — 그보다 크면 수정 계산이 틀린 것이다.
@Test func agreesWithBackendCache() throws {
    let url = try #require(Bundle.module.url(forResource: "AAPL", withExtension: "json", subdirectory: "Yahoo"))
    let (bars, _) = try YahooChart.parse(Data(contentsOf: url))
    let fx = try Fixture.load("AAPL")
    let cached = Dictionary(uniqueKeysWithValues: fx.prices.map { ($0.date, $0.close) })
    let diffs = bars.compactMap { b in cached[b.date].map { abs(b.close - $0) / $0 } }
    #expect(diffs.count > 1400)
    #expect(diffs.max()! < 0.005)
}

@Test func reportsApiError() {
    let body = #"{"chart":{"result":null,"error":{"code":"Not Found","description":"No data found, symbol may be delisted"}}}"#
    #expect(throws: YahooChart.ParseError.self) { try YahooChart.parse(Data(body.utf8)) }
}
