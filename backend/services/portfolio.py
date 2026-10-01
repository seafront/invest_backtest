"""보유 종목 관리. KIS 잔고·체결을 읽어 오고(조회만), 종목마다 청산 규칙을 일봉 종가로 확인한다.

규칙은 넷이다.
- 전략 청산: Signals 와 같은 판정. 연결한 전략이 지금 관망(마지막 매매 신호가 SELL)이면 걸린다.
- 손절: 평균단가 대비 -n% 이하
- 목표: 평균단가 대비 +n% 이상
- 트레일링: 첫 매수 뒤 최고 종가 대비 -n% 이하

판단은 캐시의 일봉 종가로 한다(Signals 와 같은 기준). 화면의 평가금액도 그 종가로 계산하므로
KIS 앱의 실시간 평가와는 장중에 다를 수 있다.
"""
import logging
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from models import AccountSnapshot, Company, Execution, Holding, Stock, Watch
from services import kis_client, signal_monitor
from services.backtest_engine import warmup_days
from services.data_fetcher import get_cached_data, yf_download
from services.strategies import get_strategy

logger = logging.getLogger(__name__)

SEOUL = ZoneInfo("Asia/Seoul")
# 모의투자는 미국 거래소를 하나씩 조회해야 한다(실전은 NASD 가 미국 전체). 실전도 이렇게 부르면 된다.
US_EXCHANGES = ("NASD", "NYSE", "AMEX")
# 국내 일별 체결은 "3개월 이내" TR 로 받는다. 그보다 오래된 보유는 첫 매수일을 직접 넣는다.
EXECUTION_DAYS = 89
# 첫 매수일을 모를 때 트레일링 고점을 찾을 기간
PEAK_FALLBACK_DAYS = 365


def _f(v) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _ymd(v: str) -> date:
    return datetime.strptime(v, "%Y%m%d").date()


def _today() -> date:
    return datetime.now(SEOUL).date()


# --- 티커 ---

def kr_ticker(db: Session, code: str) -> str:
    """KIS 종목코드(6자리) → 야후 티커. 코스피(.KS)인지 코스닥(.KQ)인지 KIS 잔고는 알려 주지 않는다."""
    for suffix in (".KS", ".KQ"):
        t = code + suffix
        if db.query(Company.ticker).filter(Company.ticker == t).first() or \
                db.query(Stock.id).filter(Stock.ticker == t).first():
            return t
    try:
        if not yf_download(code + ".KS", period="5d", progress=False).empty:
            return code + ".KS"
    except Exception:  # noqa: BLE001 - 못 찾으면 코스닥으로 본다
        pass
    return code + ".KQ"


def us_ticker(code: str) -> str:
    """KIS 해외 종목코드 → 야후 티커. 클래스주는 야후가 하이픈을 쓴다(BRK/B, BRK.B → BRK-B)."""
    return code.strip().upper().replace("/", "-").replace(".", "-")


# --- KIS 조회 ---

def _paged(path: str, tr_id: str, params: dict, key: str, ctx: str) -> tuple[list[dict], list[dict]]:
    """연속 조회를 끝까지 돈다. (key 목록 전부, 마지막 output2)."""
    rows: list[dict] = []
    out2: list[dict] = []
    tr_cont = ""
    for _ in range(20):  # 모의는 한 번에 20건. 400건이면 충분하다
        body = kis_client.request(path, tr_id, params, tr_cont=tr_cont)
        part = body.get(key) or []
        rows.extend(part if isinstance(part, list) else [part])
        o2 = body.get("output2")
        if o2:
            out2 = o2 if isinstance(o2, list) else [o2]
        if body.get("_tr_cont") not in ("M", "F"):
            break
        params = {**params, f"CTX_AREA_FK{ctx}": body.get(f"ctx_area_fk{ctx}", ""),
                  f"CTX_AREA_NK{ctx}": body.get(f"ctx_area_nk{ctx}", "")}
        tr_cont = "N"
    return rows, out2


def _tr(real: str) -> str:
    """실전 TR ID → 모의면 V 로 시작하는 ID."""
    return "V" + real[1:] if kis_client.is_paper() else real


