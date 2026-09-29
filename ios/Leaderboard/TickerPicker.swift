import SwiftUI

/// 나스닥 100 종목에서 고른다. 티커나 회사 이름으로 찾는다.
struct TickerPicker: View {
    @Binding var selected: String
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    private var matches: [Listing] {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return Listing.nasdaq100 }
        return Listing.nasdaq100.filter {
            $0.ticker.localizedCaseInsensitiveContains(q) || $0.name.localizedCaseInsensitiveContains(q)
        }
    }

    var body: some View {
        NavigationStack {
            List(matches) { l in
                Button {
                    selected = l.ticker
                    dismiss()
                } label: {
                    HStack {
                        Text(l.ticker).font(.body.monospaced().bold()).frame(width: 64, alignment: .leading)
                        Text(l.name).foregroundStyle(.secondary).lineLimit(1)
                        Spacer()
                        if l.ticker == selected { Image(systemName: "checkmark").foregroundStyle(Color.accentColor) }
                    }
                }
                .tint(.primary)
            }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "티커 또는 회사 이름")
            .textInputAutocapitalization(.characters)
            .navigationTitle("나스닥 100")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("닫기") { dismiss() } } }
        }
    }
}
