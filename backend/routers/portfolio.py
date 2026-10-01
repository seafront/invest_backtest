from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import AccountSnapshot, Holding
from schemas import HoldingCreate, HoldingRulesUpdate, HoldingStatus, PortfolioOverview, PortfolioSyncResult
from services import kis_client, portfolio
from services.strategies import get_strategy

router = APIRouter(prefix="/api/portfolio", tags=["portfolio"])

SNAPSHOT_LIMIT = 400


@router.get("/", response_model=PortfolioOverview)
def overview(db: Session = Depends(get_db)):
    """보유 종목과 규칙 상태, 계좌 스냅샷. 캐시만 읽는다(KIS·야후 호출 없음)."""
    holdings = db.query(Holding).order_by(Holding.active.desc(), Holding.source, Holding.ticker).all()
    env = "paper" if kis_client.is_paper() else "real"
    snaps = db.query(AccountSnapshot).filter(AccountSnapshot.env == env) \
        .order_by(AccountSnapshot.date.desc()).limit(SNAPSHOT_LIMIT).all()
    hint = kis_client.account_hint()
    return {
        "kis": {"env": env, "configured": kis_client.config()["configured"] and bool(hint), "account_hint": hint,
                "last_sync": snaps[0].taken_at if snaps else None},
        "holdings": [portfolio.status(db, h) for h in holdings if h.active or h.strategy_name or h.stop_loss_pct
                     or h.target_pct or h.trailing_pct],
        "snapshots": snaps,
    }


@router.post("/sync", response_model=PortfolioSyncResult)
def sync(db: Session = Depends(get_db)):
    """KIS 잔고·체결을 읽어 온다(조회만). 직접 입력한 종목은 시세만 새로 받는다."""
    try:
        return portfolio.sync_kis(db)
    except kis_client.KisError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/holdings", response_model=HoldingStatus)
def add_holding(req: HoldingCreate, db: Session = Depends(get_db)):
    """KIS 밖의 보유분을 직접 넣는다."""
    try:
        h = portfolio.add_manual(db, req.ticker, req.quantity, req.avg_price, req.first_buy_date)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return portfolio.status(db, h)


@router.put("/holdings/{holding_id}", response_model=HoldingStatus)
def update_holding(holding_id: int, req: HoldingRulesUpdate, db: Session = Depends(get_db)):
    """청산 규칙을 바꾼다. 요청 전체로 덮어쓴다(빠진 규칙은 꺼진다)."""
    h = db.query(Holding).filter(Holding.id == holding_id).first()
    if not h:
        raise HTTPException(status_code=404, detail="보유 종목이 없습니다")
    if req.strategy_name:
        try:
            strategy = get_strategy(req.strategy_name)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        params = {**{p["name"]: p["default"] for p in strategy.param_schema}, **(req.params or {})}
        for p in strategy.param_schema:
            if not p["min"] <= params[p["name"]] <= p["max"]:
                raise HTTPException(status_code=400, detail=f"{p['name']}은(는) {p['min']}–{p['max']} 범위여야 합니다")
        h.strategy_name, h.params, h.backtest_id = strategy.name, params, req.backtest_id
    else:
        h.strategy_name, h.params, h.backtest_id = None, None, None
    h.stop_loss_pct, h.target_pct, h.trailing_pct = req.stop_loss_pct, req.target_pct, req.trailing_pct
    # 첫 매수일은 KIS 체결이 3개월을 넘으면 비어 있어 직접 넣을 수 있게 한다. 수량·단가는 직접 입력한 종목만.
    if req.first_buy_date is not None:
        h.first_buy_date = req.first_buy_date
        h.first_buy_price = h.first_buy_price if h.source == "kis" and h.first_buy_price else None
    if h.source == "manual":
        if req.quantity is not None:
            h.quantity = req.quantity
        if req.avg_price is not None:
            h.avg_price = req.avg_price
    db.commit()
    db.refresh(h)
    return portfolio.status(db, h)


@router.delete("/holdings/{holding_id}")
def delete_holding(holding_id: int, db: Session = Depends(get_db)):
    """직접 입력한 종목을 지운다. KIS 종목은 다음 동기화에 다시 생기므로 지우지 않는다."""
    h = db.query(Holding).filter(Holding.id == holding_id).first()
    if not h:
        raise HTTPException(status_code=404, detail="보유 종목이 없습니다")
    if h.source == "kis" and h.active:
        raise HTTPException(status_code=400, detail="KIS 잔고에 있는 종목은 지울 수 없습니다")
    db.delete(h)
    db.commit()
    return {"deleted": holding_id}
