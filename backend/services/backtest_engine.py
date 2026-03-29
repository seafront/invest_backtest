import pandas as pd
from services.strategies import get_strategy
from utils.metrics import total_return, sharpe_ratio, max_drawdown, win_rate, cagr


def run_backtest(
    df: pd.DataFrame,
    strategy_name: str,
    params: dict,
    initial_capital: float,
    monthly_contribution: float = 0.0,
    invest_mode: str = "lump_sum",
) -> dict:
    """
    Run a backtest on OHLCV DataFrame with the given strategy.

    invest_mode:
      - "lump_sum": Initial capital only, no monthly additions
      - "dca": Monthly contribution only (initial_capital ignored, first month = monthly_contribution)
    """
    strategy = get_strategy(strategy_name)
    signals = strategy.generate_signals(df, params)
    indicators = strategy.compute_indicators(df, params)

    signal_dates = {s.date: s.action for s in signals}

    if invest_mode == "dca":
        cash = monthly_contribution
        total_invested = monthly_contribution
    else:
        cash = initial_capital
        total_invested = initial_capital

    shares = 0
    buy_price = 0.0
    equity_curve = []
    trades = []
    last_contribution_month = None

    for _, row in df.iterrows():
        d = str(row["date"])
        close = float(row["close"])
        action = signal_dates.get(d, "HOLD")

        # DCA: add monthly contribution
        if invest_mode == "dca":
            date_obj = row["date"]
            current_month = (date_obj.year, date_obj.month)
            if last_contribution_month is None:
                last_contribution_month = current_month
            elif current_month != last_contribution_month:
                cash += monthly_contribution
                total_invested += monthly_contribution
                last_contribution_month = current_month

                # If holding shares, auto-buy with the new contribution
                if shares > 0:
                    new_shares = int(monthly_contribution // close)
                    if new_shares > 0:
                        total_cost = buy_price * shares + close * new_shares
                        shares += new_shares
                        buy_price = total_cost / shares
                        cash -= new_shares * close
                        trades.append({
                            "date": d,
                            "action": "BUY",
                            "price": round(close, 4),
                            "shares": new_shares,
                            "pnl": 0.0,
                        })

        # Strategy signals
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

    equity_values = [e["equity"] for e in equity_curve]
    sell_pnls = [t["pnl"] for t in trades if t["action"] == "SELL"]

    final_equity = equity_values[-1] if equity_values else total_invested
    ret = (final_equity - total_invested) / total_invested * 100 if total_invested > 0 else 0.0
    days = len(equity_values)

    return {
        "total_return": round(ret, 2),
        "cagr": round(cagr(total_invested, final_equity, days), 2),
        "sharpe_ratio": round(sharpe_ratio(equity_values), 4),
        "max_drawdown": round(max_drawdown(equity_values), 2),
        "win_rate": round(win_rate(sell_pnls), 2),
        "total_invested": round(total_invested, 2),
        "equity_curve": equity_curve,
        "trades": trades,
        "indicators": indicators,
    }
