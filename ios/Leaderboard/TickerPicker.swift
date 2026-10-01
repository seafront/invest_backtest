import SwiftUI

/// 지수·ETF 목록에서 고르거나, 목록에 없는 티커를 직접 넣는다.
struct TickerPicker: View {
    @Binding var selected: String
    /// 최근 직접 입력한 티커와 이름
    let recent: [(ticker: String, name: String)]
    @Environment(\.dismiss) private var dismiss
    @State private var universe: Universe
    @State private var query = ""

    init(selected: Binding<String>, recent: [(ticker: String, name: String)]) {
        _selected = selected
        self.recent = recent
        _universe = State(initialValue: Listing.universe(of: selected.wrappedValue) ?? .nasdaq100)
    }

    private var trimmed: String { query.trimmingCharacters(in: .whitespaces) }

    private var matches: [Listing] {
        guard !trimmed.isEmpty else { return universe.listings }
        return universe.listings.filter {
            $0.ticker.localizedCaseInsensitiveContains(trimmed) || $0.name.localizedCaseInsensitiveContains(trimmed)
        }
    }

    /// 입력을 Yahoo 티커로 쓸 수 있으면 대문자로. 영문·숫자와 . - ^ = 만 허용한다.
    private var typedTicker: String? {
        let t = trimmed.uppercased()
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: ".-^="))
        guard (1...15).contains(t.count), t.unicodeScalars.allSatisfy({ allowed.contains($0) && $0.isASCII })
        else { return nil }
        return t
    }

    var body: some View {
        NavigationStack {
            List {
                if let t = typedTicker {
                    directSection(t)
                } else if trimmed.isEmpty && !recent.isEmpty {
                    Section("최근 직접 입력") {
                        ForEach(recent, id: \.ticker) { r in row(r.ticker, r.name) }
                    }
                }
                Section {
                    ForEach(matches) { l in row(l.ticker, l.name) }
                } header: {
                    Picker("지수", selection: $universe) {
                        ForEach(Universe.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .textCase(nil)
                    .padding(.bottom, 4)
                } footer: {
                    Text("\(universe.label) · \(matches.count)종목")
                }
            }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always),
                        prompt: "티커 또는 회사 이름")
            .autocorrectionDisabled()
            .onSubmit(of: .search) {
                if let t = typedTicker { pick(t) }
            }
            .navigationTitle("종목 선택")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("닫기") { dismiss() } } }
        }
    }

    /// 입력한 티커가 어느 목록에 있으면 그 종목을, 없으면 "직접 입력"을 보여 준다
    private func directSection(_ t: String) -> some View {
        Section {
            if let l = Listing.find(t) {
                row(l.ticker, l.name, badge: Listing.universe(of: t)?.label)
            } else {
                Button { pick(t) } label: {
                    HStack {
                        Image(systemName: "magnifyingglass")
                        Text("\(t)").font(.body.monospaced().bold())
                        Text("직접 입력해 실행").foregroundStyle(.secondary)
                        Spacer()
                    }
                }
            }
        } header: {
            Text("티커")
        } footer: {
            if Listing.find(t) == nil {
                Text("목록에 없는 종목은 Yahoo Finance 티커로 넣습니다 (예: ARKK, BRK-B, 069500.KS). 달러·원화 종목만 됩니다. 시세가 없으면 실행할 때 알려 줍니다.")
            }
        }
    }

    private func row(_ ticker: String, _ name: String, badge: String? = nil) -> some View {
        Button { pick(ticker) } label: {
            HStack {
                Text(ticker).font(.body.monospaced().bold()).frame(minWidth: 64, alignment: .leading)
                Text(name).foregroundStyle(.secondary).lineLimit(1)
                Spacer()
                if let badge { Text(badge).font(.caption).foregroundStyle(.secondary) }
                if ticker == selected { Image(systemName: "checkmark").foregroundStyle(Color.accentColor) }
            }
        }
        .tint(.primary)
    }

    private func pick(_ ticker: String) {
        selected = ticker
        dismiss()
    }
}