def _domestic_balance(cano: str, prod: str):
    return _paged("/uapi/domestic-stock/v1/trading/inquire-balance", _tr("TTTC8434R"), {
        "CANO": cano, "ACNT_PRDT_CD": prod, "AFHR_FLPR_YN": "N", "OFL_YN": "", "INQR_DVSN": "02",
        "UNPR_DVSN": "01", "FUND_STTL_ICLD_YN": "N", "FNCG_AMT_AUTO_RDPT_YN": "N", "PRCS_DVSN": "00",
        "CTX_AREA_FK100": "", "CTX_AREA_NK100": "",
    }, "output1", "100")


def _overseas_balance(cano: str, prod: str, exchange: str):
    return _paged("/uapi/overseas-stock/v1/trading/inquire-balance", _tr("TTTS3012R"), {
        "CANO": cano, "ACNT_PRDT_CD": prod, "OVRS_EXCG_CD": exchange, "TR_CRCY_CD": "USD",
        "CTX_AREA_FK200": "", "CTX_AREA_NK200": "",
    }, "output1", "200")


def _domestic_executions(cano: str, prod: str, start: date, end: date):
    rows, _ = _paged("/uapi/domestic-stock/v1/trading/inquire-daily-ccld", _tr("TTTC0081R"), {
        "CANO": cano, "ACNT_PRDT_CD": prod, "INQR_STRT_DT": start.strftime("%Y%m%d"),
        "INQR_END_DT": end.strftime("%Y%m%d"), "SLL_BUY_DVSN_CD": "00", "PDNO": "", "CCLD_DVSN": "01",
        "INQR_DVSN": "00", "INQR_DVSN_3": "00", "ORD_GNO_BRNO": "", "ODNO": "", "INQR_DVSN_1": "",
        "CTX_AREA_FK100": "", "CTX_AREA_NK100": "", "EXCG_ID_DVSN_CD": "KRX",
    }, "output1", "100")
    return rows


def _overseas_executions(cano: str, prod: str, start: date, end: date):
    rows, _ = _paged("/uapi/overseas-stock/v1/trading/inquire-ccnl", _tr("TTTS3035R"), {
        "CANO": cano, "ACNT_PRDT_CD": prod, "PDNO": "%", "ORD_STRT_DT": start.strftime("%Y%m%d"),
        "ORD_END_DT": end.strftime("%Y%m%d"), "SLL_BUY_DVSN": "00", "CCLD_NCCS_DVSN": "01",
        "OVRS_EXCG_CD": "%", "SORT_SQN": "DS", "ORD_DT": "", "ORD_GNO_BRNO": "", "ODNO": "",
        "CTX_AREA_NK200": "", "CTX_AREA_FK200": "",
    }, "output", "200")
    return rows


def _side(code: str) -> str | None:
    return {"01": "SELL", "02": "BUY"}.get(str(code).strip())


def _store_executions(db: Session, rows: list[dict]) -> None:
    for r in rows:
        exists = db.query(Execution.id).filter(
            Execution.order_no == r["order_no"], Execution.date == r["date"], Execution.ticker == r["ticker"]).first()
        if not exists:
            db.add(Execution(**r))
    db.commit()


def _position_start(db: Session, ticker: str, quantity: float) -> tuple[date | None, float | None]:
    """지금 보유 묶음의 첫 매수(날짜, 가격). 체결을 최근부터 거꾸로 빼 가다 0이 되는 매수다.

    체결 내역이 보유 전체를 덮지 못하면(3개월보다 오래 보유) 0에 닿지 않아 None.
    """
    q = quantity
    for e in db.query(Execution).filter(Execution.ticker == ticker) \
            .order_by(Execution.date.desc(), Execution.id.desc()).all():
        q += -e.quantity if e.side == "BUY" else e.quantity
        if e.side == "BUY" and q <= 1e-9:
            return e.date, e.price
    return None, None


