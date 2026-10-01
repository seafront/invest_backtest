import SwiftUI

@main
struct LeaderboardApp: App {
    @State private var model = LeaderboardModel()
    #if DEBUG
    // 화면 확인용: -debugTab guide 면 전략 가이드 탭으로 연다
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
                StrategyGuideView()
                    .tabItem { Label("전략 가이드", systemImage: "book") }
                    .tag("guide")
            }
        }
    }
}
