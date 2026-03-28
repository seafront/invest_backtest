import pandas as pd
import numpy as np
from .base import Strategy, Signal


class DualMARSI(Strategy):
    name = "dual_ma_rsi"
    display_name = "Dual MA + RSI"
    description = "Buy when MA trend is up AND RSI is oversold. Sell when MA trend is down AND RSI is overbought."
    param_schema = [
        {"name": "fast_period", "type": "int", "default": 20, "min": 5, "max": 100, "description": "Fast MA period (trend filter)"},
        {"name": "slow_period", "type": "int", "default": 50, "min": 20, "max": 200, "description": "Slow MA period (trend filter)"},
        {"name": "rsi_period", "type": "int", "default": 14, "min": 5, "max": 50, "description": "RSI period (timing)"},
        {"name": "rsi_buy", "type": "int", "default": 40, "min": 20, "max": 50, "description": "RSI buy threshold (in uptrend)"},
        {"name": "rsi_sell", "type": "int", "default": 60, "min": 50, "max": 80, "description": "RSI sell threshold (in downtrend)"},
    ]

    def _compute_rsi(self, series: pd.Series, period: int) -> pd.Series:
        delta = series.diff()
        gain = delta.where(delta > 0, 0.0)
        loss = -delta.where(delta < 0, 0.0)
        avg_gain = gain.rolling(window=period).mean()
        avg_loss = loss.rolling(window=period).mean()
        rs = avg_gain / avg_loss.replace(0, np.nan)
        return 100 - (100 / (1 + rs))

    def generate_signals(self, df: pd.DataFrame, params: dict) -> list[Signal]:
        fast = int(params.get("fast_period", 20))
        slow = int(params.get("slow_period", 50))
        rsi_period = int(params.get("rsi_period", 14))
        rsi_buy = int(params.get("rsi_buy", 40))
        rsi_sell = int(params.get("rsi_sell", 60))

        df = df.copy()
        df["fast_ma"] = df["close"].rolling(window=fast).mean()
        df["slow_ma"] = df["close"].rolling(window=slow).mean()
        df["rsi"] = self._compute_rsi(df["close"], rsi_period)
        df = df.dropna()

        signals = []
        position = False

        for i in range(len(df)):
            fast_ma = df.iloc[i]["fast_ma"]
            slow_ma = df.iloc[i]["slow_ma"]
            rsi = df.iloc[i]["rsi"]
            d = str(df.iloc[i]["date"])

            uptrend = fast_ma > slow_ma
            downtrend = fast_ma < slow_ma

            if uptrend and rsi < rsi_buy and not position:
                signals.append(Signal(date=d, action="BUY"))
                position = True
            elif downtrend and rsi > rsi_sell and position:
                signals.append(Signal(date=d, action="SELL"))
                position = False
            else:
                signals.append(Signal(date=d, action="HOLD"))

        return signals

    def compute_indicators(self, df: pd.DataFrame, params: dict) -> dict:
        fast = int(params.get("fast_period", 20))
        slow = int(params.get("slow_period", 50))
        rsi_period = int(params.get("rsi_period", 14))

        df = df.copy()
        df["fast_ma"] = df["close"].rolling(window=fast).mean()
        df["slow_ma"] = df["close"].rolling(window=slow).mean()
        df["rsi"] = self._compute_rsi(df["close"], rsi_period)

        return {
            f"MA{fast}": [{"date": str(r["date"]), "value": round(r["fast_ma"], 4)} for _, r in df.dropna(subset=["fast_ma"]).iterrows()],
            f"MA{slow}": [{"date": str(r["date"]), "value": round(r["slow_ma"], 4)} for _, r in df.dropna(subset=["slow_ma"]).iterrows()],
        }