def sync_kis(db: Session) -> dict:
    """KIS 잔고·체결을 읽어 holdings·executions·account_snapshots 를 갱신한다. 주문은 하지 않는다."""
    cano, prod = kis_client.account()
    today = _today()
    seen: set[str] = set()
    errors: list[str] = []

    # 국내
    dom_rows, dom_sum = _domestic_balance(cano, prod)
    dom_holdings = []
    for r in dom_rows:
        qty = _f(r.get("hldg_qty"))
        if qty <= 0:
            continue
        dom_holdings.append({"ticker": kr_ticker(db, str(r.get("pdno", "")).strip()), "name": r.get("prdt_name"),
                             "quantity": qty, "avg_price": _f(r.get("pchs_avg_pric")), "exchange": "KRX"})
    s = dom_sum[0] if dom_sum else {}

    # 해외(미국)
    us_holdings = []
    us_stock = us_pnl = 0.0
    for ex in US_EXCHANGES:
        try:
            rows, _ = _overseas_balance(cano, prod, ex)
        except kis_client.KisError as e:
            errors.append(f"해외잔고 {ex}: {e}")
            continue
        for r in rows:
            qty = _f(r.get("ovrs_cblc_qty"))
            if qty <= 0:
                continue
            us_stock += _f(r.get("ovrs_stck_evlu_amt"))
            us_pnl += _f(r.get("frcr_evlu_pfls_amt"))
            us_holdings.append({"ticker": us_ticker(str(r.get("ovrs_pdno", ""))), "name": r.get("ovrs_item_name"),
                                "quantity": qty, "avg_price": _f(r.get("pchs_avg_pric")),
                                "exchange": r.get("ovrs_excg_cd") or ex})

    # 체결 — 첫 매수일을 찾는 데 쓴다. 실패해도 잔고는 저장한다.
    start = today - timedelta(days=EXECUTION_DAYS)
    execs = []
    try:
        for r in _domestic_executions(cano, prod, start, today):
            side, qty = _side(r.get("sll_buy_dvsn_cd")), _f(r.get("tot_ccld_qty"))
            if side and qty > 0 and r.get("ord_dt"):
                execs.append({"ticker": kr_ticker(db, str(r.get("pdno", "")).strip()), "date": _ymd(r["ord_dt"]),
                              "side": side, "quantity": qty, "price": _f(r.get("avg_prvs")),
                              "order_no": str(r.get("odno", ""))})
    except kis_client.KisError as e:
        errors.append(f"국내체결: {e}")
    try:
        for r in _overseas_executions(cano, prod, start, today):
            side, qty = _side(r.get("sll_buy_dvsn_cd")), _f(r.get("ft_ccld_qty"))
            if side and qty > 0 and r.get("ord_dt"):
                execs.append({"ticker": us_ticker(str(r.get("pdno", ""))), "date": _ymd(r["ord_dt"]), "side": side,
                              "quantity": qty, "price": _f(r.get("ft_ccld_unpr3")),
                              "order_no": str(r.get("odno", ""))})
    except kis_client.KisError as e:
        errors.append(f"해외체결: {e}")
    _store_executions(db, execs)

    for h in dom_holdings + us_holdings:
        seen.add(h["ticker"])
        row = db.query(Holding).filter(Holding.source == "kis", Holding.ticker == h["ticker"]).first()
        if row is None:
            row = Holding(source="kis", ticker=h["ticker"])
            db.add(row)
        changed = not row.active or row.quantity != h["quantity"]
        row.name, row.quantity, row.avg_price, row.exchange = h["name"], h["quantity"], h["avg_price"], h["exchange"]
        row.active = True
        if changed or row.first_buy_date is None:
            d, p = _position_start(db, h["ticker"], h["quantity"])
            if d:  # 못 찾았으면 직접 넣은 값을 지우지 않는다
                row.first_buy_date, row.first_buy_price = d, p
        row.updated_at = datetime.utcnow()
    # 잔고에서 빠진 종목은 다 판 것이다. 규칙은 남겨 두어 다시 사면 이어서 쓴다.
    for row in db.query(Holding).filter(Holding.source == "kis", Holding.active.is_(True)).all():
        if row.ticker not in seen:
            row.active, row.quantity, row.first_buy_date, row.first_buy_price = False, 0, None, None
    db.commit()

    snap = db.query(AccountSnapshot).filter(AccountSnapshot.date == today,
                                            AccountSnapshot.env == ("paper" if kis_client.is_paper() else "real")).first()
    if snap is None:
        snap = AccountSnapshot(date=today, env="paper" if kis_client.is_paper() else "real")
        db.add(snap)
    snap.cash_krw = _f(s.get("dnca_tot_amt"))
    snap.stock_krw = _f(s.get("scts_evlu_amt"))
    snap.total_krw = _f(s.get("tot_evlu_amt"))
    snap.pnl_krw = _f(s.get("evlu_pfls_smtl_amt"))
    snap.stock_usd, snap.pnl_usd = round(us_stock, 2), round(us_pnl, 2)
    snap.taken_at = datetime.utcnow()
    db.commit()

    refresh_errors = refresh_prices(db)
    return {"domestic": len(dom_holdings), "overseas": len(us_holdings), "executions": len(execs),
            "errors": errors + refresh_errors}


