from .ma_crossover import MACrossover
from .rsi import RSIStrategy
from .bollinger import BollingerBands
from .macd import MACDStrategy
from .golden_cross import GoldenCross
from .stochastic import StochasticOscillator
from .dual_ma_rsi import DualMARSI
from .breakout import BreakoutStrategy
from .vwap import VWAPStrategy

# Registry: add new strategies here
STRATEGY_REGISTRY: dict = {
    "ma_crossover": MACrossover(),
    "rsi": RSIStrategy(),
    "bollinger": BollingerBands(),
    "macd": MACDStrategy(),
    "golden_cross": GoldenCross(),
    "stochastic": StochasticOscillator(),
    "dual_ma_rsi": DualMARSI(),
    "breakout": BreakoutStrategy(),
    "vwap": VWAPStrategy(),
}


def get_strategy(name: str):
    strategy = STRATEGY_REGISTRY.get(name)
    if not strategy:
        raise ValueError(f"Unknown strategy: {name}. Available: {list(STRATEGY_REGISTRY.keys())}")
    return strategy


def list_strategies():
    return list(STRATEGY_REGISTRY.values())
