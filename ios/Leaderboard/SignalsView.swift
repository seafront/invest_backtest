import BacktestCore
import SwiftUI

/// Signals 탭 — 워치리스트의 보유·관망 상태와 매매 신호 (웹 pages/Signals.tsx 의 워치리스트 부분)
struct SignalsView: View {
    let model: LeaderboardModel
    @State private var center = SignalCenter.shared
    @State private var adding = false

    var body: some View {
        NavigationStack {
            List {
                if center.watches.isEmpty {
                    Section {
                        ContentUnavailableView {
                            Label("감시 중인 전략이 없습니다", systemImage: "bell.badge")
                        } description: {
                            Text("오른쪽 위 + 나 Tear Sheet 의 \"Signals에 추가\"로 (종목, 전략, 파라미터)를 넣으면 장이 끝날 때마다 매매 신호를 확인합니다.")
                        }
                    }
                } else {
                    runSection
                    newSignalsSection
                    watchlistSection
                    eventsSection
                }
                notesSection
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Signals")
            .refreshable { await center.check(.manual) }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if center.checking {
                        ProgressView()
                    } else if !center.watches.isEmpty {
                        Button("지금 확인") { Task { await center.check(.manual) } }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { adding = true } label: { Image(systemName: "plus") }
                }
            }
            .sheet(isPresented: $adding) { AddWatchSheet(model: model) }
            .task {
                #if DEBUG
                // 화면 확인용: -debugWatch "AAPL:golden_cross;005930.KS:rsi" 로 워치리스트를 채운다
                if center.watches.isEmpty, let spec = UserDefaults.standard.string(forKey: "debugWatch") {
                    for item in spec.split(separator: ";") {
                        let parts = item.split(separator: ":").map(String.init)
                        if parts.count == 2 { try? await center.add(ticker: parts[0], strategy: parts[1], params: [:]) }
                    }
                }
                #endif
                await center.refreshNotificationStatus()
                await center.refreshOnOpen()
            }
        }
    }

    // MARK: 마지막 확인

    private var runSection: some View {
        Section("마지막 확인") {
            if let run = center.lastRun {
                VStack(alignment: .leading, spacing: 3) {
                    Text("\(run.startedAt.formatted(date: .abbreviated, time: .shortened)) · \(sourceLabel(run.source)) · \(run.tickers)종목 · 새 신호 \(run.newEvents)건")
                        .font(.subheadline)
                    ForEach(run.failed, id: \.self) { f in
                        Text("\(f.ticker): \(f.error)").font(.caption).foregroundStyle(.orange)
                    }
                }
            } else {
                Text("아직 확인하지 않았습니다").foregroundStyle(.secondary)
            }
            if center.notificationsDenied {
                Label("알림이 꺼져 있어 백그라운드에서 찾은 신호를 알려 드릴 수 없습니다. 설정 > 알림에서 켜 주세요.",
                      systemImage: "bell.slash").font(.caption).foregroundStyle(.orange)
            }
        }
    }

    private func sourceLabel(_ s: SignalCenter.Run.Source) -> String {
        switch s {
        case .open: "앱 열 때"
        case .manual: "직접"
        case .schedule: "자동(백그라운드)"
        }
    }

    // MARK: 마지막 거래일에 난 신호

