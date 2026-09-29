import SwiftUI

@main
struct LeaderboardApp: App {
    @State private var model = LeaderboardModel()

    var body: some Scene {
        WindowGroup {
            ContentView(model: model)
        }
    }
}
