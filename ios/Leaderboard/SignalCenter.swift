import BackgroundTasks
import BacktestCore
import Foundation
import Observation
import UserNotifications

/// Signals — 워치리스트 매매 신호 (웹 /signals, services/signal_monitor.py).
///
/// (종목, 전략, 파라미터) 조합을 장이 끝난 일봉으로 판정한다. 웹 워치리스트와는 따로 관리한다
/// (앱은 서버 없이 돈다). 확인은 앱을 열 때·당길 때 하고, 장 마감 뒤에 iOS 백그라운드 새로고침을
/// 예약한다 — 실행 시점은 iOS 가 정해 늦거나 건너뛸 수 있다. 늦게 본 신호는 "n거래일 늦게"로 남는다.
@MainActor
@Observable
final class SignalCenter {
    static let shared = SignalCenter()
    static let taskID = "com.seafront.leaderboard.signals"

    struct Watch: Codable, Identifiable, Hashable {
        let id: UUID
        let ticker: String
        let strategy: String
        /// 기본값까지 채운 파라미터
        let params: [String: Double]
        let createdAt: Date
        /// 이 날짜 이후에 난 신호만 기록한다 (추가하기 전의 과거 신호는 넣지 않는다)
        let baselineDate: Day?
    }

    struct Event: Codable, Identifiable, Hashable {
        let watchID: UUID
        let date: Day
        let action: Action
        let price: Double
        /// 이 신호를 처음 봤을 때의 마지막 봉
        let seenBarDate: Day
        let detectedAt: Date
        /// 신호가 난 봉에서 몇 거래일 뒤에 봤나 (0 이면 당일)
        let lateBars: Int?
        var id: String { "\(watchID)|\(date)|\(action.rawValue)" }
    }

    struct Failure: Codable, Hashable {
        let ticker: String
        let error: String
    }

    struct Run: Codable {
        enum Source: String, Codable { case open, manual, schedule }
        let source: Source
        let startedAt: Date
        var finishedAt: Date?
        var tickers = 0
        var newEvents = 0
        var failed: [Failure] = []
    }

    /// 화면 한 줄. 판정은 저장된 시세로 다시 계산한다(네트워크 없음).
    struct Row: Identifiable {
        let watch: Watch
        let status: SignalMonitor.Status?
        let error: String?
        /// 장이 끝난 마지막 평일 — 마지막 시세가 이보다 이르면 노랗게
        let expectedBar: Day
        var id: UUID { watch.id }
    }

    private(set) var watches: [Watch] = []
    private(set) var events: [Event] = []
    private(set) var lastRun: Run?
    private(set) var rows: [Row] = []
    private(set) var checking = false
    private(set) var notificationsDenied = false

    private let store = PriceStore.shared

    private struct Saved: Codable {
        var watches: [Watch]
        var events: [Event]
        var lastRun: Run?
    }

