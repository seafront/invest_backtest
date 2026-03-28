import pandas as pd
from .base import Strategy, Signal


class BreakoutStrategy(Strategy):
    name = "breakout"
    display_name = "Breakout (Donchian)"
    description = "Buy on N-day high breakout, sell on M-day low breakdown. Trend-following breakout strategy."
    param_schema = [
        {"name": "entry_period", "type": "int", "default": 20, "min": 5, "max": 100, "description": "Entry breakout period (N-day high)"},
        {"name": "exit_period", "type": "int", "default": 10, "min": 3, "max": 50, "description": "Exit breakdown period (M-day low)"},
    ]

    def generate_signals(self, df: pd.DataFrame, params: dict) -> list[Signal]:
        entry_p = int(params.get("entry_period", 20))
        exit_p = int(params.get("exit_period", 10))

        df = df.copy()
        df["high_n"] = df["high"].rolling(window=entry_p).max()
        df["low_m"] = df["low"].rolling(window=exit_p).min()
        df = df.dropna()

        signals = []
        position = False

        for i in range(1, len(df)):
            close = df.iloc[i]["close"]
            prev_high_n = df.iloc[i - 1]["high_n"]
            prev_low_m = df.iloc[i - 1]["low_m"]
            d = str(df.iloc[i]["date"])

            if close > prev_high_n and not position:
                signals.append(Signal(date=d, action="BUY"))
                position = True
            elif close < prev_low_m and position:
                signals.append(Signal(date=d, action="SELL"))
                position = False
            else:
                signals.append(Signal(date=d, action="HOLD"))

        return signals

    def compute_indicators(self, df: pd.DataFrame, params: dict) -> dict:
        entry_p = int(params.get("entry_period", 20))
        exit_p = int(params.get("exit_period", 10))

        df = df.copy()
        df["high_n"] = df["high"].rolling(window=entry_p).max()
        df["low_m"] = df["low"].rolling(window=exit_p).min()
        valid = df.dropna()

        return {
            f"{entry_p}D High": [{"date": str(r["date"]), "value": round(r["high_n"], 4)} for _, r in valid.iterrows()],
            f"{exit_p}D Low": [{"date": str(r["date"]), "value": round(r["low_m"], 4)} for _, r in valid.iterrows()],
        }
