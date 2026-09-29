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

        # 지표가 처음 계산된 날 이미 교차 이후 상태면 그날 진입한다. 교차 "순간"만 보면
        # 지표가 준비되기 전에 일어난 교차를 영영 놓쳐, 다음 반대 교차까지 기다리게 된다
        # (TQQQ 50/200은 2020년 교차를 놓치고 2023-04에야 첫 매수를 했다). 백테스트는 시작일
        # 전 준비 구간부터 신호를 계산하므로, 이 진입은 준비 구간에서 일어나 시작일 보유로 이어진다.
        if len(df) and df.iloc[0]["macd"] > df.iloc[0]["signal"]:
            signals.append(Signal(date=str(df.iloc[0]["date"]), action="BUY"))
            position = True

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
