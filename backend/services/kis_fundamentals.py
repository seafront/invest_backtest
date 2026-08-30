"""KIS 재무제표 수집 — 한국 종목 전용.

yfinance는 분기 5개, 연간 5개가 상한이다. KIS는 같은 종목에 분기 30개(7년 반),
연간 23개(2004년부터)를 준다. 한국 종목은 이쪽이 압도적으로 깊다.

호출 세 번으로 손익·재무상태·재무비율을 모두 받는다. 재무비율에는 ROE·EPS·BPS가
그대로 들어 있어 계산할 필요가 없고, EPS가 있으면 과거 주가로 그 시점의 PER을
되살릴 수 있다 — 스냅샷이 오늘 값만 주는 한계를 여기서 일부 메운다.

세 가지 함정이 있다.

  99.99  값이 아니라 결측 표시다. 판매관리비·감가상각비에서 자주 나온다.
         숫자로 저장하면 마진 계산이 조용히 틀어진다.
  단위    금액이 억원이다. yfinance는 원으로 주므로 저장하는 순간 원으로 맞춘다.
         한때 억원 그대로 담고 unit_scale에 배수를 남겼는데, 읽는 쪽마다 곱셈을
         기억해야 해서 실패했다 — 재고자산이 "₩53억조"로 찍혔고, 업종 비교의
         재고/매출 비율도 1억 배 어긋날 참이었다. 테이블은 항상 기준 통화의
         기본 단위(원·달러)로 둔다.
  중간결산 연간 목록 맨 위에 아직 끝나지 않은 해의 누적이 섞인다. 삼성전자는
         202606(반년 305.4조)이 202512(1년 333.6조) 위에 온다. 그대로 그리면
         2026년이 전년보다 줄어든 것처럼 보인다. 결산월이 다른 행은 뺀다.
  누적    분기 값이 그 해 누적(YTD)이다. 삼성전자 2025년이 153.7조 → 239.8조 →
         333.6조로 커지다 이듬해 리셋된다. 차분해야 그 분기의 값이 나오고,
         실제로 239.8 − 153.7 = 86.1조가 yfinance의 3분기 매출과 정확히 맞는다.
         그냥 담으면 3분기 매출이 실제의 2.8배가 된다.
"""
from datetime import date, datetime

from sqlalchemy.orm import Session

from models import Fundamental
from services import kis_client

# KIS가 결측을 표시하는 값. 실제 99.99가 올 자리가 아니다.
MISSING = {"99.99", "0.00", ""}
UNIT_SCALE = 100_000_000.0   # 억원 → 원

INCOME = ("/uapi/domestic-stock/v1/finance/income-statement", "FHKST66430200")
BALANCE = ("/uapi/domestic-stock/v1/finance/balance-sheet", "FHKST66430100")
RATIO = ("/uapi/domestic-stock/v1/finance/financial-ratio", "FHKST66430300")

DIV_QUARTER, DIV_ANNUAL = "1", "0"


def _num(raw, *, allow_zero: bool = True) -> float | None:
    if raw is None:
        return None
    text = str(raw).strip().replace(",", "")
    if text in ("", "-"):
        return None
    # 99.99는 결측 표시다. 다만 비율 항목에서는 실제 값일 수 있어 금액에만 적용한다.
    try:
        value = float(text)
    except ValueError:
        return None
    if not allow_zero and value == 0:
        return None
    return value


def _amount(raw) -> float | None:
    """금액 항목을 원 단위로 바꾼다. float64는 1e15까지 정수를 정확히 담으므로
    171조(1.7e14)에서 손실이 없다."""
    if raw is None or str(raw).strip() in MISSING:
        return None
    value = _num(raw)
    return None if value is None else value * UNIT_SCALE


def _period_end(yymm: str, period_type: str) -> date | None:
    """'202606' → 그 분기/연도의 말일."""
    if not yymm or len(yymm) != 6:
        return None
    year, month = int(yymm[:4]), int(yymm[4:])
    last_day = {3: 31, 6: 30, 9: 30, 12: 31}.get(month)
    if last_day is None:
        return None
    return date(year, month, last_day)


def _drop_partial_year(rows: list[dict]) -> list[dict]:
    """연간 목록에서 아직 끝나지 않은 해의 중간 누적을 뺀다.

    온전한 결산은 모두 같은 달에 끝난다(대개 12월, 회사에 따라 3·6월). 그 다수결에서
    벗어난 행이 진행 중인 해다. 달을 고정하지 않는 이유는 결산월이 12월이 아닌
    회사가 실제로 있기 때문이다.
    """
    if len(rows) < 3:
        return rows
    months = [r["period_end"].month for r in rows]
    fiscal_month = max(set(months), key=months.count)
    return [r for r in rows if r["period_end"].month == fiscal_month]


def _fetch(path_tr: tuple[str, str], code: str, div: str | None) -> list[dict]:
    path, tr = path_tr
    params = {"FID_COND_MRKT_DIV_CODE": "J", "FID_INPUT_ISCD": code}
    if div is not None:
        params["FID_DIV_CLS_CODE"] = div
    return kis_client.request(path, tr, params).get("output") or []