def refresh_prices(db: Session) -> list[str]:
    """보유 종목·목표 비중 종목의 일봉과 USD/KRW 환율을 장이 끝난 날까지 받는다."""
    from models import TargetWeight
    from services.portfolio_view import FX_TICKER

    errors = []
    held = {h.ticker for h in db.query(Holding).filter(Holding.active.is_(True)).all()}
    for t in [FX_TICKER] + [x.ticker for x in db.query(TargetWeight).all() if x.ticker not in held]:
        try:
            signal_monitor.refresh_prices(db, t, 0)
        except Exception as e:  # noqa: BLE001
            db.rollback()
            errors.append(f"{t} 시세: {str(e)[:120]}")
    for h in db.query(Holding).filter(Holding.active.is_(True)).all():
        warm = warmup_days(h.strategy_name, signal_monitor._params(get_strategy(h.strategy_name), h.params or {})) \
            if h.strategy_name else 0
        try:
            signal_monitor.refresh_prices(db, h.ticker, max(warm, PEAK_FALLBACK_DAYS))
        except Exception as e:  # noqa: BLE001 - 한 종목이 실패해도 나머지는 받는다
            db.rollback()
            errors.append(f"{h.ticker} 시세: {str(e)[:120]}")
    return errors


# --- 규칙 확인 ---

def _weekdays_between(a: date, b: date) -> int:
    n, d = 0, a
    step = 1 if b >= a else -1
    while d != b:
        d += timedelta(days=step)
        if d.weekday() < 5:
            n += step
    return n


def status(db: Session, h: Holding) -> dict:
    """보유 종목 한 줄: 평가, 규칙별 상태, 실제 vs 전략 진입. 캐시만 읽는다."""
    row = {
        "id": h.id, "source": h.source, "ticker": h.ticker, "name": h.name, "quantity": h.quantity,
        "avg_price": h.avg_price, "exchange": h.exchange, "active": h.active,
        "first_buy_date": h.first_buy_date, "first_buy_price": h.first_buy_price,
        "strategy_name": h.strategy_name, "display_name": None, "params": h.params, "backtest_id": h.backtest_id,
        "stop_loss_pct": h.stop_loss_pct, "target_pct": h.target_pct, "trailing_pct": h.trailing_pct,
        "last_bar_date": None, "last_close": None, "market_value": None, "pnl": None, "pnl_pct": None,
        "peak_close": None, "rules": [], "triggered": False, "comparison": None, "error": None,
    }
    if not h.active or h.quantity <= 0:
        return row
    try:
        start = h.first_buy_date or (_today() - timedelta(days=PEAK_FALLBACK_DAYS))
        df = get_cached_data(db, h.ticker, start)
    except ValueError as e:
        row["error"] = str(e)
        return row
    close = round(float(df.iloc[-1]["close"]), 4)
    row["last_bar_date"] = df.iloc[-1]["date"]
    row["last_close"] = close
    row["market_value"] = round(close * h.quantity, 2)
    if h.avg_price:
        row["pnl"] = round((close - h.avg_price) * h.quantity, 2)
        row["pnl_pct"] = round((close / h.avg_price - 1) * 100, 2)
    peak = float(df["close"].max())
    row["peak_close"] = round(peak, 4) if h.first_buy_date else None

    rules = []
    if h.stop_loss_pct and h.avg_price:
        line = h.avg_price * (1 - h.stop_loss_pct / 100)
        rules.append({"kind": "stop", "label": f"손절 -{h.stop_loss_pct:g}%", "line": round(line, 4),
                      "triggered": close <= line, "distance_pct": round((close / line - 1) * 100, 2),
                      "note": "평균단가 기준"})
    if h.target_pct and h.avg_price:
        line = h.avg_price * (1 + h.target_pct / 100)
        rules.append({"kind": "target", "label": f"목표 +{h.target_pct:g}%", "line": round(line, 4),
                      "triggered": close >= line, "distance_pct": round((line / close - 1) * 100, 2),
                      "note": "평균단가 기준"})
    if h.trailing_pct:
        # 고점은 첫 매수 뒤에서만 찾는다. 첫 매수일을 모르면 사기 전 고점과 비교하게 되어 엉뚱하게 걸린다.
        if h.first_buy_date:
            line = peak * (1 - h.trailing_pct / 100)
            rules.append({"kind": "trailing", "label": f"트레일링 -{h.trailing_pct:g}%", "line": round(line, 4),
                          "triggered": close <= line, "distance_pct": round((close / line - 1) * 100, 2),
                          "note": f"{h.first_buy_date.isoformat()} 이후 최고 종가 {round(peak, 4):g} 기준"})
        else:
            rules.append({"kind": "trailing", "label": f"트레일링 -{h.trailing_pct:g}%", "line": None,
                          "triggered": False, "distance_pct": None, "note": "첫 매수일을 넣어야 계산합니다"})
    if h.strategy_name:
        try:
            strategy = get_strategy(h.strategy_name)
            row["display_name"] = strategy.display_name
            watch = Watch(ticker=h.ticker, strategy_name=h.strategy_name, params=h.params or {})
            trans, last = signal_monitor.transitions(db, watch)
            sig = trans[-1] if trans else None
            flat = not sig or sig["action"] == "SELL"
            rules.append({
                "kind": "strategy", "label": "전략 청산", "line": None, "triggered": flat, "distance_pct": None,
                "note": (f"{sig['date']} SELL — 전략은 관망 중" if sig and flat
                         else f"{sig['date']} BUY 이후 보유 유지" if sig else "아직 매수 신호가 없음"),
                "signal_date": sig["date"] if sig else None,
                "is_new": bool(sig and sig["date"] == last["date"]),
            })
            row["comparison"] = _compare(h, trans)
        except Exception as e:  # noqa: BLE001
            rules.append({"kind": "strategy", "label": "전략 청산", "line": None, "triggered": False,
                          "distance_pct": None, "note": f"판정 실패: {str(e)[:120]}"})
    row["rules"] = rules
    row["triggered"] = any(r["triggered"] for r in rules)
    return row


