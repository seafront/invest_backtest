from abc import ABC, abstractmethod
from dataclasses import dataclass
import pandas as pd


@dataclass
class Signal:
    date: str
    action: str  # "BUY", "SELL", "HOLD"


class Strategy(ABC):
    name: str = ""
    display_name: str = ""
    description: str = ""
    param_schema: list[dict] = []

    @abstractmethod
    def generate_signals(self, df: pd.DataFrame, params: dict) -> list[Signal]:
        """Given OHLCV DataFrame, return list of trading signals."""
        ...

    def compute_indicators(self, df: pd.DataFrame, params: dict) -> dict:
        """Return dict of indicator name -> list of {date, value} for chart overlay."""
        return {}

    def warmup_bars(self, params: dict) -> int:
        """시작일 전에 더 불러올 거래일 수. 지표가 첫날부터 계산돼 있어야 한다.

        기간 파라미터 중 가장 긴 것의 2배 + 20일. SMA는 N일이면 되지만 EMA·MACD·ADX는
        N일 뒤에도 초기값의 영향이 남아 두 배쯤 지나야 안정된다. 기간 파라미터는 이름이
        모두 *period 로 끝나므로(param_schema) 이름으로 찾는다.
        """
        periods = [
            float(params.get(p["name"], p["default"]))
            for p in self.param_schema
            if p["name"].endswith("period")
        ]
        return int(max(periods) * 2) + 20 if periods else 0
