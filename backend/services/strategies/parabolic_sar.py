import pandas as pd
from .base import Strategy, Signal


class ParabolicSAR(Strategy):
    name = "parabolic_sar"
    display_name = "Parabolic SAR"
    description = "Buy when SAR flips below price (uptrend), sell when SAR flips above price (downtrend)."
    param_schema = [
        {"name": "af_start", "type": "float", "default": 0.02, "min": 0.01, "max": 0.1, "description": "Acceleration factor start"},
        {"name": "af_max", "type": "float", "default": 0.2, "min": 0.1, "max": 0.5, "description": "Acceleration factor maximum"},
    ]

    def _compute_sar(self, df: pd.DataFrame, af_start: float, af_max: float):
        high = df["high"].values
        low = df["low"].values
        close = df["close"].values
        n = len(df)

        sar = [0.0] * n
        af = af_start
        uptrend = True
        ep = high[0]
        sar[0] = low[0]

        for i in range(1, n):
            if uptrend:
                sar[i] = sar[i - 1] + af * (ep - sar[i - 1])
                sar[i] = min(sar[i], low[i - 1])
                if i >= 2:
                    sar[i] = min(sar[i], low[i - 2])

                if low[i] < sar[i]:
                    uptrend = False
                    sar[i] = ep
                    ep = low[i]
                    af = af_start
                else:
                    if high[i] > ep:
                        ep = high[i]
                        af = min(af + af_start, af_max)
            else:
                sar[i] = sar[i - 1] + af * (ep - sar[i - 1])
                sar[i] = max(sar[i], high[i - 1])
                if i >= 2:
                    sar[i] = max(sar[i], high[i - 2])

                if high[i] > sar[i]:
                    uptrend = True
                    sar[i] = ep
                    ep = high[i]
                    af = af_start
                else:
                    if low[i] < ep:
                        ep = low[i]
                        af = min(af + af_start, af_max)

        return sar

    def warmup_bars(self, params: dict) -> int:
        """기간 파라미터가 없어 기본 규칙으로는 준비 구간이 0이 된다. SAR은 첫 봉의 값에서
        재귀로 이어지므로 시작점이 바뀌면 신호도 바뀐다 — 60일을 먼저 돌려 궤적을 안정시킨다."""
        return 60

    def generate_signals(self, df: pd.DataFrame, params: dict) -> list[Signal]:
        af_start = float(params.get("af_start", 0.02))
        af_max = float(params.get("af_max", 0.2))

        df = df.copy()
        sar_values = self._compute_sar(df, af_start, af_max)
        df["sar"] = sar_values

        signals = []
        position = False

        # 지표가 처음 계산된 날 이미 교차 이후 상태면 그날 진입한다. 교차 "순간"만 보면
        # 지표가 준비되기 전에 일어난 교차를 영영 놓쳐, 다음 반대 교차까지 기다리게 된다
        # (TQQQ 50/200은 2020년 교차를 놓치고 2023-04에야 첫 매수를 했다). 백테스트는 시작일
        # 전 준비 구간부터 신호를 계산하므로, 이 진입은 준비 구간에서 일어나 시작일 보유로 이어진다.
        if len(df) and df.iloc[0]["close"] > df.iloc[0]["sar"]:
            signals.append(Signal(date=str(df.iloc[0]["date"]), action="BUY"))
            position = True

        for i in range(1, len(df)):
            prev_below = df.iloc[i - 1]["close"] > df.iloc[i - 1]["sar"]
            curr_below = df.iloc[i]["close"] > df.iloc[i]["sar"]
            d = str(df.iloc[i]["date"])

            if not prev_below and curr_below and not position:
                signals.append(Signal(date=d, action="BUY"))
                position = True
            elif prev_below and not curr_below and position:
                signals.append(Signal(date=d, action="SELL"))
                position = False
            else:
                signals.append(Signal(date=d, action="HOLD"))

        return signals

    def compute_indicators(self, df: pd.DataFrame, params: dict) -> dict:
        af_start = float(params.get("af_start", 0.02))
        af_max = float(params.get("af_max", 0.2))

        df = df.copy()
        sar_values = self._compute_sar(df, af_start, af_max)
        return {
            "SAR": [{"date": str(df.iloc[i]["date"]), "value": round(sar_values[i], 4)} for i in range(len(df))],
        }