def _compare(h: Holding, trans: list[dict]) -> dict | None:
    """실제 첫 매수 vs 전략의 진입. 같은 보유 묶음을 연 전략 BUY 와 비교한다."""
    if not h.first_buy_date:
        return None
    before = [t for t in trans if t["date"] <= h.first_buy_date]
    actual = h.first_buy_price or h.avg_price
    if not before or before[-1]["action"] != "BUY":
        # 실제로 산 날 전략은 관망 중이었다. 그 뒤 처음 BUY 가 있으면 함께 보여 준다.
        after = next((t for t in trans if t["date"] > h.first_buy_date and t["action"] == "BUY"), None)
        return {"strategy_holding": False, "strategy_date": after["date"] if after else None,
                "strategy_price": after["price"] if after else None, "actual_date": h.first_buy_date,
                "actual_price": actual, "price_diff_pct": None, "days_late": None}
    b = before[-1]
    return {"strategy_holding": True, "strategy_date": b["date"], "strategy_price": b["price"],
            "actual_date": h.first_buy_date, "actual_price": actual,
            "price_diff_pct": round((actual / b["price"] - 1) * 100, 2) if b["price"] else None,
            "days_late": _weekdays_between(b["date"], h.first_buy_date)}


def add_manual(db: Session, ticker: str, quantity: float, avg_price: float,
               first_buy_date: date | None) -> Holding:
    ticker = ticker.strip().upper()
    if quantity <= 0 or avg_price <= 0:
        raise ValueError("수량과 평균단가는 0보다 커야 합니다")
    if db.query(Holding).filter(Holding.source == "manual", Holding.ticker == ticker).first():
        raise ValueError("이미 직접 입력한 종목입니다 — 표에서 고치세요")
    h = Holding(source="manual", ticker=ticker, quantity=quantity, avg_price=avg_price,
                first_buy_date=first_buy_date, first_buy_price=avg_price if first_buy_date else None, active=True)
    signal_monitor.refresh_prices(db, ticker, PEAK_FALLBACK_DAYS)  # 없는 티커면 여기서 ValueError
    h.name = db.query(Company.name).filter(Company.ticker == ticker).scalar()
    db.add(h)
    db.commit()
    db.refresh(h)
    return h
