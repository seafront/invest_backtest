"""포트폴리오 전체 관점: 자산 현황·비중, 목표 비중과 리밸런싱, 위험 분석, 매수·매도 시점 가이드.

모두 캐시의 일봉 종가로 계산한다(보유 종목 화면과 같은 기준). 달러 보유분은 USD/KRW(야후 KRW=X)
종가로 원화로 바꿔 합친다. 주문은 하지 않는다 — 리밸런싱과 가이드는 "몇 주", "얼마면"까지만 알려 준다.
"""
import math
from datetime import date, timedelta

import numpy as np
import pandas as pd
from sqlalchemy.orm import Session

from models import AccountSnapshot, Company, Holding, TargetWeight, Watch
from services import kis_client, signal_monitor
from services.data_fetcher import get_cached_data
from services.strategies import get_strategy

FX_TICKER = "KRW=X"  # 1달러당 원
CASH = "CASH"
RISK_DAYS = 365
# 한 종목·한 섹터 쏠림, 너무 비슷하게 움직이는 쌍
WARN_HOLDING = 25.0
WARN_SECTOR = 40.0
WARN_CORR = 0.8
# 시점 가이드: 내일 종가를 지금 ±GUIDE_RANGE% 안에서 바꿔 본다
GUIDE_RANGE = 20.0
GUIDE_STEP = 1.0


def _is_kr(ticker: str) -> bool:
    return ticker.upper().endswith((".KS", ".KQ"))


def _last_close(db: Session, ticker: str) -> tuple[float, date] | None:
    try:
        df = get_cached_data(db, ticker, date.today() - timedelta(days=20))
    except ValueError:
        return None
    return float(df.iloc[-1]["close"]), df.iloc[-1]["date"]


def fx(db: Session, refresh: bool = False) -> tuple[float, date] | None:
    """USD/KRW 종가."""
    if refresh:
        try:
            signal_monitor.refresh_prices(db, FX_TICKER, 0)
        except Exception:  # noqa: BLE001 - 못 받으면 캐시에 있는 값을 쓴다
            db.rollback()
    return _last_close(db, FX_TICKER)


def _cash_krw(db: Session) -> float:
    env = "paper" if kis_client.is_paper() else "real"
    snap = db.query(AccountSnapshot).filter(AccountSnapshot.env == env).order_by(AccountSnapshot.date.desc()).first()
    return snap.cash_krw if snap else 0.0


def _meta(db: Session, tickers: list[str]) -> dict[str, Company]:
    return {c.ticker: c for c in db.query(Company).filter(Company.ticker.in_(tickers)).all()}


# --- 자산 현황 · 목표 비중 · 리밸런싱 ---

