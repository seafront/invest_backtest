import pandas as pd
from .base import Strategy, Signal


class BuyAndHold(Strategy):
    name = "buy_and_hold"
    display_name = "Buy & Hold"
    description = "Buy on the first day and hold until the end. The simplest benchmark strategy."
    param_schema = []

    def generate_signals(self, df: pd.DataFrame, params: dict) -> list[Signal]:
        df = df.copy()
        signals = []
        bought = False

        for i in range(len(df)):
            d = str(df.iloc[i]["date"])
            if not bought:
                signals.append(Signal(date=d, action="BUY"))
                bought = True
            else:
                signals.append(Signal(date=d, action="HOLD"))

        return signals

    def compute_indicators(self, df: pd.DataFrame, params: dict) -> dict:
        return {}
