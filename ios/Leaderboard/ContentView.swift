import BacktestCore
import SwiftUI

struct ContentView: View {
    @Bindable var model: LeaderboardModel
    @State private var pickingTicker = false
    @FocusState private var amountFocused: Bool
    @State private var path: [TearSheetRoute] = []

    var body: some View {
        NavigationStack(path: $path) {
            List {
                inputSection
                if let error = model.error {
                    Section { Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(Theme.negative) }
                }
                if let result = model.result {
                    summarySection(result)
                    chartSection(result)
                    rowsSection(result)
                    footnoteSection
                }
            }
            .listStyle(.insetGrouped)
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Strategy Leaderboard")
            .navigationBarTitleDisplayMode(.inline)
            .refreshable { await model.run(force: true, keepPlotted: true) }
            .sheet(isPresented: $pickingTicker) {
                TickerPicker(selected: $model.ticker, recent: model.customTickers.map { ($0, model.name(for: $0)) })
            }
            .toolbar {
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("완료") { amountFocused = false }
                }
            }
            .navigationDestination(for: TearSheetRoute.self) { route in
                TearSheetView(model: model, route: route)
            }
            .navigationDestination(for: GuideRoute.self) { StrategyGuideDetail(strategy: $0.strategy) }
            .task {
                #if DEBUG
                // 화면 확인용: -debugTicker 005930.KS -debugOpen golden_cross 로 띄우면 그 종목을 돌려
                // Tear Sheet 까지 연다 (시뮬레이터는 명령으로 화면을 누를 수 없다)
                let args = UserDefaults.standard
                if let t = args.string(forKey: "debugTicker") { model.ticker = t }
                await model.restore()
                if let open = args.string(forKey: "debugOpen") { path = [TearSheetRoute(strategy: open)] }
                #else
                await model.restore()
                #endif
            }
        }
    }

    // MARK: 입력

    private var inputSection: some View {
        Section {
            Button { pickingTicker = true } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(model.ticker).font(.headline)
                        Text(model.name(for: model.ticker)).font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text("종목 변경").font(.subheadline)
                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                }
            }
            .tint(.primary)

            Picker("투자 방식", selection: $model.mode) {
                Text("거치식").tag(InvestMode.lumpSum)
                Text("적립식").tag(InvestMode.dca)
            }
            .pickerStyle(.segmented)

            LabeledContent(model.mode == .lumpSum ? "초기 자본" : "월 납입액") {
                TextField("금액", value: model.mode == .lumpSum ? $model.capital : $model.monthly,
                          format: .currency(code: model.currency.rawValue).precision(.fractionLength(0)))
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.trailing)
                    .focused($amountFocused)
            }

            Button {
                amountFocused = false
                Task { await model.run() }
            } label: {
                HStack {
                    Spacer()
                    if model.loading { ProgressView().padding(.trailing, 6) }
                    Text(model.loading ? "계산 중…" : "전략 비교 실행").bold()
                    Spacer()
                }
            }
            .disabled(model.loading || (model.mode == .lumpSum ? model.capital : model.monthly) <= 0)
        } footer: {
            Text("나스닥 100 · S&P 500 · 코스피 200 · ETF 종목 하나에 전략 \(Strategies.all.count - 1)개를 기본 파라미터로 최근 \(LeaderboardModel.years)년 돌려 Buy & Hold 와 비교합니다.")
        }
    }

    // MARK: 요약

    private func summarySection(_ r: AutoBacktestResult) -> some View {
        let rows = model.rows
        let strategies = rows.filter { !$0.isBenchmark }
        let beating = strategies.filter(\.beatsBenchmark).count
        let beatingToday = r.benchmark.map { b in strategies.filter { $0.result.totalReturn > b.totalReturn }.count } ?? 0
        let label = Rolling.windows.first { $0.weeks == model.effectiveWeeks() }?.label ?? ""
        let short = r.dataStart > r.startDate.adding(days: 7)

        return Section {
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline) {
                    Text(r.ticker).font(.title2.bold())
                    Text(model.name(for: r.ticker))
                        .font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                }
                Text("\(r.dataStart.description) ~ \(r.dataEnd.description)")
                    .font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
                if short {
                    Text("데이터가 \(r.dataStart.description)부터라 \(LeaderboardModel.years)년보다 짧습니다")
                        .font(.caption).foregroundStyle(.orange)
                }
                Text("\(r.mode == .lumpSum ? "거치식" : "적립식") · 투자원금 \(Fmt.money(r.totalInvested, model.resultCurrency))")
                    .font(.subheadline)
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("비교 구간").font(.caption).foregroundStyle(.secondary)
                HStack(spacing: 6) {
                    ForEach(Rolling.windows) { w in
                        let allowed = model.windowAllowed(w.weeks)
                        let selected = model.effectiveWeeks() == w.weeks
                        Button(w.label) { model.windowWeeks = w.weeks }
                            .buttonStyle(.bordered)
                            .tint(selected ? .accentColor : .gray)
                            .fontWeight(selected ? .bold : .regular)
                            .disabled(!allowed)
                    }
                }
                .font(.subheadline)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("\(label) 구간 \(model.windowCount)개 중 절반 넘게 B&H보다 수익이 높았던 전략")
                    .font(.subheadline)
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text("\(beating)").font(.system(size: 34, weight: .bold)).foregroundStyle(beating > 0 ? Theme.positive : .secondary)
                    Text("/ \(strategies.count)").font(.title3).foregroundStyle(.secondary)
                }
                Text("오늘 기준 총수익률로는 \(beatingToday) / \(strategies.count)")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if let notice = model.notice {
                Label(notice, systemImage: "wifi.exclamationmark").font(.caption).foregroundStyle(.orange)
            }
        }
    }

    // MARK: 그래프

    private func chartSection(_ r: AutoBacktestResult) -> some View {
        Section {
            ReturnChart(result: r, plotted: model.plotted)
                .frame(height: 240)
                .padding(.vertical, 8)
            ChartLegend(result: r, plotted: model.plotted)
        } header: {
            Text("누적 수익률")
        } footer: {
            Text(r.mode == .dca
                 ? "그 시점까지 넣은 원금 대비 수익률입니다. 아래 목록에서 그래프에 올릴 전략을 최대 \(LeaderboardModel.maxPlotted)개 고를 수 있습니다."
                 : "아래 목록에서 그래프에 올릴 전략을 최대 \(LeaderboardModel.maxPlotted)개 고를 수 있습니다.")
        }
    }

    // MARK: 목록

    private func rowsSection(_ r: AutoBacktestResult) -> some View {
        Section {
            ForEach(model.rows) { row in
                NavigationLink(value: TearSheetRoute(strategy: row.id)) {
                    StrategyRow(
                        row: row,
                        dca: r.mode == .dca,
                        colorSlot: model.plotted[row.id],
                        plotDisabled: model.plotFull && model.plotted[row.id] == nil,
                        onTogglePlot: { model.togglePlot(row.id) }
                    )
                }
            }
        } header: {
            HStack {
                Text("전략 · 누르면 Tear Sheet")
                Spacer()
                Menu {
                    Picker("정렬", selection: $model.sortKey) {
                        ForEach(SortKey.allCases) { Text($0.label(dca: r.mode == .dca)).tag($0) }
                    }
                } label: {
                    Label(model.sortKey.label(dca: r.mode == .dca), systemImage: "arrow.up.arrow.down")
                        .font(.caption)
                        .textCase(nil)
                }
            }
        }
    }

    private var footnoteSection: some View {
        Section {
            VStack(alignment: .leading, spacing: 6) {
                Text("B&H 승률: 같은 길이 구간을 한 주씩 밀어 가며 잘랐을 때 B&H보다 수익이 높았던 구간 비율. 총수익률은 끝 날짜에 크게 흔들려 참고용입니다.")
                Text("모두 기본 파라미터 결과입니다. 순위는 파라미터에 따라 쉽게 바뀝니다.")
                Text("매매 승률은 성과 지표가 아닙니다. 작게 자주 벌고 한 번 크게 잃는 전략이 높게 나옵니다.")
                if let at = model.pricesFetchedAt {
                    Text("시세: Yahoo Finance 수정주가 · \(at.formatted(date: .abbreviated, time: .shortened)) 받음 · 당겨서 새로 받기")
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
    }
}