# 누적으로 보고되는 항목. 잔액(자산·부채·자본)과 비율은 시점 값이라 차분하지 않는다.
CUMULATIVE_FIELDS = ("revenue", "gross_profit", "operating_income", "net_income")


def _to_discrete(rows: list[dict]) -> list[dict]:
    """누적(YTD) 분기 값을 그 분기만의 값으로 바꾼다.

    같은 회계연도 안에서 직전 분기를 뺀다. 1분기는 누적과 분기가 같으므로 그대로 둔다.
    연도가 바뀌면 다시 1분기부터 시작한다.
    """
    ordered = sorted(rows, key=lambda r: r["period_end"])
    previous: dict[int, dict] = {}
    for row in ordered:
        year = row["period_end"].year
        prior = previous.get(year)
        if prior is not None:
            for field in CUMULATIVE_FIELDS:
                now, before = row.get(field), prior.get(field)
                row[field] = None if now is None or before is None else round(now - before, 2)
        # 차분하기 전의 누적값을 다음 분기가 참조해야 한다.
        previous[year] = {f: (row.get(f) if prior is None else _restore(row.get(f), prior.get(f)))
                          for f in CUMULATIVE_FIELDS}
    return ordered


def _restore(discrete, prior_cumulative):
    """차분한 값에서 원래 누적값을 되살린다 — 다음 분기의 기준으로 쓰기 위해."""
    if discrete is None or prior_cumulative is None:
        return None
    return round(discrete + prior_cumulative, 2)


def sync(db: Session, ticker: str, period_type: str = "quarterly") -> dict:
    """한 종목의 재무를 받아 저장한다. 호출 3회."""
    if not ticker.upper().endswith((".KS", ".KQ")):
        raise ValueError(f"{ticker}: KIS 재무는 한국 종목에만 제공됩니다")
    if period_type not in ("quarterly", "annual"):
        raise ValueError(f"알 수 없는 주기: {period_type}")

    ticker = ticker.upper()
    code = ticker.split(".")[0]
    div = DIV_QUARTER if period_type == "quarterly" else DIV_ANNUAL

    income = {r.get("stac_yymm"): r for r in _fetch(INCOME, code, div)}
    balance = {r.get("stac_yymm"): r for r in _fetch(BALANCE, code, div)}
    ratio = {r.get("stac_yymm"): r for r in _fetch(RATIO, code, div)}
    if not income:
        raise ValueError(f"{ticker}: 재무 데이터를 받지 못했습니다")

    prepared: list[dict] = []
    existing = {
        (f.period_end, f.period_type): f
        for f in db.query(Fundamental).filter(
            Fundamental.ticker == ticker, Fundamental.period_type == period_type
        ).all()
    }
    added = updated = 0

    for yymm, inc in income.items():
        period_end = _period_end(yymm, period_type)
        if period_end is None:
            continue
        bal, rat = balance.get(yymm, {}), ratio.get(yymm, {})

        row = {
            "ticker": ticker,
            "period_end": period_end,
            "period_type": period_type,
            "source": "kis",
            "unit_scale": 1.0,      # 이미 원으로 맞춰 담는다
            "revenue": _amount(inc.get("sale_account")),
            "gross_profit": _amount(inc.get("sale_totl_prfi")),
            "operating_income": _amount(inc.get("bsop_prti")),
            "net_income": _amount(inc.get("thtr_ntin")),
            "total_assets": _amount(bal.get("total_aset")),
            "total_debt": _amount(bal.get("total_lblt")),
            "equity": _amount(bal.get("total_cptl")),
            # 재고자산·매출채권·현금흐름은 KIS 재무제표 API에 없다. 키에 넣지 않아야
            # 아래 갱신 루프가 건드리지 않고, 같은 분기를 yfinance가 이미 채웠다면
            # 그 값이 살아남는다. 이제 두 소스가 같은 단위라 섞여도 안전하다.
            # 비율은 이미 퍼센트라 단위 변환이 필요 없다.
            "roe": _num(rat.get("roe_val")),
            "eps": _num(rat.get("eps")),
            "bps": _num(rat.get("bps")),
            "updated_at": datetime.utcnow(),
        }

        prepared.append(row)

    # 분기는 누적으로 오므로 차분한다. 연간은 이미 그 해의 값이지만,
    # 진행 중인 해의 중간 누적이 섞여 오므로 걸러낸다.
    if period_type == "quarterly":
        prepared = _to_discrete(prepared)
    else:
        prepared = _drop_partial_year(prepared)

    for row in prepared:
        current = existing.get((row["period_end"], period_type))
        if current is None:
            db.add(Fundamental(**row))
            added += 1
        else:
            for key, value in row.items():
                if key not in ("ticker", "period_end", "period_type"):
                    setattr(current, key, value)
            updated += 1

    db.commit()
    periods = sorted(p for p, _ in existing) if existing else []
    return {
        "ticker": ticker,
        "period_type": period_type,
        "added": added,
        "updated": updated,
        "count": len(prepared),
        "first_period": min((r["period_end"] for r in prepared), default=None),
        "last_period": max((r["period_end"] for r in prepared), default=None),
        "previous": len(periods),
    }
