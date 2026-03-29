import pandas as pd
from .base import Strategy, Signal


class EMACrossover(Strategy):
    name = "ema_crossover"
    display_name = "EMA Crossover (Short-term)"
    description = "Buy when fast EMA crosses above slow EMA, sell when it crosses below. Faster than SMA crossover."
    param_schema = [
        {"name": "fast_period", "type": "int", "default": 5, "min": 2, "max": 50, "description": "Fast EMA period"},
        {"name": "slow_period", "type": "int", "default": 20, "min": 5, "max": 100, "description": "Slow EMA period"},
    ]

    def generate_signals(self, df: pd.DataFrame, params: dict) -> list[Signal]:
        fast = int(params.get("fast_period", 5))
        slow = int(params.get("slow_period", 20))

        df = df.copy()
        df["fast_ema"] = df["close"].ewm(span=fast, adjust=False).mean()
        df["slow_ema"] = df["close"].ewm(span=slow, adjust=False).mean()
        df = df.dropna()

        signals = []
        position = False

        for i in range(1, len(df)):
            prev_fast = df.iloc[i - 1]["fast_ema"]
            prev_slow = df.iloc[i - 1]["slow_ema"]
            curr_fast = df.iloc[i]["fast_ema"]
            curr_slow = df.iloc[i]["slow_ema"]
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
        fast = int(params.get("fast_period", 5))
        slow = int(params.get("slow_period", 20))

        df = df.copy()
        df["fast_ema"] = df["close"].ewm(span=fast, adjust=False).mean()
        df["slow_ema"] = df["close"].ewm(span=slow, adjust=False).mean()
        valid = df.dropna()

        return {
            f"EMA{fast}": [{"date": str(r["date"]), "value": round(r["fast_ema"], 4)} for _, r in valid.iterrows()],
            f"EMA{slow}": [{"date": str(r["date"]), "value": round(r["slow_ema"], 4)} for _, r in valid.iterrows()],
        }
