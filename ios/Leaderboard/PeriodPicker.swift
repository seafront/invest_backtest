import BacktestCore
import SwiftUI

/// Tear Sheet 의 계산 구간 (웹 components/PeriodPicker.tsx).
///
/// 전체 기간에 맞춘 값이 최근 시세에는 맞지 않을 수 있어, 구간을 좁혀 지표·그래프·매매 기록을 모두
/// 그 구간으로 다시 계산한다. 저장하지 않는다. Leaderboard 의 5년 구간 안에서만 고른다.
struct PeriodPicker: View {
    /// Leaderboard 가 돌린 전체 구간
    let full: ClosedRange<Day>
    /// nil 이면 전체 구간
    @Binding var period: ClosedRange<Day>?
    let loading: Bool
    let failure: String?

    @State private var startDate = Date()
    @State private var endDate = Date()

    /// 빠른 선택. 전체 구간의 끝 날짜에서 거슬러 올라간다. months 0 은 전체.
    private static let presets = [("전체", 0), ("최근 3년", 36), ("최근 2년", 24), ("최근 1년", 12), ("최근 6개월", 6)]

    private var current: ClosedRange<Day> { period ?? full }

    var body: some View {
        Section {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(Self.presets, id: \.1) { label, months in
                        let start = months == 0 ? full.lowerBound : full.upperBound.monthsBefore(months)
                        let ok = start >= full.lowerBound
                        let active = current == start...full.upperBound
                        Button(label) { choose(start...full.upperBound) }
                            .buttonStyle(.bordered)
                            .tint(active ? .accentColor : .gray)
                            .fontWeight(active ? .bold : .regular)
                            .disabled(!ok)
                    }
                }
                .font(.subheadline)
            }

            DatePicker("시작일", selection: $startDate, in: full.lowerBound.localDate...full.upperBound.localDate,
                       displayedComponents: .date)
            DatePicker("종료일", selection: $endDate, in: full.lowerBound.localDate...full.upperBound.localDate,
                       displayedComponents: .date)
        } header: {
            Text("계산 구간")
        } footer: {
            Text(message).foregroundStyle(inputError != nil || failure != nil ? Theme.negative : .secondary)
        }
        .onAppear(perform: syncPickers)
        .onChange(of: period) { syncPickers() }
        .onChange(of: startDate) { fromPickers() }
        .onChange(of: endDate) { fromPickers() }
        .listRowBackground(period == nil ? nil : Color.orange.opacity(0.08))
    }

    private var inputError: String? {
        let s = Day(localDate: startDate), e = Day(localDate: endDate)
        if s < full.lowerBound || e > full.upperBound {
            return "\(full.lowerBound) ~ \(full.upperBound) 안에서 고르세요"
        }
        if s >= e { return "시작일이 종료일보다 앞이어야 합니다" }
        return nil
    }

    private var message: String {
        if let inputError { return inputError }
        if let failure { return failure }
        if loading { return "계산 중…" }
        return period == nil
            ? "Leaderboard 와 같은 전체 구간입니다 (\(full.lowerBound) ~ \(full.upperBound))."
            : "이 구간으로 다시 계산한 결과입니다(저장하지 않음). 구간 시작 전 시세로 지표를 준비해, 이미 매수 상태면 첫날 삽니다."
    }

    private func choose(_ r: ClosedRange<Day>) {
        period = r == full ? nil : r
    }

    private func syncPickers() {
        let r = current
        if Day(localDate: startDate) != r.lowerBound { startDate = r.lowerBound.localDate }
        if Day(localDate: endDate) != r.upperBound { endDate = r.upperBound.localDate }
    }

    private func fromPickers() {
        guard inputError == nil else { return }
        let r = Day(localDate: startDate)...Day(localDate: endDate)
        if r != current { choose(r) }
    }
}

extension Day {
    /// 날짜 선택기용 — 기기 시간대의 그날 자정
    var localDate: Date {
        let (y, m, d) = components
        return Calendar.current.date(from: DateComponents(year: y, month: m, day: d))!
    }

    init(localDate: Date) {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: localDate)
        self.init(year: c.year!, month: c.month!, day: c.day!)
    }
}