    private var file: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("signals.json")
    }

    init() {
        if let data = try? Data(contentsOf: file), let s = try? JSONDecoder().decode(Saved.self, from: data) {
            watches = s.watches
            events = s.events
            lastRun = s.lastRun
        }
    }

    private func save() {
        let s = Saved(watches: watches, events: events, lastRun: lastRun)
        try? JSONEncoder().encode(s).write(to: file, options: .atomic)
    }

    // MARK: 워치리스트

    enum AddError: Error, LocalizedError {
        case duplicate, outOfRange(String)
        var errorDescription: String? {
            switch self {
            case .duplicate: "이미 감시 중인 조합입니다"
            case .outOfRange(let m): m
            }
        }
    }

    /// 감시를 더한다. 시세를 받고, 지금 마지막 봉에서 난 신호는 기록에 넣는다(그 앞은 넣지 않는다).
    func add(ticker: String, strategy: String, params: [String: Double]) async throws {
        guard let base = Strategies.all.first(where: { $0.name == strategy }) else { throw ReportError.unknownStrategy(strategy) }
        for p in base.params {
            if let v = params[p.name], !p.range.contains(v) {
                throw AddError.outOfRange("\(ParamText.label(p.name))은(는) \(Fmt.param(p.range.lowerBound))–\(Fmt.param(p.range.upperBound)) 범위여야 합니다")
            }
        }
        let full = base.with(params).resolvedParams
        if watches.contains(where: { $0.ticker == ticker && $0.strategy == strategy && $0.params == full }) {
            throw AddError.duplicate
        }
        let bars = try await closedBars(ticker, warmDays: base.with(full).warmupDays)
        let baseline = bars.count >= 2 ? bars[bars.count - 2].date : nil
        let w = Watch(id: UUID(), ticker: ticker, strategy: strategy, params: full, createdAt: Date(), baselineDate: baseline)
        watches.append(w)
        _ = record(w, bars: bars)
        save()
        rebuildRows(cache: [ticker: bars])
        // 처음 추가할 때 알림 권한을 묻는다. 대답을 기다리지 않는다 — 추가는 이미 끝났다.
        Task { await requestNotifications() }
        Self.scheduleBackgroundCheck(watching: watchedMarkets)
    }

    func remove(_ w: Watch) {
        watches.removeAll { $0.id == w.id }
        events.removeAll { $0.watchID == w.id }  // 그 조합으로 감지한 기록도 지운다 (웹과 같다)
        rows.removeAll { $0.watch.id == w.id }
        save()
    }

    // MARK: 확인

    /// 시세를 받고 모든 감시의 신호를 기록한다. 한 종목이 실패해도 나머지는 계속한다. 새 신호 수.
    @discardableResult
    func check(_ source: Run.Source) async -> Int {
        guard !checking, !watches.isEmpty else { return 0 }
        checking = true
        defer { checking = false }
        var run = Run(source: source, startedAt: Date())
        var fresh: [Event] = []
        var cache: [String: [Bar]] = [:]
        let byTicker = Dictionary(grouping: watches, by: \.ticker)
        for (ticker, ws) in byTicker.sorted(by: { $0.key < $1.key }) {
            let warm = ws.compactMap { w in Strategies.all.first { $0.name == w.strategy }?.with(w.params).warmupDays }.max() ?? 0
            do {
                let bars = try await closedBars(ticker, warmDays: warm)
                cache[ticker] = bars
                for w in ws { fresh += record(w, bars: bars) }
            } catch {
                run.failed.append(Failure(ticker: ticker, error: error.localizedDescription))
            }
        }
        run.tickers = byTicker.count
        run.newEvents = fresh.count
        run.finishedAt = Date()
        lastRun = run
        save()
        rebuildRows(cache: cache)
        if source == .schedule { await notify(fresh) }
        return fresh.count
    }

    /// 앱을 열 때: 저장된 시세로 바로 그리고, 마지막 확인이 장 마감 전이면 새로 확인한다
    func refreshOnOpen() async {
        if rows.count != watches.count { await rebuildFromCache() }
        let stale = watches.contains { w in
            let expected = SignalMonitor.lastClosedDay(w.ticker)
            return rows.first { $0.watch.id == w.id }?.status.map { $0.lastBar < expected } ?? true
        }
        if stale { await check(.open) }
    }

    private func rebuildFromCache() async {
        var cache: [String: [Bar]] = [:]
        for t in Set(watches.map(\.ticker)) {
            if let p = await store.cached(t) {
                let last = SignalMonitor.lastClosedDay(t)
                cache[t] = p.bars.filter { $0.date <= last }
            }
        }
        rebuildRows(cache: cache)
    }

    /// 장이 끝난 봉까지만. 장중의 미완성 봉은 쓰지 않는다. 마지막 장 마감 봉이 없으면 다시 받는다.
    private func closedBars(_ ticker: String, warmDays: Int) async throws -> [Bar] {
        let last = SignalMonitor.lastClosedDay(ticker)
        let from = last.adding(days: -(SignalMonitor.lookbackDays + warmDays))
        let cached = await store.cached(ticker)
        let stale = !(cached?.bars.contains { $0.date >= last } ?? false)
        let loaded = try await store.load(ticker, from: from, to: LeaderboardModel.today(), force: stale)
        let bars = loaded.prices.bars.filter { $0.date <= last }
        guard bars.count >= 2 else { throw AutoBacktestError.notEnoughData(ticker) }
        return bars
    }

    /// 감시를 시작한 뒤의 매매 신호를 기록에 더한다. 이미 있는 것은 건너뛴다.
    private func record(_ w: Watch, bars: [Bar]) -> [Event] {
        guard let s = try? SignalMonitor.status(bars: bars, strategyName: w.strategy, params: w.params) else { return [] }
        let known = Set(events.filter { $0.watchID == w.id }.map(\.id))
        let new = s.transitions
            .filter { t in w.baselineDate.map { t.date > $0 } ?? true }
            .map { t in
                Event(watchID: w.id, date: t.date, action: t.action, price: t.price, seenBarDate: s.lastBar,
                      detectedAt: Date(), lateBars: s.barsBetween(t.date, s.lastBar))
            }
            .filter { !known.contains($0.id) }
        events += new
        return new
    }

    private func rebuildRows(cache: [String: [Bar]]) {
        let old = Dictionary(uniqueKeysWithValues: rows.map { ($0.watch.id, $0) })
        rows = watches.map { w in
            let expected = SignalMonitor.lastClosedDay(w.ticker)
            guard let bars = cache[w.ticker] else {
                return old[w.id] ?? Row(watch: w, status: nil, error: nil, expectedBar: expected)
            }
            do {
                let s = try SignalMonitor.status(bars: bars, strategyName: w.strategy, params: w.params)
                return Row(watch: w, status: s, error: nil, expectedBar: expected)
            } catch {
                return Row(watch: w, status: nil, error: error.localizedDescription, expectedBar: expected)
            }
        }
    }

    // MARK: 알림 · 백그라운드

    private func requestNotifications() async {
        let center = UNUserNotificationCenter.current()
        let granted = (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        notificationsDenied = !granted
    }

    func refreshNotificationStatus() async {
        let s = await UNUserNotificationCenter.current().notificationSettings()
        notificationsDenied = s.authorizationStatus == .denied
    }

    private func notify(_ new: [Event]) async {
        let center = UNUserNotificationCenter.current()
        for e in new {
            guard let w = watches.first(where: { $0.id == e.watchID }) else { continue }
            let name = Strategies.all.first { $0.name == w.strategy }?.displayName ?? w.strategy
            let content = UNMutableNotificationContent()
            content.title = "\(w.ticker) · \(name): \(e.action == .buy ? "매수(BUY)" : "매도(SELL)")"
            content.body = "\(e.date) 종가 \(Fmt.price(e.price, Currency(ticker: w.ticker))) 기준 신호입니다. 실제 체결은 다음 거래일 시가 근처예요."
            content.sound = .default
            try? await center.add(UNNotificationRequest(identifier: e.id, content: content, trigger: nil))
        }
    }

    /// 다음 장 마감 뒤로 백그라운드 확인을 예약한다. 워치리스트에 있는 시장만 본다.
    nonisolated static func scheduleBackgroundCheck(watching markets: Set<SignalMonitor.Market>? = nil) {
        let markets = markets ?? [.us, .kr]
        guard let next = markets.map({ SignalMonitor.nextClose($0) }).min() else { return }
        let req = BGAppRefreshTaskRequest(identifier: taskID)
        req.earliestBeginDate = next
        try? BGTaskScheduler.shared.submit(req)
    }

    var watchedMarkets: Set<SignalMonitor.Market> { Set(watches.map { SignalMonitor.Market(ticker: $0.ticker) }) }

    /// 백그라운드 새로고침에서 부른다
    func backgroundCheck() async {
        await check(.schedule)
        if !watches.isEmpty { Self.scheduleBackgroundCheck(watching: watchedMarkets) }
    }
}