def allocation(db: Session, band: float) -> dict:
    rate = fx(db)
    usd = rate[0] if rate else None
    holdings = [h for h in db.query(Holding).filter(Holding.active.is_(True)).all() if h.quantity > 0]
    # 같은 종목을 KIS와 직접 입력에 나눠 가졌으면 합친다
    by_ticker: dict[str, dict] = {}
    for h in holdings:
        row = by_ticker.setdefault(h.ticker, {"ticker": h.ticker, "name": h.name, "quantity": 0.0})
        row["quantity"] += h.quantity
        row["name"] = row["name"] or h.name
    targets = {t.ticker: t.weight for t in db.query(TargetWeight).all()}
    for t in targets:
        by_ticker.setdefault(t, {"ticker": t, "name": None, "quantity": 0.0})
    meta = _meta(db, list(by_ticker))

    rows, missing = [], []
    for t, row in by_ticker.items():
        last = _last_close(db, t)
        kr = _is_kr(t)
        if last is None or (not kr and usd is None):
            missing.append(t)
            continue
        price, on = last
        to_krw = 1.0 if kr else usd
        c = meta.get(t)
        rows.append({
            **row, "name": row["name"] or (c.name if c else None),
            "country": "KR" if kr else "US", "currency": "KRW" if kr else "USD",
            "sector": (c.sector if c and c.sector else "미분류"),
            "price": round(price, 4), "price_date": on, "price_krw": price * to_krw,
            "value_krw": round(row["quantity"] * price * to_krw, 0),
        })

    cash = _cash_krw(db)
    invested = sum(r["value_krw"] for r in rows)
    total = invested + cash
    target_sum = sum(targets.values())
    for r in rows:
        r["weight"] = round(r["value_krw"] / total * 100, 2) if total else 0.0
        tgt = targets.get(r["ticker"])
        r["target"] = tgt
        r["drift"] = round(r["weight"] - tgt, 2) if tgt is not None else None
        r["action"] = None
        if tgt is not None and total and abs(r["drift"]) > band:
            diff = total * tgt / 100 - r["value_krw"]
            shares = math.floor(abs(diff) / r["price_krw"]) if r["price_krw"] else 0
            if shares > 0:
                r["action"] = {"side": "BUY" if diff > 0 else "SELL", "shares": shares,
                               "amount_krw": round(shares * r["price_krw"], 0)}
        del r["price_krw"]
    rows.sort(key=lambda r: -r["value_krw"])

    def group(key: str) -> list[dict]:
        out: dict[str, float] = {}
        for r in rows:
            out[r[key]] = out.get(r[key], 0) + r["value_krw"]
        if cash:
            out["현금"] = out.get("현금", 0) + cash
        return [{"name": k, "value_krw": round(v, 0), "weight": round(v / total * 100, 2) if total else 0}
                for k, v in sorted(out.items(), key=lambda kv: -kv[1])]

    cash_weight = round(cash / total * 100, 2) if total else 0.0
    cash_target = round(100 - target_sum, 2) if targets else None
    warnings = [f"{r['ticker']} 비중 {r['weight']:.1f}% — 한 종목이 {WARN_HOLDING:g}%를 넘음"
                for r in rows if r["weight"] > WARN_HOLDING]
    warnings += [f"{g['name']} 섹터 {g['weight']:.1f}% — {WARN_SECTOR:g}%를 넘음"
                 for g in group("sector") if g["name"] != "현금" and g["weight"] > WARN_SECTOR]
    if missing:
        warnings.append(f"시세가 없어 뺀 종목: {', '.join(missing)}")
    return {
        "fx_rate": usd, "fx_date": rate[1] if rate else None,
        "total_krw": round(total, 0), "invested_krw": round(invested, 0), "cash_krw": round(cash, 0),
        "cash_weight": cash_weight, "cash_target": cash_target,
        "cash_drift": round(cash_weight - cash_target, 2) if cash_target is not None else None,
        "band": band, "holdings": rows,
        "by_sector": group("sector"), "by_country": group("country"), "by_currency": group("currency"),
        "warnings": warnings,
    }


def save_targets(db: Session, items: list[dict]) -> None:
    """목표 비중을 통째로 바꾼다. 처음 보는 종목은 시세를 받아 둔다(리밸런싱 수량 계산용)."""
    seen = set()
    for it in items:
        t = it["ticker"].strip().upper()
        if t in seen:
            raise ValueError(f"{t}가 두 번 들어 있습니다")
        if t == CASH:
            raise ValueError("현금은 적지 않습니다 — 나머지가 현금 목표입니다")
        seen.add(t)
    if sum(it["weight"] for it in items) > 100 + 1e-9:
        raise ValueError("목표 비중의 합이 100%를 넘습니다")
    for t in seen:
        signal_monitor.refresh_prices(db, t, 0)  # 없는 티커면 ValueError
    db.query(TargetWeight).delete()
    for it in items:
        if it["weight"] > 0:
            db.add(TargetWeight(ticker=it["ticker"].strip().upper(), weight=it["weight"]))
    db.commit()
    fx(db, refresh=True)


# --- 위험 분석 ---

