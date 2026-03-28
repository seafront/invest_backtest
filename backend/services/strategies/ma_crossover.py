import pandas as pd
from .base import Strategy, Signal


class MACrossover(Strategy):
    name = "ma_crossover"
    display_name = "Moving Average Crossover"
    description = "Buy when fast MA crosses above slow MA, sell when it crosses below."
    param_schema = [
        {"name": "fast_period", "type": "int", "default": 10, "min": 2, "max": 200, "description": "Fast moving average period"},
        {"name": "slow_period", "type": "int", "default": 50, "min": 5, "max": 500, "description": "Slow moving average period"},
    ]

    def generate_signals(self, df: pd.DataFrame, params: dict) -> list[Signal]:
        fast = int(params.get("fast_period", 10))
        slow = int(params.get("slow_period", 50))

        df = df.copy()
        df["fast_ma"] = df["close"].rolling(window=fast).mean()
        df["slow_ma"] = df["close"].rolling(window=slow).mean()
        df = df.dropna()

        signals = []
        position = False

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
        fast = int(params.get("fast_period", 10))
        slow = int(params.get("slow_period", 50))

        df = df.copy()
        df["fast_ma"] = df["close"].rolling(window=fast).mean()
        df["slow_ma"] = df["close"].rolling(window=slow).mean()

        return {
            f"MA{fast}": [{"date": str(r["date"]), "value": round(r["fast_ma"], 4)} for _, r in df.dropna(subset=["fast_ma"]).iterrows()],
            f"MA{slow}": [{"date": str(r["date"]), "value": round(r["slow_ma"], 4)} for _, r in df.dropna(subset=["slow_ma"]).iterrows()],
        }
