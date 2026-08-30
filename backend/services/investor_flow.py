"""투자자 매매동향 수집·조회.

KIS API는 한 번에 30거래일만 준다. 종료일을 앞으로 옮기며 반복 호출해 누적한다.
받아 둔 구간은 다시 받지 않는다 — 유량 제한이 있어 호출 한 번이 아깝다.
"""
from datetime import date, datetime, timedelta

from sqlalchemy import func, insert
from sqlalchemy.orm import Session

from models import InvestorFlow
from services import kis_client

WINDOW = 30  # API가 한 번에 주는 거래일 수

# 시세와 같은 구간을 담는다. 화면에서 "시세는 5년인데 수급은 3개월"처럼 갈리면
# 어느 쪽이 기준인지 알 수 없다. KIS는 6년 전까지 돌려주므로 5년은 받아진다.
#
# 대신 처음 채울 때가 비싸다. 시세 5년치는 199종목에 40초인데 수급은 2시간 40분이다 —
# 한 번에 30거래일씩만 주고 호출 사이에 0.6초를 쉬어야 해서, 종목당 42회가 필요하다.
# 이미 채운 구간을 만나면 즉시 멈추므로 두 번째부터는 종목당 1회로 끝난다.
DEFAULT_MONTHS = 60

# API 필드 → 컬럼. 이름이 규칙적이라 표로 두면 오타를 눈으로 잡을 수 있다.
FIELDS = {
    "close": "stck_clpr", "volume": "acml_vol",
    "prsn_ntby_qty": "prsn_ntby_qty", "prsn_ntby_amt": "prsn_ntby_tr_pbmn",
    "prsn_buy_qty": "prsn_shnu_vol", "prsn_sell_qty": "prsn_seln_vol",
    "frgn_ntby_qty": "frgn_ntby_qty", "frgn_ntby_amt": "frgn_ntby_tr_pbmn",
    "frgn_buy_qty": "frgn_shnu_vol", "frgn_sell_qty": "frgn_seln_vol",
    "orgn_ntby_qty": "orgn_ntby_qty", "orgn_ntby_amt": "orgn_ntby_tr_pbmn",
    "orgn_buy_qty": "orgn_shnu_vol", "orgn_sell_qty": "orgn_seln_vol",
    "fund_ntby_qty": "fund_ntby_qty", "ivtr_ntby_qty": "ivtr_ntby_qty",
    "pe_fund_ntby_qty": "pe_fund_ntby_vol", "scrt_ntby_qty": "scrt_ntby_qty",
    "bank_ntby_qty": "bank_ntby_qty", "insu_ntby_qty": "insu_ntby_qty",
    "etc_corp_ntby_qty": "etc_corp_ntby_vol",
}
QTY_COLUMNS = {c for c in FIELDS if c.endswith("_qty") or c == "volume"}


def to_kis_code(ticker: str) -> str:
    """005930.KS → 005930. KIS는 접미사 없이 6자리 코드를 쓴다."""
    return ticker.split(".")[0]


def is_korean(ticker: str) -> bool:
    return ticker.upper().endswith((".KS", ".KQ"))


def _num(raw, integer: bool):
    if raw in (None, "", "-"):
        return None
    try:
        value = float(str(raw).replace(",", ""))
    except ValueError:
        return None
    return int(value) if integer else value


def _row(ticker: str, item: dict) -> dict | None:
    raw_date = item.get("stck_bsop_date")
    if not raw_date:
        return None
    row = {"ticker": ticker, "date": datetime.strptime(raw_date, "%Y%m%d").date()}
    for column, field in FIELDS.items():
        row[column] = _num(item.get(field), column in QTY_COLUMNS)
    return row


def sync(db: Session, ticker: str, months: int = DEFAULT_MONTHS) -> dict:
    """months 개월치를 채운다. 이미 있는 날짜는 건너뛴다."""
    if not is_korean(ticker):
        raise ValueError(f"{ticker}: 투자자 매매동향은 한국 종목에만 제공됩니다")

    code = to_kis_code(ticker)
    oldest_wanted = date.today() - timedelta(days=months * 31)
    end = date.today()
    added, calls = 0, 0

    while end > oldest_wanted:
        items = kis_client.investor_flow_daily(code, end.strftime("%Y%m%d"))
        calls += 1
        rows = [r for r in (_row(ticker, i) for i in items) if r]
        if not rows:
            break

        have = {d for (d,) in db.query(InvestorFlow.date).filter(
            InvestorFlow.ticker == ticker,
            InvestorFlow.date.in_([r["date"] for r in rows]),
        ).all()}
        fresh = [r for r in rows if r["date"] not in have]
        if fresh:
            db.execute(insert(InvestorFlow).prefix_with("OR IGNORE"), fresh)
            db.commit()
            added += len(fresh)

        # 이번 창이 전부 이미 있던 날짜이고 목표 구간까지 이미 채워져 있으면 더 갈 필요가 없다.
        # 매일 갱신할 때 호출이 3회에서 1회로 줄어든다 — 유량 제한 아래서는 큰 차이다.
        if not fresh and (have_since := coverage(db, ticker)["start_date"]) and have_since <= oldest_wanted:
            break

        earliest = min(r["date"] for r in rows)
        if earliest <= oldest_wanted or len(rows) < WINDOW:
            break
        end = earliest - timedelta(days=1)

    return {"ticker": ticker, "added": added, "calls": calls, **coverage(db, ticker)}


def coverage(db: Session, ticker: str) -> dict:
    row = db.query(
        func.count(InvestorFlow.id), func.min(InvestorFlow.date), func.max(InvestorFlow.date)
    ).filter(InvestorFlow.ticker == ticker).one()
    return {"count": row[0], "start_date": row[1], "end_date": row[2]}


def get(db: Session, ticker: str, limit: int | None = None) -> list[InvestorFlow]:
    q = db.query(InvestorFlow).filter(InvestorFlow.ticker == ticker).order_by(InvestorFlow.date)
    rows = q.all()
    return rows[-limit:] if limit else rows