def risk(db: Session) -> dict:
    """지금 비중을 지난 1년에 그대로 들고 있었다면의 변동성·낙폭과 종목 간 상관관계.

    비중을 고정한 근사다(매일 리밸런싱한 것과 같다). 실제 계좌의 과거 수익률이 아니다.
    """
    alloc = allocation(db, band=0)
    rows = [r for r in alloc["holdings"] if r["value_krw"] > 0]
    if not rows:
        return {"available": False, "reason": "보유 종목이 없습니다"}
    start = date.today() - timedelta(days=RISK_DAYS + 10)
    closes = {}
    for r in rows:
        try:
            df = get_cached_data(db, r["ticker"], start)
        except ValueError:
            continue
        closes[r["ticker"]] = df.set_index("date")["close"]
    fx_series = None
    if any(not _is_kr(t) for t in closes):
        try:
            fx_series = get_cached_data(db, FX_TICKER, start).set_index("date")["close"]
        except ValueError:
            return {"available": False, "reason": "환율(KRW=X) 시세가 없습니다 — 목표 비중을 저장하거나 동기화하면 받습니다"}
    prices = pd.DataFrame(closes).sort_index()
    prices.index = pd.to_datetime(prices.index)
    # 한국·미국 휴장일이 달라 하루가 비면 전날 종가로 채운다(그날 수익률 0)
    prices = prices.ffill()
    if fx_series is not None:
        fx_series.index = pd.to_datetime(fx_series.index)
        fxa = fx_series.reindex(prices.index).ffill().bfill()
        for t in prices.columns:
            if not _is_kr(t):
                prices[t] = prices[t] * fxa
    rets = prices.pct_change().dropna(how="all").fillna(0)
    if len(rets) < 40:
        return {"available": False, "reason": "1년 시세가 부족합니다"}
    invested = sum(r["value_krw"] for r in rows if r["ticker"] in rets.columns)
    w = pd.Series({r["ticker"]: r["value_krw"] / invested for r in rows if r["ticker"] in rets.columns})
    port = rets[w.index] @ w
    curve = (1 + port).cumprod()
    mdd = float(((curve / curve.cummax()) - 1).min() * -100)
    # 변동성·상관은 주간 수익률로 잰다. 한국장이 미국장보다 먼저 닫혀 같은 날짜의 일간 수익률은
    # 서로 다른 뉴스를 반영한다 — 일간으로 재면 한·미 종목 간 상관이 실제보다 낮게(음수로까지) 나온다.
    weekly = prices[w.index].resample("W-FRI").last().pct_change().dropna(how="all").fillna(0)
    weekly_port = weekly @ w
    vol = float(weekly_port.std() * np.sqrt(52) * 100)
    cov = weekly.cov()
    var_p = float(w @ cov @ w)
    contrib = (w * (cov @ w)) / var_p * 100 if var_p > 0 else w * 0
    corr = weekly.corr().round(2)
    tickers = list(w.index)
    pairs = [(a, b, float(corr.loc[a, b])) for i, a in enumerate(tickers) for b in tickers[i + 1:]]
    warnings = [f"{a} · {b} 상관계수 {c:.2f} — 거의 같이 움직임" for a, b, c in pairs if c > WARN_CORR]
    return {
        "available": True, "reason": None,
        "start": rets.index[0].date(), "end": rets.index[-1].date(), "days": len(rets),
        "volatility": round(vol, 2), "max_drawdown": round(mdd, 2),
        "effective_n": round(float(1 / (w ** 2).sum()), 2), "holdings_n": len(w),
        "holdings": [{"ticker": t, "weight": round(float(w[t]) * 100, 2),
                      "volatility": round(float(weekly[t].std() * np.sqrt(52) * 100), 2),
                      "risk_contribution": round(float(contrib[t]), 2)} for t in tickers],
        "tickers": tickers, "correlation": corr.values.tolist(),
        "warnings": warnings,
    }


# --- 매수·매도 시점 가이드 ---

def _strategy_for(db: Session, ticker: str, holding: Holding | None) -> tuple[str, dict, str] | None:
    """(전략, 파라미터, 출처). 보유 종목 설정이 먼저, 없으면 Signals 워치리스트."""
    if holding and holding.strategy_name:
        return holding.strategy_name, holding.params or {}, "보유 종목 설정"
    w = db.query(Watch).filter(Watch.ticker == ticker).order_by(Watch.created_at).first()
    if w:
        return w.strategy_name, w.params or {}, "워치리스트"
    return None


def _next_bar_signal(strategy, params: dict, df: pd.DataFrame, close: float) -> str:
    """df 끝에 종가 close 인 가상의 다음 봉을 붙였을 때 그 봉의 신호."""
    last = df.iloc[-1]
    nxt = pd.Timestamp(last["date"]) + pd.offsets.BDay(1)
    o = float(last["close"])
    bar = {"date": nxt.date(), "open": o, "high": max(o, close), "low": min(o, close), "close": close,
           "volume": float(df["volume"].tail(20).median())}
    frame = pd.concat([df, pd.DataFrame([bar])], ignore_index=True)
    key = str(bar["date"])
    for s in strategy.generate_signals(frame, params):
        if s.date == key:
            return s.action
    return "HOLD"


