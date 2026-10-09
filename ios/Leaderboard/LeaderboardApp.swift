import SwiftUI

@main
struct LeaderboardApp: App {
    @State private var model = LeaderboardModel()
    @Environment(\.scenePhase) private var phase
    #if DEBUG
    // 화면 확인용: -debugTab guide 면 그 탭으로 연다
    @State private var tab = UserDefaults.standard.string(forKey: "debugTab") ?? "leaderboard"
    #else
    @State private var tab = "leaderboard"
    #endif

    var body: some Scene {
        WindowGroup {
            TabView(selection: $tab) {
                ContentView(model: model)
                    .tabItem { Label("Leaderboard", systemImage: "list.number") }
                    .tag("leaderboard")
                SignalsView(model: model)
                    .tabItem { Label("Signals", systemImage: "bell.badge") }
                    .tag("signals")
                StrategyGuideView()
                    .tabItem { Label("전략 가이드", systemImage: "book") }
                    .tag("guide")
            }
        }
        .onChange(of: phase) {
            // 백그라운드로 갈 때 다음 장 마감 뒤 확인을 예약한다 (iOS 가 실행 시점을 정한다)
            if phase == .background, !SignalCenter.shared.watches.isEmpty {
                SignalCenter.scheduleBackgroundCheck(watching: SignalCenter.shared.watchedMarkets)
            }
        }
        .backgroundTask(.appRefresh(SignalCenter.taskID)) {
            await SignalCenter.shared.backgroundCheck()
        }
    }
}
