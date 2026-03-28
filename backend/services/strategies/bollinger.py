import pandas as pd
from .base import Strategy, Signal


class BollingerBands(Strategy):
    name = "bollinger"
    display_name = "Bollinger Bands"
    description = "Buy when price touches lower band, sell when price touches upper band (mean reversion)."
    param_schema = [
        {"name": "period", "type": "int", "default": 20, "min": 5, "max": 100, "description": "Bollinger Bands period"},
        {"name": "std_dev", "type": "float", "default": 2.0, "min": 0.5, "max": 4.0, "description": "Standard deviation multiplier"},
    ]

    def generate_signals(self, df: pd.DataFrame, params: dict) -> list[Signal]:
        period = int(params.get("period", 20))
        std_dev = float(params.get("std_dev", 2.0))

        df = df.copy()
        df["sma"] = df["close"].rolling(window=period).mean()
        df["std"] = df["close"].rolling(window=period).std()
        df["upper"] = df["sma"] + std_dev * df["std"]
        df["lower"] = df["sma"] - std_dev * df["std"]
        df = df.dropna()

        signals = []
        position = False

        for i in range(len(df)):
            close = df.iloc[i]["close"]
            lower = df.iloc[i]["lower"]
            upper = df.iloc[i]["upper"]
            d = str(df.iloc[i]["date"])

            if close <= lower and not position:
                signals.append(Signal(date=d, action="BUY"))
                position = True
            elif close >= upper and position:
                signals.append(Signal(date=d, action="SELL"))
                position = False
            else:
                signals.append(Signal(date=d, action="HOLD"))

        return signals

    def compute_indicators(self, df: pd.DataFrame, params: dict) -> dict:
        period = int(params.get("period", 20))
        std_dev = float(params.get("std_dev", 2.0))

        df = df.copy()
        df["sma"] = df["close"].rolling(window=period).mean()
        df["std"] = df["close"].rolling(window=period).std()
        df["upper"] = df["sma"] + std_dev * df["std"]
        df["lower"] = df["sma"] - std_dev * df["std"]

        valid = df.dropna(subset=["sma"])
        return {
            "SMA": [{"date": str(r["date"]), "value": round(r["sma"], 4)} for _, r in valid.iterrows()],
            "Upper Band": [{"date": str(r["date"]), "value": round(r["upper"], 4)} for _, r in valid.iterrows()],
            "Lower Band": [{"date": str(r["date"]), "value": round(r["lower"], 4)} for _, r in valid.iterrows()],
        }