    @ViewBuilder
    private var newSignalsSection: some View {
        let fresh = center.rows.filter { $0.status?.isNew == true }
        if !fresh.isEmpty {
            Section {
                ForEach(fresh) { row in
                    let s = row.status!
                    let sig = s.lastSignal!
                    HStack(spacing: 10) {
                        Text(sig.action == .buy ? "BUY" : "SELL")
                            .font(.headline)
                            .foregroundStyle(sig.action == .buy ? Theme.positive : Theme.negative)
                            .frame(width: 52)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("\(row.watch.ticker) · \(strategyName(row.watch))").font(.subheadline.bold())
                            Text("\(sig.date.description) 종가 \(Fmt.price(sig.price, Currency(ticker: row.watch.ticker)))")
                                .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                        }
                    }
                }
            } header: {
                Text("마지막 거래일에 난 신호")
            } footer: {
                Text("다음 거래일에 할 일입니다. 신호는 그날 종가로 계산되므로 실제 체결은 다음 거래일 시가 근처입니다.")
            }
        }
    }

    // MARK: 워치리스트

    private var watchlistSection: some View {
        Section {
            ForEach(center.rows) { row in WatchRow(row: row, name: model.name(for: row.watch.ticker)) }
                .onDelete { idx in
                    for i in idx { center.remove(center.rows[i].watch) }
                }
        } header: {
            Text("워치리스트 · \(center.watches.count)")
        } footer: {
            Text("● 보유 중 / ○ 관망 — 마지막 매매 신호가 BUY 인지 SELL 인지입니다. 같은 파라미터의 백테스트도 지금 그 상태입니다. 밀어서 삭제하면 감지 기록도 지워집니다.")
        }
    }

    // MARK: 감지한 신호

    @ViewBuilder
    private var eventsSection: some View {
        let list = center.events.sorted { ($0.date, $0.detectedAt) > ($1.date, $1.detectedAt) }
        Section {
            if list.isEmpty {
                Text("감시를 시작한 뒤 감지한 신호가 아직 없습니다").font(.subheadline).foregroundStyle(.secondary)
            }
            ForEach(list.prefix(50)) { e in
                if let w = center.watches.first(where: { $0.id == e.watchID }) {
                    HStack {
                        Text(e.action.rawValue).font(.caption.bold())
                            .foregroundStyle(e.action == .buy ? Theme.positive : Theme.negative)
                            .frame(width: 36, alignment: .leading)
                        VStack(alignment: .leading, spacing: 1) {
                            Text("\(w.ticker) · \(strategyName(w))").font(.subheadline)
                            Text("\(e.date.description) · \(Fmt.price(e.price, Currency(ticker: w.ticker)))")
                                .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text(lateLabel(e)).font(.caption).foregroundStyle((e.lateBars ?? 0) > 0 ? Color.orange : .secondary)
                    }
                }
            }
        } header: {
            Text("감지한 신호")
        } footer: {
            Text("감지는 그 신호를 처음 본 때입니다. \"n거래일 늦게\"는 확인을 건너뛴 날이 있었다는 뜻입니다(백그라운드 확인은 iOS 가 시점을 정합니다). 야후가 과거 가격을 고쳐도 이 기록에는 처음 본 값이 남습니다.")
        }
    }

    private func lateLabel(_ e: SignalCenter.Event) -> String {
        guard let n = e.lateBars else { return "" }
        return n == 0 ? "당일" : "\(n)거래일 늦게"
    }

    private var notesSection: some View {
        Section {
            VStack(alignment: .leading, spacing: 6) {
                Text("장이 끝난 일봉으로만 판정합니다 (미국 16:30 ET, 한국 16:00 KST 이후). 장중의 미완성 봉은 쓰지 않습니다.")
                Text("앱을 열거나 당기면 확인하고, 장 마감 뒤에는 백그라운드 확인을 예약합니다. 백그라운드 실행 시점은 iOS 가 정해 늦거나 건너뛸 수 있습니다. 새 신호를 찾으면 알림을 보냅니다.")
                Text("웹 Signals 의 워치리스트와는 따로 관리됩니다.")
            }
            .font(.caption).foregroundStyle(.secondary)
        }
    }

    private func strategyName(_ w: SignalCenter.Watch) -> String {
        Strategies.all.first { $0.name == w.strategy }?.displayName ?? w.strategy
    }
}

private struct WatchRow: View {
    let row: SignalCenter.Row
    let name: String

    private var w: SignalCenter.Watch { row.watch }
    private var currency: Currency { Currency(ticker: w.ticker) }

