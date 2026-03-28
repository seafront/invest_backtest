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
