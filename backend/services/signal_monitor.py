"""워치리스트의 매매 신호를 확인한다. Signals 페이지와 scripts/signal_monitor.py 가 쓴다.

판정은 백테스트와 같은 코드로 한다: 지표 준비 구간을 붙여 generate_signals 를 돌리고,
엔진처럼 비어 있을 때의 BUY 와 보유 중의 SELL 만 매매로 친다. 그래서 여기서 "보유 중"이면
같은 파라미터의 백테스트도 지금 보유 중이다.

일봉뿐이라 판단은 장 마감 뒤 하루 한 번이다. 신호가 난 날의 종가로 계산하므로, 실제로는
다음 거래일 시가 근처에서 사게 된다.
"""
import logging
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, insert
from sqlalchemy.orm import Session

from models import Company, SignalEvent, SignalRun, Stock, Watch
from services.backtest_engine import warmup_days
from services.data_fetcher import fetch_and_cache, get_cached_data
from services.strategies import get_strategy

logger = logging.getLogger(__name__)

# 상태를 다시 짜는 기간. 신호를 처음부터 다시 돌리므로 보유 여부가 이 앞의 매매에 좌우되지 않을
# 만큼 길면 된다(크로스오버 전략은 첫 유효 봉에서 상태를 읽는다).
LOOKBACK_DAYS = 3 * 365

# (시간대, 장 마감, 여유). 마감 직후에는 야후의 마지막 봉이 아직 확정되지 않았을 수 있다.
_MARKETS = {
    "KR": (ZoneInfo("Asia/Seoul"), time(15, 30), timedelta(minutes=30)),
    "US": (ZoneInfo("America/New_York"), time(16, 0), timedelta(minutes=30)),
}


def _market(ticker: str) -> str:
    return "KR" if ticker.upper().endswith((".KS", ".KQ")) else "US"


def last_closed_day(ticker: str, now: datetime | None = None) -> date:
    """그 시장에서 장이 끝난 마지막 평일. 휴장일은 모른다 — 그날은 야후가 봉을 주지 않는다.

    장중에 받으면 야후가 오늘의 미완성 봉을 준다. 캐시는 같은 날짜를 덮어쓰지 않으므로
    (INSERT OR IGNORE) 그 값이 굳어 버린다. 그래서 이 날짜까지만 받는다.
    """
    tz, close, margin = _MARKETS[_market(ticker)]
    local = (now or datetime.now(tz)).astimezone(tz)
    d = local.date()
    if local.time() < (datetime.combine(d, close) + margin).time():
        d -= timedelta(days=1)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


def _last_cached(db: Session, ticker: str) -> date | None:
    return db.query(func.max(Stock.date)).filter(Stock.ticker == ticker).scalar()


def _params(strategy, params: dict) -> dict:
    return {**{p["name"]: p["default"] for p in strategy.param_schema}, **(params or {})}


def _warm(watches: list[Watch]) -> int:
    return max((warmup_days(w.strategy_name, _params(get_strategy(w.strategy_name), w.params)) for w in watches),
               default=0)


def refresh_prices(db: Session, ticker: str, warm_days: int) -> int:
    """장이 끝난 마지막 날까지 시세를 받는다. 새로 저장한 행 수."""
    closed = last_closed_day(ticker)
    last = _last_cached(db, ticker)
    if last and last >= closed:
        return 0
    before = db.query(Stock).filter(Stock.ticker == ticker).count()
    start = last - timedelta(days=7) if last else closed - timedelta(days=LOOKBACK_DAYS + warm_days)
    fetch_and_cache(db, ticker, start, closed + timedelta(days=1))  # 야후의 end 는 그날을 빼고 준다
    return db.query(Stock).filter(Stock.ticker == ticker).count() - before


def transitions(db: Session, watch: Watch) -> tuple[list[dict], dict | None]:
    """실제 매매가 되는 신호(비어 있을 때 BUY, 보유 중 SELL)와 마지막 일봉."""
    strategy = get_strategy(watch.strategy_name)
    params = _params(strategy, watch.params)
    last = _last_cached(db, watch.ticker)
    if last is None:
        raise ValueError(f"{watch.ticker} 시세가 없습니다")
    df = get_cached_data(db, watch.ticker,
                         last - timedelta(days=LOOKBACK_DAYS + warmup_days(strategy.name, params)), last)
    actions = {s.date: s.action for s in strategy.generate_signals(df, params)}
    holding = False
    out = []
    for _, row in df.iterrows():
        d = str(row["date"])
        a = actions.get(d, "HOLD")
        if (a == "BUY" and not holding) or (a == "SELL" and holding):
            holding = a == "BUY"
            out.append({"date": row["date"], "action": a, "price": round(float(row["close"]), 4)})
    tail = df.iloc[-1]
    return out, {"date": tail["date"], "close": round(float(tail["close"]), 4), "bars": df["date"].tolist()}


