import yfinance as yf
import pandas as pd
from datetime import date
from sqlalchemy.orm import Session
from services.data_fetcher import fetch_and_cache, get_cached_data
from services.backtest_engine import run_backtest
from services.strategies import list_strategies

# Major US stocks pool (large-cap focused)
DEFAULT_POOL = [
    "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "BRK-B",
    "JPM", "V", "UNH", "XOM", "JNJ", "WMT", "PG", "MA", "HD", "COST",
    "ABBV", "KO", "PEP", "MRK", "AVGO", "LLY", "TMO", "ORCL", "CRM",
    "ACN", "MCD", "CSCO", "ABT", "DHR", "ADBE", "NKE", "TXN", "NEE",
    "PM", "UPS", "RTX", "LOW", "QCOM", "INTC", "AMD", "CAT", "GS",
    "BA", "AMGN", "IBM", "GE", "DIS",
]


def screen_by_market_cap(pool: list[str] | None = None, top_n: int = 5) -> list[dict]:
    """
    Step 1: Fetch market cap for each ticker and return top N by market cap.
    """
    tickers = pool or DEFAULT_POOL
    results = []

    # Batch fetch using yfinance
    for ticker in tickers:
        try:
            info = yf.Ticker(ticker).fast_info
            market_cap = getattr(info, "market_cap", None)
            if market_cap and market_cap > 0:
                results.append({
                    "ticker": ticker,
                    "market_cap": market_cap,
                    "market_cap_str": _format_market_cap(market_cap),
                })
        except Exception:
            continue

    # Sort by market cap descending
    results.sort(key=lambda x: x["market_cap"], reverse=True)
    return results[:top_n]


def screen_by_strategy(
    db: Session,
    tickers: list[str],
    start_date: date,
    end_date: date,
    initial_capital: float = 100000.0,
    top_n: int = 2,
) -> dict:
    """
    Step 2: Run all strategies on given tickers, rank by best return, return top N.
    """
    strategies = list_strategies()
    all_results = []

    for ticker in tickers:
        # Ensure data is cached
        try:
            df = get_cached_data(db, ticker, start_date, end_date)
        except ValueError:
            try:
                fetch_and_cache(db, ticker, start_date, end_date)
                df = get_cached_data(db, ticker, start_date, end_date)
            except Exception:
                continue

        if len(df) < 60:  # Not enough data for meaningful backtest
            continue

        for strategy in strategies:
            try:
                result = run_backtest(df, strategy.name, _get_defaults(strategy), initial_capital)
                all_results.append({
                    "ticker": ticker,
                    "strategy_name": strategy.name,
                    "strategy_display": strategy.display_name,
                    "total_return": result["total_return"],
                    "sharpe_ratio": result["sharpe_ratio"],
                    "max_drawdown": result["max_drawdown"],
                    "win_rate": result["win_rate"],
                    "trades_count": len([t for t in result["trades"] if t["action"] == "SELL"]),
                })
            except Exception:
                continue

    # Sort by total_return descending
    all_results.sort(key=lambda x: x["total_return"], reverse=True)

    # Pick top N unique tickers
    seen = set()
    top_picks = []
    for r in all_results:
        if r["ticker"] not in seen:
            seen.add(r["ticker"])
            top_picks.append(r)
        if len(top_picks) >= top_n:
            break

    return {
        "all_results": all_results,
        "top_picks": top_picks,
    }


def _get_defaults(strategy) -> dict:
    """Extract default parameter values from strategy schema."""
    return {p["name"]: p["default"] for p in strategy.param_schema}


def _format_market_cap(value: float) -> str:
    if value >= 1e12:
        return f"${value / 1e12:.2f}T"
    elif value >= 1e9:
        return f"${value / 1e9:.2f}B"
    elif value >= 1e6:
        return f"${value / 1e6:.2f}M"
    return f"${value:,.0f}"