def trigger_ranges(strategy, params: dict, df: pd.DataFrame, want: str) -> list[dict]:
    """내일 종가를 지금 ±GUIDE_RANGE% 안에서 바꿔 볼 때 want(BUY/SELL) 신호가 나는 구간들.

    굵은 격자로 훑고 경계는 이분법으로 좁힌다. 신호가 가격에 따라 단조롭지 않은 전략도 있어
    (RSI 같은 역추세는 내려야 BUY) 구간을 여러 개 돌려줄 수 있다.
    """
    base = float(df.iloc[-1]["close"])
    steps = int(GUIDE_RANGE / GUIDE_STEP)
    grid = [base * (1 + k * GUIDE_STEP / 100) for k in range(-steps, steps + 1)]
    hits = [_next_bar_signal(strategy, params, df, p) == want for p in grid]

    def edge(lo: float, hi: float, lo_hit: bool) -> float:
        for _ in range(8):
            mid = (lo + hi) / 2
            if (_next_bar_signal(strategy, params, df, mid) == want) == lo_hit:
                lo = mid
            else:
                hi = mid
        return hi if not lo_hit else lo

    ranges, i = [], 0
    while i < len(grid):
        if not hits[i]:
            i += 1
            continue
        j = i
        while j + 1 < len(grid) and hits[j + 1]:
            j += 1
        low = grid[i] if i == 0 else edge(grid[i - 1], grid[i], False)
        high = grid[j] if j == len(grid) - 1 else edge(grid[j], grid[j + 1], True)
        ranges.append({"low": round(low, 4), "high": round(high, 4),
                       "low_pct": round((low / base - 1) * 100, 2), "high_pct": round((high / base - 1) * 100, 2),
                       "open_low": i == 0, "open_high": j == len(grid) - 1})
        i = j + 1
    return ranges


def guide(db: Session) -> list[dict]:
    """보유 종목과 목표 비중 종목마다: 전략 상태, 마지막 신호, 내일 어느 종가면 다음 신호가 나는지."""
    holdings = {h.ticker: h for h in db.query(Holding).filter(Holding.active.is_(True)).all() if h.quantity > 0}
    tickers = list(dict.fromkeys(list(holdings) + [t.ticker for t in db.query(TargetWeight).all()]))
    out = []
    for t in tickers:
        h = holdings.get(t)
        row = {"ticker": t, "held": h is not None, "strategy_name": None, "display_name": None, "params": None,
               "source": None, "position": None, "last_signal": None, "last_close": None, "last_bar_date": None,
               "next_action": None, "ranges": [], "mismatch": None, "error": None}
        found = _strategy_for(db, t, h)
        if not found:
            out.append(row)
            continue
        name, params, source = found
        try:
            strategy = get_strategy(name)
            full = signal_monitor._params(strategy, params)
            row.update(strategy_name=name, display_name=strategy.display_name, params=full, source=source)
            trans, last = signal_monitor.transitions(db, Watch(ticker=t, strategy_name=name, params=full))
            long = bool(trans) and trans[-1]["action"] == "BUY"
            row["position"] = "long" if long else "flat"
            if trans:
                row["last_signal"] = {k: trans[-1][k] for k in ("date", "action", "price")}
            row["last_close"], row["last_bar_date"] = last["close"], last["date"]
            # 가상의 봉을 붙여 수십 번 돌리므로 필요한 만큼만 자른다(지표 준비 구간의 3배 + 여유)
            bars = strategy.warmup_bars(full) * 3 + 120
            df = get_cached_data(db, t, last["date"] - timedelta(days=int(bars * 365 / 252) + 30))
            row["next_action"] = "SELL" if long else "BUY"
            row["ranges"] = trigger_ranges(strategy, full, df, row["next_action"])
            if h and not long:
                row["mismatch"] = "보유 중인데 전략은 관망 상태"
            elif not h and long:
                row["mismatch"] = "전략은 보유 상태인데 갖고 있지 않음"
        except Exception as e:  # noqa: BLE001 - 한 종목이 깨져도 나머지는 보인다
            row["error"] = str(e)[:200]
        out.append(row)
    return out