def status(db: Session, watch: Watch, names: dict[str, str] | None = None) -> dict:
    """페이지 한 줄. 캐시만 읽는다(네트워크 없음)."""
    strategy = get_strategy(watch.strategy_name)
    row = {
        "id": watch.id,
        "ticker": watch.ticker,
        "name": (names or {}).get(watch.ticker),
        "strategy_name": watch.strategy_name,
        "display_name": strategy.display_name,
        "params": _params(strategy, watch.params),
        "backtest_id": watch.backtest_id,
        "created_at": watch.created_at,
        "expected_bar_date": last_closed_day(watch.ticker),
        "last_bar_date": None,
        "last_close": None,
        "position": None,
        "last_signal": None,
        "bars_since": None,
        "since_return": None,
        "is_new": False,
        "error": None,
    }
    try:
        trans, last = transitions(db, watch)
    except Exception as e:  # noqa: BLE001 - 한 줄이 깨져도 페이지는 보여야 한다
        row["error"] = str(e)[:200]
        return row
    row["last_bar_date"] = last["date"]
    row["last_close"] = last["close"]
    row["position"] = "long" if trans and trans[-1]["action"] == "BUY" else "flat"
    if trans:
        sig = trans[-1]
        row["last_signal"] = {"date": sig["date"], "action": sig["action"], "price": sig["price"]}
        bars = last["bars"]
        row["bars_since"] = len(bars) - 1 - bars.index(sig["date"])
        row["since_return"] = round((last["close"] / sig["price"] - 1) * 100, 2) if sig["price"] else None
        row["is_new"] = sig["date"] == last["date"]
    return row


def record(db: Session, watch: Watch) -> int:
    """감시를 시작한 뒤의 매매 신호를 기록에 더한다. 이미 있는 것은 건너뛴다. 새로 더한 수."""
    trans, last = transitions(db, watch)
    rows = [
        {"watch_id": watch.id, "date": t["date"], "action": t["action"], "price": t["price"],
         "seen_bar_date": last["date"], "detected_at": datetime.utcnow()}
        for t in trans
        if watch.baseline_date is None or t["date"] > watch.baseline_date
    ]
    if not rows:
        return 0
    before = db.query(SignalEvent).filter(SignalEvent.watch_id == watch.id).count()
    db.execute(insert(SignalEvent).prefix_with("OR IGNORE"), rows)
    db.commit()
    return db.query(SignalEvent).filter(SignalEvent.watch_id == watch.id).count() - before


def run_check(db: Session, source: str) -> SignalRun:
    """시세를 받고 모든 감시의 신호를 기록한다. 한 종목이 실패해도 나머지는 계속한다."""
    run = SignalRun(source=source, started_at=datetime.utcnow(), failed=[])
    db.add(run)
    db.commit()

    watches = db.query(Watch).all()
    by_ticker: dict[str, list[Watch]] = {}
    for w in watches:
        by_ticker.setdefault(w.ticker, []).append(w)

    failed = []
    new_events = 0
    for ticker, ws in by_ticker.items():
        try:
            refresh_prices(db, ticker, _warm(ws))
        except Exception as e:  # noqa: BLE001
            db.rollback()
            failed.append({"ticker": ticker, "error": f"시세: {str(e)[:150]}"})
            logger.warning("signal monitor: %s 시세 실패: %s", ticker, e)
        for w in ws:
            try:
                new_events += record(db, w)
            except Exception as e:  # noqa: BLE001
                db.rollback()
                failed.append({"ticker": ticker, "error": f"{w.strategy_name}: {str(e)[:150]}"})

    run.tickers = len(by_ticker)
    run.new_events = new_events
    run.failed = failed
    run.finished_at = datetime.utcnow()
    db.commit()
    db.refresh(run)
    return run


def add_watch(db: Session, ticker: str, strategy_name: str, params: dict, backtest_id: int | None) -> Watch:
    """감시를 더한다. 시세가 없으면 받는다. 같은 조합이 이미 있으면 ValueError."""
    ticker = ticker.upper()
    strategy = get_strategy(strategy_name)
    for p in strategy.param_schema:
        v = params.get(p["name"])
        if v is not None and not (p["min"] <= v <= p["max"]):
            raise ValueError(f"{p['name']}은(는) {p['min']}–{p['max']} 범위여야 합니다")
    full = _params(strategy, params)
    for w in db.query(Watch).filter(Watch.ticker == ticker, Watch.strategy_name == strategy_name).all():
        if _params(strategy, w.params) == full:
            raise ValueError("이미 감시 중인 조합입니다")

    watch = Watch(ticker=ticker, strategy_name=strategy_name, params=full, backtest_id=backtest_id)
    refresh_prices(db, ticker, warmup_days(strategy_name, full))
    # 지금 캐시의 마지막 봉에서 난 신호는 기록에 넣는다(추가한 날의 신호를 놓치지 않게). 그 앞은 넣지 않는다.
    bars = [d for (d,) in db.query(Stock.date).filter(Stock.ticker == ticker)
            .order_by(Stock.date.desc()).limit(2).all()]
    if not bars:
        raise ValueError(f"{ticker} 시세를 받지 못했습니다")
    watch.baseline_date = bars[-1] if len(bars) == 2 else None
    db.add(watch)
    db.commit()
    db.refresh(watch)
    record(db, watch)
    return watch


def names_for(db: Session, tickers: list[str]) -> dict[str, str]:
    return {c.ticker: c.name for c in db.query(Company).filter(Company.ticker.in_(tickers)).all()}
