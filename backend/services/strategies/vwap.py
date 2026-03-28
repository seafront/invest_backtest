import pandas as pd
from .base import Strategy, Signal


class VWAPStrategy(Strategy):
    name = "vwap"
    display_name = "VWAP Reversion"
    description = "Buy when price drops below VWAP by threshold, sell when price rises above VWAP by threshold."
    param_schema = [
        {"name": "period", "type": "int", "default": 20, "min": 5, "max": 60, "description": "Rolling VWAP period (days)"},
        {"name": "buy_threshold", "type": "float", "default": -2.0, "min": -10.0, "max": -0.5, "description": "Buy when price is N% below VWAP"},
        {"name": "sell_threshold", "type": "float", "default": 2.0, "min": 0.5, "max": 10.0, "description": "Sell when price is N% above VWAP"},
    ]

    def generate_signals(self, df: pd.DataFrame, params: dict) -> list[Signal]:
        period = int(params.get("period", 20))
        buy_thresh = float(params.get("buy_threshold", -2.0))
        sell_thresh = float(params.get("sell_threshold", 2.0))

        df = df.copy()
        # Rolling VWAP: sum(close * volume) / sum(volume) over N days
        df["cum_vol_price"] = (df["close"] * df["volume"]).rolling(window=period).sum()
        df["cum_vol"] = df["volume"].rolling(window=period).sum()
        df["vwap"] = df["cum_vol_price"] / df["cum_vol"]
        df["pct_from_vwap"] = (df["close"] - df["vwap"]) / df["vwap"] * 100
        df = df.dropna()

        signals = []
        position = False

        for i in range(len(df)):
            pct = df.iloc[i]["pct_from_vwap"]
            d = str(df.iloc[i]["date"])

            if pct < buy_thresh and not position:
                signals.append(Signal(date=d, action="BUY"))
                position = True
            elif pct > sell_thresh and position:
                signals.append(Signal(date=d, action="SELL"))
                position = False
            else:
                signals.append(Signal(date=d, action="HOLD"))

        return signals

    def compute_indicators(self, df: pd.DataFrame, params: dict) -> dict:
        period = int(params.get("period", 20))

        df = df.copy()
        df["cum_vol_price"] = (df["close"] * df["volume"]).rolling(window=period).sum()
        df["cum_vol"] = df["volume"].rolling(window=period).sum()
        df["vwap"] = df["cum_vol_price"] / df["cum_vol"]
        valid = df.dropna(subset=["vwap"])

        return {
            "VWAP": [{"date": str(r["date"]), "value": round(r["vwap"], 4)} for _, r in valid.iterrows()],
        }
