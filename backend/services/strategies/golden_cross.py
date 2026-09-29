import pandas as pd
from .base import Strategy, Signal


class GoldenCross(Strategy):
    name = "golden_cross"
    display_name = "Golden Cross (50/200)"
    description = "Buy on 50/200 MA golden cross, sell on death cross. Long-term trend strategy."
    param_schema = [
        {"name": "fast_period", "type": "int", "default": 50, "min": 20, "max": 100, "description": "Short-term MA period"},
        {"name": "slow_period", "type": "int", "default": 200, "min": 100, "max": 500, "description": "Long-term MA period"},
    ]

    def generate_signals(self, df: pd.DataFrame, params: dict) -> list[Signal]:
        fast = int(params.get("fast_period", 50))
        slow = int(params.get("slow_period", 200))

        df = df.copy()
        df["fast_ma"] = df["close"].rolling(window=fast).mean()
        df["slow_ma"] = df["close"].rolling(window=slow).mean()
        df = df.dropna()

        signals = []
        position = False

        # 지표가 처음 계산된 날 이미 교차 이후 상태면 그날 진입한다. 교차 "순간"만 보면
        # 지표가 준비되기 전에 일어난 교차를 영영 놓쳐, 다음 반대 교차까지 기다리게 된다
        # (TQQQ 50/200은 2020년 교차를 놓치고 2023-04에야 첫 매수를 했다). 백테스트는 시작일
        # 전 준비 구간부터 신호를 계산하므로, 이 진입은 준비 구간에서 일어나 시작일 보유로 이어진다.
        if len(df) and df.iloc[0]["fast_ma"] > df.iloc[0]["slow_ma"]:
            signals.append(Signal(date=str(df.iloc[0]["date"]), action="BUY"))
            position = True

        for i in range(1, len(df)):
            prev_fast = df.iloc[i - 1]["fast_ma"]
            prev_slow = df.iloc[i - 1]["slow_ma"]
            curr_fast = df.iloc[i]["fast_ma"]
            curr_slow = df.iloc[i]["slow_ma"]
            d = str(df.iloc[i]["date"])

            if prev_fast <= prev_slow and curr_fast > curr_slow and not position:
                signals.append(Signal(date=d, action="BUY"))
                position = True
            elif prev_fast >= prev_slow and curr_fast < curr_slow and position:
                signals.append(Signal(date=d, action="SELL"))
                position = False
            else:
                signals.append(Signal(date=d, action="HOLD"))

        return signals

    def compute_indicators(self, df: pd.DataFrame, params: dict) -> dict:
        fast = int(params.get("fast_period", 50))
        slow = int(params.get("slow_period", 200))

        df = df.copy()
        df["fast_ma"] = df["close"].rolling(window=fast).mean()
        df["slow_ma"] = df["close"].rolling(window=slow).mean()

        return {
            f"MA{fast}": [{"date": str(r["date"]), "value": round(r["fast_ma"], 4)} for _, r in df.dropna(subset=["fast_ma"]).iterrows()],
            f"MA{slow}": [{"date": str(r["date"]), "value": round(r["slow_ma"], 4)} for _, r in df.dropna(subset=["slow_ma"]).iterrows()],
        }
