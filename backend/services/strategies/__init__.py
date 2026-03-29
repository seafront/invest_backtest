from .ma_crossover import MACrossover
from .rsi import RSIStrategy
from .bollinger import BollingerBands
from .macd import MACDStrategy
from .golden_cross import GoldenCross
from .stochastic import StochasticOscillator
from .dual_ma_rsi import DualMARSI
from .breakout import BreakoutStrategy
from .vwap import VWAPStrategy
from .buy_and_hold import BuyAndHold
from .ema_crossover import EMACrossover
from .momentum import MomentumROC
from .adx_trend import ADXTrend
from .parabolic_sar import ParabolicSAR
from .keltner import KeltnerChannel

# Registry: add new strategies here
STRATEGY_REGISTRY: dict = {
    "buy_and_hold": BuyAndHold(),
    "golden_cross": GoldenCross(),
    "ma_crossover": MACrossover(),
    "macd": MACDStrategy(),
    "dual_ma_rsi": DualMARSI(),
    "ema_crossover": EMACrossover(),
    "momentum_roc": MomentumROC(),
    "adx_trend": ADXTrend(),
    "parabolic_sar": ParabolicSAR(),
    "keltner": KeltnerChannel(),
    "breakout": BreakoutStrategy(),
    "rsi": RSIStrategy(),
    "bollinger": BollingerBands(),
    "stochastic": StochasticOscillator(),
    "vwap": VWAPStrategy(),
}


def get_strategy(name: str):
    strategy = STRATEGY_REGISTRY.get(name)
    if not strategy:
        raise ValueError(f"Unknown strategy: {name}. Available: {list(STRATEGY_REGISTRY.keys())}")
    return strategy


def list_strategies():
    return list(STRATEGY_REGISTRY.values())
