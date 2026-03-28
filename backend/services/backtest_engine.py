import pandas as pd
from services.strategies import get_strategy
from utils.metrics import total_return, sharpe_ratio, max_drawdown, win_rate


def run_backtest(df: pd.DataFrame, strategy_name: str, params: dict, initial_capital: float) -> dict:
    """
    Run a backtest on OHLCV DataFrame with the given strategy.
    Returns dict with metrics, equity_curve, trades, and indicators.
    """
    strategy = get_strategy(strategy_name)
    signals = strategy.generate_signals(df, params)
    indicators = strategy.compute_indicators(df, params)

    # Align signals with data (signals may be shorter due to indicator warmup)
    signal_dates = {s.date: s.action for s in signals}

    cash = initial_capital
    shares = 0
    buy_price = 0.0
    equity_curve = []
    trades = []

    for _, row in df.iterrows():
        d = str(row["date"])
        close = float(row["close"])
        action = signal_dates.get(d, "HOLD")

        if action == "BUY" and shares == 0:
            shares = int(cash // close)
            if shares > 0:
                buy_price = close
                cash -= shares * close
                trades.append({
                    "date": d,
                    "action": "BUY",
                    "price": round(close, 4),
                    "shares": shares,
                    "pnl": 0.0,
                })

        elif action == "SELL" and shares > 0:
            pnl = (close - buy_price) * shares
            cash += shares * close
            trades.append({
                "date": d,
                "action": "SELL",
                "price": round(close, 4),
                "shares": shares,
                "pnl": round(pnl, 2),
            })
            shares = 0

        equity = cash + shares * close
        equity_curve.append({"date": d, "equity": round(equity, 2)})

    # Extract equity values for metric calculation
    equity_values = [e["equity"] for e in equity_curve]
    sell_pnls = [t["pnl"] for t in trades if t["action"] == "SELL"]

    return {
        "total_return": round(total_return(equity_values), 2),
        "sharpe_ratio": round(sharpe_ratio(equity_values), 4),
        "max_drawdown": round(max_drawdown(equity_values), 2),
        "win_rate": round(win_rate(sell_pnls), 2),
        "equity_curve": equity_curve,
        "trades": trades,
        "indicators": indicators,
    }