    var body: some View {
        let strategy = Strategies.all.first { $0.name == w.strategy }
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 6) {
                if let s = row.status {
                    Text(s.holding ? "● 보유 중" : "○ 관망").font(.caption.bold())
                        .foregroundStyle(s.holding ? Theme.positive : .secondary)
                }
                Text(w.ticker).font(.subheadline.bold())
                Text(name).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Text("\(strategy?.displayName ?? w.strategy)\(changed(strategy).isEmpty ? "" : " · \(changed(strategy))")")
                .font(.caption).foregroundStyle(.secondary)
            if let s = row.status {
                if let sig = s.lastSignal {
                    HStack(spacing: 12) {
                        Text("\(sig.action.rawValue) \(sig.date.description) \(Fmt.price(sig.price, currency))")
                            .foregroundStyle(sig.action == .buy ? Theme.positive : Theme.negative)
                        Text(s.barsSince.map { $0 == 0 ? "오늘" : "\($0)거래일 전" } ?? "")
                        if let r = s.sinceReturn {
                            Text("\(s.holding ? "진입 후" : "청산 후") \(Fmt.pct(r))").foregroundStyle(Theme.signed(r))
                        }
                    }
                    .font(.caption.monospacedDigit())
                } else {
                    Text("최근 3년 동안 매매 신호가 없습니다").font(.caption).foregroundStyle(.secondary)
                }
                Text("마지막 시세 \(s.lastBar.description) · \(Fmt.price(s.lastClose, currency))")
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(s.lastBar < row.expectedBar ? Color.orange : Color.secondary)
            } else if let e = row.error {
                Text(e).font(.caption).foregroundStyle(Theme.negative)
            } else {
                Text("확인 전").font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }

    private func changed(_ s: (any Strategy)?) -> String {
        s.map { ParamText.changed(w.params, specs: $0.params) } ?? ""
    }
}

/// 감시 추가 — 종목·전략·파라미터
struct AddWatchSheet: View {
    let model: LeaderboardModel
    @Environment(\.dismiss) private var dismiss
    @State private var ticker: String
    @State private var strategy = "golden_cross"
    @State private var params: [String: Double] = [:]
    @State private var picking = false
    @State private var adding = false
    @State private var failure: String?

    init(model: LeaderboardModel) {
        self.model = model
        _ticker = State(initialValue: model.ticker)
    }

    private var spec: (any Strategy)? { Strategies.all.first { $0.name == strategy } }

    var body: some View {
        NavigationStack {
            Form {
                Section("종목") {
                    Button { picking = true } label: {
                        HStack {
                            Text(ticker).font(.headline)
                            Text(model.name(for: ticker)).font(.caption).foregroundStyle(.secondary)
                            Spacer()
                            Text("변경").font(.subheadline)
                        }
                    }
                    .tint(.primary)
                }
                Section("전략") {
                    Picker("전략", selection: $strategy) {
                        ForEach(Strategies.all.filter { $0.name != Strategies.benchmark }, id: \.name) {
                            Text($0.displayName).tag($0.name)
                        }
                    }
                    .onChange(of: strategy) { params = [:] }
                }
                if let s = spec, !s.params.isEmpty {
                    Section("파라미터") {
                        ForEach(s.params, id: \.name) { p in
                            ParamField(spec: p, value: Binding(get: { params[p.name] ?? p.defaultValue },
                                                               set: { params[p.name] = $0 }),
                                       original: p.defaultValue)
                        }
                    }
                }
                if let failure {
                    Section { Text(failure).foregroundStyle(Theme.negative) }
                }
            }
            .navigationTitle("Signals에 추가")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("닫기") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if adding {
                        ProgressView()
                    } else {
                        Button("추가") { Task { await add() } }
                    }
                }
            }
            .sheet(isPresented: $picking) {
                TickerPicker(selected: $ticker, recent: model.customTickers.map { ($0, model.name(for: $0)) })
            }
        }
    }

    private func add() async {
        adding = true
        defer { adding = false }
        do {
            try await SignalCenter.shared.add(ticker: ticker, strategy: strategy, params: params)
            dismiss()
        } catch {
            failure = error.localizedDescription
        }
    }
}

/// Tear Sheet 의 "Signals에 추가"
struct WatchButton: View {
    let ticker: String
    let strategy: String
    let params: [String: Double]
    @State private var state: String?
    @State private var busy = false

    var body: some View {
        HStack {
            Button {
                Task {
                    busy = true
                    defer { busy = false }
                    do {
                        try await SignalCenter.shared.add(ticker: ticker, strategy: strategy, params: params)
                        state = "Signals 탭에서 매일 확인합니다"
                    } catch {
                        state = error.localizedDescription
                    }
                }
            } label: {
                Label("Signals에 추가", systemImage: "bell.badge").font(.caption)
            }
            .buttonStyle(.bordered)
            .disabled(busy)
            if busy { ProgressView().controlSize(.small) }
            if let state { Text(state).font(.caption2).foregroundStyle(.secondary) }
        }
    }
}
