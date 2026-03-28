import pandas as pd
import numpy as np
from .base import Strategy, Signal


class RSIStrategy(Strategy):
    name = "rsi"
    display_name = "RSI Overbought/Oversold"
    description = "Buy when RSI drops below oversold level, sell when it rises above overbought level."
    param_schema = [
        {"name": "period", "type": "int", "default": 14, "min": 2, "max": 100, "description": "RSI calculation period"},
        {"name": "oversold", "type": "int", "default": 30, "min": 5, "max": 50, "description": "Oversold threshold (buy signal)"},
        {"name": "overbought", "type": "int", "default": 70, "min": 50, "max": 95, "description": "Overbought threshold (sell signal)"},
    ]

    def _compute_rsi(self, df: pd.DataFrame, period: int) -> pd.Series:
        delta = df["close"].diff()
        gain = delta.where(delta > 0, 0.0)
        loss = -delta.where(delta < 0, 0.0)
        avg_gain = gain.rolling(window=period).mean()
        avg_loss = loss.rolling(window=period).mean()
        rs = avg_gain / avg_loss.replace(0, np.nan)
        return 100 - (100 / (1 + rs))

    def generate_signals(self, df: pd.DataFrame, params: dict) -> list[Signal]:
        period = int(params.get("period", 14))
        oversold = int(params.get("oversold", 30))
        overbought = int(params.get("overbought", 70))

        df = df.copy()
        df["rsi"] = self._compute_rsi(df, period)
        df = df.dropna()

        signals = []
        position = False

        for i in range(len(df)):
            rsi = df.iloc[i]["rsi"]
            d = str(df.iloc[i]["date"])

            if rsi < oversold and not position:
                signals.append(Signal(date=d, action="BUY"))
                position = True
            elif rsi > overbought and position:
                signals.append(Signal(date=d, action="SELL"))
                position = False
            else:
                signals.append(Signal(date=d, action="HOLD"))

        return signals

    def compute_indicators(self, df: pd.DataFrame, params: dict) -> dict:
        period = int(params.get("period", 14))
        df = df.copy()
        df["rsi"] = self._compute_rsi(df, period)
        return {
            "RSI": [{"date": str(r["date"]), "value": round(r["rsi"], 2)} for _, r in df.dropna(subset=["rsi"]).iterrows()],
        }
