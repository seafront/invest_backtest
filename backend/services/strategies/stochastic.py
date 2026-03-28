import pandas as pd
from .base import Strategy, Signal


class StochasticOscillator(Strategy):
    name = "stochastic"
    display_name = "Stochastic Oscillator"
    description = "Buy when %K crosses above %D in oversold zone, sell when crosses below in overbought zone."
    param_schema = [
        {"name": "k_period", "type": "int", "default": 14, "min": 5, "max": 50, "description": "%K lookback period"},
        {"name": "d_period", "type": "int", "default": 3, "min": 2, "max": 10, "description": "%D smoothing period"},
        {"name": "oversold", "type": "int", "default": 20, "min": 5, "max": 40, "description": "Oversold threshold"},
        {"name": "overbought", "type": "int", "default": 80, "min": 60, "max": 95, "description": "Overbought threshold"},
    ]

    def generate_signals(self, df: pd.DataFrame, params: dict) -> list[Signal]:
        k_period = int(params.get("k_period", 14))
        d_period = int(params.get("d_period", 3))
        oversold = int(params.get("oversold", 20))
        overbought = int(params.get("overbought", 80))

        df = df.copy()
        low_min = df["low"].rolling(window=k_period).min()
        high_max = df["high"].rolling(window=k_period).max()
        df["k"] = ((df["close"] - low_min) / (high_max - low_min)) * 100
        df["d"] = df["k"].rolling(window=d_period).mean()
        df = df.dropna()

        signals = []
        position = False

        for i in range(1, len(df)):
            prev_k = df.iloc[i - 1]["k"]
            prev_d = df.iloc[i - 1]["d"]
            curr_k = df.iloc[i]["k"]
            curr_d = df.iloc[i]["d"]
            d = str(df.iloc[i]["date"])

            if prev_k <= prev_d and curr_k > curr_d and curr_k < oversold and not position:
                signals.append(Signal(date=d, action="BUY"))
                position = True
            elif prev_k >= prev_d and curr_k < curr_d and curr_k > overbought and position:
                signals.append(Signal(date=d, action="SELL"))
                position = False
            else:
                signals.append(Signal(date=d, action="HOLD"))

        return signals

    def compute_indicators(self, df: pd.DataFrame, params: dict) -> dict:
        k_period = int(params.get("k_period", 14))
        d_period = int(params.get("d_period", 3))

        df = df.copy()
        low_min = df["low"].rolling(window=k_period).min()
        high_max = df["high"].rolling(window=k_period).max()
        df["k"] = ((df["close"] - low_min) / (high_max - low_min)) * 100
        df["d"] = df["k"].rolling(window=d_period).mean()
        valid = df.dropna()

        return {
            "%K": [{"date": str(r["date"]), "value": round(r["k"], 2)} for _, r in valid.iterrows()],
            "%D": [{"date": str(r["date"]), "value": round(r["d"], 2)} for _, r in valid.iterrows()],
        }
