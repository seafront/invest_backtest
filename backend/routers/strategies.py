from fastapi import APIRouter
from schemas import StrategyInfo
from services.strategies import list_strategies

router = APIRouter(prefix="/api/strategies", tags=["strategies"])


@router.get("/", response_model=list[StrategyInfo])
def get_strategies():
    strategies = list_strategies()
    return [
        {
            "name": s.name,
            "display_name": s.display_name,
            "description": s.description,
            "params": s.param_schema,
        }
        for s in strategies
    ]
