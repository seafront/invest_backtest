import pandas as pd
from .base import Strategy, Signal


class KeltnerChannel(Strategy):
    name = "keltner"
    display_name = "Keltner Channel"
    description = "Buy on upper channel breakout (trend following), sell on lower channel breakdown."
    param_schema = [
        {"name": "ema_period", "type": "int", "default": 20, "min": 5, "max": 100, "description": "EMA period for middle line"},
        {"name": "atr_period", "type": "int", "default": 10, "min": 3, "max": 50, "description": "ATR period"},
        {"name": "atr_mult", "type": "float", "default": 2.0, "min": 0.5, "max": 5.0, "description": "ATR multiplier for channel width"},
    ]

    def _compute_channels(self, df: pd.DataFrame, ema_period: int, atr_period: int, atr_mult: float):
        df = df.copy()
        df["ema"] = df["close"].ewm(span=ema_period, adjust=False).mean()

        df["h_l"] = df["high"] - df["low"]
        df["h_pc"] = abs(df["high"] - df["close"].shift(1))
        df["l_pc"] = abs(df["low"] - df["close"].shift(1))
        df["tr"] = df[["h_l", "h_pc", "l_pc"]].max(axis=1)
        df["atr"] = df["tr"].rolling(window=atr_period).mean()

        df["upper"] = df["ema"] + atr_mult * df["atr"]
        df["lower"] = df["ema"] - atr_mult * df["atr"]
        return df

    def generate_signals(self, df: pd.DataFrame, params: dict) -> list[Signal]:
        ema_period = int(params.get("ema_period", 20))
        atr_period = int(params.get("atr_period", 10))
        atr_mult = float(params.get("atr_mult", 2.0))

        df = self._compute_channels(df, ema_period, atr_period, atr_mult)
        df = df.dropna()

        signals = []
        position = False

        for i in range(len(df)):
            close = df.iloc[i]["close"]
            upper = df.iloc[i]["upper"]
            lower = df.iloc[i]["lower"]
            d = str(df.iloc[i]["date"])

            if close > upper and not position:
                signals.append(Signal(date=d, action="BUY"))
                position = True
            elif close < lower and position:
                signals.append(Signal(date=d, action="SELL"))
                position = False
            else:
                signals.append(Signal(date=d, action="HOLD"))

        return signals

    def compute_indicators(self, df: pd.DataFrame, params: dict) -> dict:
        ema_period = int(params.get("ema_period", 20))
        atr_period = int(params.get("atr_period", 10))
        atr_mult = float(params.get("atr_mult", 2.0))

        df = self._compute_channels(df, ema_period, atr_period, atr_mult)
        valid = df.dropna()

        return {
            "EMA": [{"date": str(r["date"]), "value": round(r["ema"], 4)} for _, r in valid.iterrows()],
            "Upper": [{"date": str(r["date"]), "value": round(r["upper"], 4)} for _, r in valid.iterrows()],
            "Lower": [{"date": str(r["date"]), "value": round(r["lower"], 4)} for _, r in valid.iterrows()],
        }
