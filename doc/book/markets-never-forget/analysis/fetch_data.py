"""^GSPC / ^SP500TR 장기 시계열을 내려받아 CSV로 저장.

    python fetch_data.py

주의: ^GSPC는 배당이 빠진 가격지수다. 총수익 기준이 필요하면 ^SP500TR을 쓰되
기간이 1988년부터로 짧다.
"""
import os
import pandas as pd
import yfinance as yf

from common import DATA_DIR, csv_path

TICKERS = ["^GSPC", "^SP500TR"]


def fetch(ticker: str) -> pd.DataFrame:
    df = yf.download(ticker, start="1900-01-01", progress=False, auto_adjust=True)
    if df.empty:
        raise SystemExit(f"{ticker}: 데이터를 받지 못했습니다.")

    # yfinance는 MultiIndex 컬럼을 돌려줄 수 있다 (backend/data_fetcher.py와 동일한 처리)
    if isinstance(df.columns, pd.MultiIndex):
        if ticker in df.columns.get_level_values(1):
            df = df.xs(ticker, level=1, axis=1)
        else:
            df.columns = df.columns.get_level_values(0)

    df = df.reset_index()
    df.columns = [c.lower() for c in df.columns]
    return df[["date", "open", "high", "low", "close", "volume"]]


def main() -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    for t in TICKERS:
        df = fetch(t)
        path = csv_path(t)
        df.to_csv(path, index=False)
        print(f"{t:10s} {len(df):>6,}행  "
              f"{df['date'].min().date()} ~ {df['date'].max().date()}  ->  {path}")


if __name__ == "__main__":
    main()
