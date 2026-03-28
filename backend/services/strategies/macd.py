import pandas as pd
from .base import Strategy, Signal


class MACDStrategy(Strategy):
    name = "macd"
    display_name = "MACD"
    description = "Buy when MACD line crosses above signal line, sell when it crosses below."
    param_schema = [
        {"name": "fast_period", "type": "int", "default": 12, "min": 5, "max": 50, "description": "Fast EMA period"},
        {"name": "slow_period", "type": "int", "default": 26, "min": 10, "max": 100, "description": "Slow EMA period"},
        {"name": "signal_period", "type": "int", "default": 9, "min": 3, "max": 30, "description": "Signal line period"},
    ]

    def generate_signals(self, df: pd.DataFrame, params: dict) -> list[Signal]:
        fast = int(params.get("fast_period", 12))
        slow = int(params.get("slow_period", 26))
        signal_p = int(params.get("signal_period", 9))

        df = df.copy()
        df["ema_fast"] = df["close"].ewm(span=fast, adjust=False).mean()
        df["ema_slow"] = df["close"].ewm(span=slow, adjust=False).mean()
        df["macd"] = df["ema_fast"] - df["ema_slow"]
        df["signal"] = df["macd"].ewm(span=signal_p, adjust=False).mean()
        df = df.dropna()

        signals = []
        position = False

        for i in range(1, len(df)):
            prev_macd = df.iloc[i - 1]["macd"]
            prev_signal = df.iloc[i - 1]["signal"]
            curr_macd = df.iloc[i]["macd"]
            curr_signal = df.iloc[i]["signal"]
            d = str(df.iloc[i]["date"])

            if prev_macd <= prev_signal and curr_macd > curr_signal and not position:
                signals.append(Signal(date=d, action="BUY"))
                position = True
            elif prev_macd >= prev_signal and curr_macd < curr_signal and position:
                signals.append(Signal(date=d, action="SELL"))
                position = False
            else:
                signals.append(Signal(date=d, action="HOLD"))

        return signals

    def compute_indicators(self, df: pd.DataFrame, params: dict) -> dict:
        fast = int(params.get("fast_period", 12))
        slow = int(params.get("slow_period", 26))
        signal_p = int(params.get("signal_period", 9))

        df = df.copy()
        df["ema_fast"] = df["close"].ewm(span=fast, adjust=False).mean()
        df["ema_slow"] = df["close"].ewm(span=slow, adjust=False).mean()
        df["macd"] = df["ema_fast"] - df["ema_slow"]
        df["signal"] = df["macd"].ewm(span=signal_p, adjust=False).mean()
        valid = df.dropna()

        return {
            "MACD": [{"date": str(r["date"]), "value": round(r["macd"], 4)} for _, r in valid.iterrows()],
            "Signal": [{"date": str(r["date"]), "value": round(r["signal"], 4)} for _, r in valid.iterrows()],
        }
