import pandas as pd
from .base import Strategy, Signal


class MomentumROC(Strategy):
    name = "momentum_roc"
    display_name = "Momentum (ROC)"
    description = "Buy when Rate of Change exceeds threshold, sell when it drops below negative threshold."
    param_schema = [
        {"name": "period", "type": "int", "default": 10, "min": 3, "max": 50, "description": "ROC lookback period"},
        {"name": "buy_threshold", "type": "float", "default": 3.0, "min": 0.5, "max": 20.0, "description": "Buy when ROC > N%"},
        {"name": "sell_threshold", "type": "float", "default": -3.0, "min": -20.0, "max": -0.5, "description": "Sell when ROC < -N%"},
    ]

    def generate_signals(self, df: pd.DataFrame, params: dict) -> list[Signal]:
        period = int(params.get("period", 10))
        buy_thresh = float(params.get("buy_threshold", 3.0))
        sell_thresh = float(params.get("sell_threshold", -3.0))

        df = df.copy()
        df["roc"] = (df["close"] - df["close"].shift(period)) / df["close"].shift(period) * 100
        df = df.dropna()

        signals = []
        position = False

        for i in range(len(df)):
            roc = df.iloc[i]["roc"]
            d = str(df.iloc[i]["date"])

            if roc > buy_thresh and not position:
                signals.append(Signal(date=d, action="BUY"))
                position = True
            elif roc < sell_thresh and position:
                signals.append(Signal(date=d, action="SELL"))
                position = False
            else:
                signals.append(Signal(date=d, action="HOLD"))

        return signals

    def compute_indicators(self, df: pd.DataFrame, params: dict) -> dict:
        period = int(params.get("period", 10))
        df = df.copy()
        df["roc"] = (df["close"] - df["close"].shift(period)) / df["close"].shift(period) * 100
        valid = df.dropna()
        return {
            "ROC": [{"date": str(r["date"]), "value": round(r["roc"], 2)} for _, r in valid.iterrows()],
        }
