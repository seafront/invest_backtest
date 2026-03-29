import pandas as pd
import numpy as np
from .base import Strategy, Signal


class ADXTrend(Strategy):
    name = "adx_trend"
    display_name = "ADX Trend"
    description = "Buy when ADX shows strong trend and +DI > -DI, sell when trend weakens or reverses."
    param_schema = [
        {"name": "period", "type": "int", "default": 14, "min": 5, "max": 50, "description": "ADX calculation period"},
        {"name": "adx_threshold", "type": "int", "default": 25, "min": 15, "max": 50, "description": "ADX strength threshold"},
    ]

    def _compute_adx(self, df: pd.DataFrame, period: int):
        df = df.copy()
        df["h_l"] = df["high"] - df["low"]
        df["h_pc"] = abs(df["high"] - df["close"].shift(1))
        df["l_pc"] = abs(df["low"] - df["close"].shift(1))
        df["tr"] = df[["h_l", "h_pc", "l_pc"]].max(axis=1)

        df["up_move"] = df["high"] - df["high"].shift(1)
        df["down_move"] = df["low"].shift(1) - df["low"]

        df["plus_dm"] = np.where((df["up_move"] > df["down_move"]) & (df["up_move"] > 0), df["up_move"], 0.0)
        df["minus_dm"] = np.where((df["down_move"] > df["up_move"]) & (df["down_move"] > 0), df["down_move"], 0.0)

        df["atr"] = df["tr"].rolling(window=period).mean()
        df["plus_di"] = (df["plus_dm"].rolling(window=period).mean() / df["atr"]) * 100
        df["minus_di"] = (df["minus_dm"].rolling(window=period).mean() / df["atr"]) * 100

        df["dx"] = (abs(df["plus_di"] - df["minus_di"]) / (df["plus_di"] + df["minus_di"]).replace(0, np.nan)) * 100
        df["adx"] = df["dx"].rolling(window=period).mean()

        return df

    def generate_signals(self, df: pd.DataFrame, params: dict) -> list[Signal]:
        period = int(params.get("period", 14))
        threshold = int(params.get("adx_threshold", 25))

        df = self._compute_adx(df, period)
        df = df.dropna()

        signals = []
        position = False

        for i in range(len(df)):
            adx = df.iloc[i]["adx"]
            plus_di = df.iloc[i]["plus_di"]
            minus_di = df.iloc[i]["minus_di"]
            d = str(df.iloc[i]["date"])

            if adx > threshold and plus_di > minus_di and not position:
                signals.append(Signal(date=d, action="BUY"))
                position = True
            elif (adx < threshold or minus_di > plus_di) and position:
                signals.append(Signal(date=d, action="SELL"))
                position = False
            else:
                signals.append(Signal(date=d, action="HOLD"))

        return signals

    def compute_indicators(self, df: pd.DataFrame, params: dict) -> dict:
        period = int(params.get("period", 14))
        df = self._compute_adx(df, period)
        valid = df.dropna()
        return {
            "ADX": [{"date": str(r["date"]), "value": round(r["adx"], 2)} for _, r in valid.iterrows()],
            "+DI": [{"date": str(r["date"]), "value": round(r["plus_di"], 2)} for _, r in valid.iterrows()],
            "-DI": [{"date": str(r["date"]), "value": round(r["minus_di"], 2)} for _, r in valid.iterrows()],
        }
