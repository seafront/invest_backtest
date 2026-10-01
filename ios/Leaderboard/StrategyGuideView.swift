import BacktestCore
import SwiftUI

/// 전략 가이드 (웹 pages/Strategies.tsx). 글은 웹에서 그대로 옮긴 StrategyGuide.json 을 쓴다
/// (ios/Fixtures/export_strategy_guide.mjs). 파라미터는 앱의 전략 정의에서 읽는다.
struct StrategyGuide: Decodable {
    struct Category: Decodable, Identifiable {
        let name: String
        let label: String
        let color: String
        let strategies: [String]
        var id: String { name }
        var swiftColor: Color { Color(hex: UInt32(color.dropFirst(), radix: 16) ?? 0x94A3B8) }
    }

    struct Detail: Decodable {
        let how_it_works: String
        let buy_rule: String
        let sell_rule: String
        let strengths: [String]
        let weaknesses: [String]
        let best_for: String
    }

    let categories: [Category]
    let details: [String: Detail]

    static let shared: StrategyGuide? = {
        guard let url = Bundle.main.url(forResource: "StrategyGuide", withExtension: "json"),
              let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(StrategyGuide.self, from: data)
    }()

    func category(of strategy: String) -> Category? { categories.first { $0.strategies.contains(strategy) } }
}

/// 전략 가이드에서 한 전략을 연다
struct GuideRoute: Hashable {
    let strategy: String
}

struct StrategyGuideView: View {
    #if DEBUG
    // 화면 확인용: -debugGuide golden_cross 면 그 전략을 연다
    @State private var path: [GuideRoute] = UserDefaults.standard.string(forKey: "debugGuide").map { [GuideRoute(strategy: $0)] } ?? []
    #else
    @State private var path: [GuideRoute] = []
    #endif

    var body: some View {
        NavigationStack(path: $path) {
            List {
                Section {
                    Text("각 트레이딩 전략의 작동 원리와 매수/매도 기준을 확인하세요")
                        .font(.subheadline).foregroundStyle(.secondary)
                }
                if let guide = StrategyGuide.shared {
                    ForEach(guide.categories) { c in
                        Section {
                            ForEach(c.strategies, id: \.self) { name in
                                if let s = Strategies.all.first(where: { $0.name == name }) {
                                    NavigationLink(value: GuideRoute(strategy: name)) {
                                        VStack(alignment: .leading, spacing: 3) {
                                            Text(s.displayName).font(.body.bold())
                                            Text(s.summary).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                                        }
                                        .padding(.vertical, 2)
                                    }
                                }
                            }
                        } header: {
                            Text(c.label).foregroundStyle(c.swiftColor).fontWeight(.bold)
                        }
                    }
                }
            }
            .navigationTitle("전략 가이드")
            .navigationDestination(for: GuideRoute.self) { StrategyGuideDetail(strategy: $0.strategy) }
        }
    }
}

struct StrategyGuideDetail: View {
    let strategy: String

    var body: some View {
        let s = Strategies.all.first { $0.name == strategy }
        let guide = StrategyGuide.shared
        let d = guide?.details[strategy]
        let category = guide?.category(of: strategy)
        List {
            Section {
                VStack(alignment: .leading, spacing: 6) {
                    if let category {
                        Text(category.label)
                            .font(.caption.bold())
                            .padding(.horizontal, 8).padding(.vertical, 2)
                            .background(category.swiftColor.opacity(0.15), in: Capsule())
                            .foregroundStyle(category.swiftColor)
                    }
                    Text(s?.displayName ?? strategy).font(.title2.bold())
                    Text(s?.summary ?? "").font(.subheadline).foregroundStyle(.secondary)
                }
                .padding(.vertical, 2)
            }
            if let d {
                Section {
                    Text(d.how_it_works).font(.callout)
                } header: {
                    Label("작동 원리", systemImage: "gearshape.2").foregroundStyle(Theme.series[1])
                }
                Section {
                    Text(d.buy_rule).font(.callout)
                } header: {
                    Label("매수 조건", systemImage: "arrow.up.circle").foregroundStyle(Theme.positive)
                }
                Section {
                    Text(d.sell_rule).font(.callout)
                } header: {
                    Label("매도 조건", systemImage: "arrow.down.circle").foregroundStyle(Theme.negative)
                }
            }
            if let s, !s.params.isEmpty {
                Section {
                    ForEach(s.params, id: \.name) { p in
                        VStack(alignment: .leading, spacing: 3) {
                            Text(ParamText.label(p.name)).font(.subheadline.bold())
                            Text(p.description).font(.caption).foregroundStyle(.secondary)
                            HStack(spacing: 10) {
                                Text("타입 \(p.isInt ? "int" : "float")")
                                Text("기본값 \(Fmt.param(p.defaultValue))").foregroundStyle(Theme.positive)
                                Text("범위 \(Fmt.param(p.range.lowerBound))~\(Fmt.param(p.range.upperBound))").foregroundStyle(.orange)
                            }
                            .font(.caption.monospacedDigit())
                        }
                        .padding(.vertical, 1)
                    }
                } header: {
                    Label("파라미터 설정", systemImage: "slider.horizontal.3").foregroundStyle(.orange)
                }
            }
            if let d {
                Section {
                    ForEach(d.strengths, id: \.self) { bullet($0) }
                } header: {
                    Label("장점", systemImage: "plus.circle").foregroundStyle(Theme.positive)
                }
                Section {
                    ForEach(d.weaknesses, id: \.self) { bullet($0) }
                } header: {
                    Label("단점", systemImage: "minus.circle").foregroundStyle(Theme.negative)
                }
                Section {
                    Text(d.best_for).font(.callout)
                } header: {
                    Label("적합한 시장/종목", systemImage: "scope").foregroundStyle(.blue)
                }
            }
        }
        .navigationTitle(s?.displayName ?? strategy)
        .navigationBarTitleDisplayMode(.inline)
    }

    private func bullet(_ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text("•").foregroundStyle(.secondary)
            Text(text).font(.callout)
        }
    }
}
