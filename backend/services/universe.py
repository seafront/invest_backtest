"""지수 구성종목 목록.

yfinance는 지수 구성종목을 제공하지 않으므로 공개 페이지에서 읽는다.
하루에도 몇 번씩 바뀌는 값이 아니라 프로세스가 사는 동안 한 번만 받아 재사용한다.

소스가 지수마다 다른 이유 (2026-08 기준):
- S&P 500   : 위키피디아에 구성종목 표가 유지되고 있다.
- 나스닥 100 : 위키피디아에서 표가 사라져 Slickcharts를 쓴다.
- 코스피 200 : KRX 공식 API는 로그인을 요구하고(pykrx도 같은 벽에 막힌다),
              위키피디아에도 목록이 없어 네이버 금융의 편입종목 페이지를 쓴다.

회사 이름도 함께 돌려준다. yfinance의 .info로 받으면 종목당 1초씩 걸리는데,
구성종목 페이지에는 이름이 이미 들어 있어 추가 요청이 필요 없다.
"""
import io
import re
from functools import partial

import pandas as pd
import requests

# 신원을 밝히는 것이 위키피디아 정책이고, 기본 User-Agent는 403으로 막힌다.
HEADERS = {"User-Agent": "BacktestLab/1.0 (educational backtesting app)"}
TIMEOUT = 30

NAVER_ITEM = re.compile(r'/item/main\.naver\?code=(\d{6})"[^>]*>([^<]+)<')


def _fetch_table(url: str, column: str, name_column: str) -> list[tuple[str, str]]:
    """표 하나에 심볼과 이름이 같이 있는 페이지 (위키피디아·Slickcharts)."""
    res = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
    res.raise_for_status()

    # 표 인덱스를 고정하지 않는다 — 페이지가 개편되면 순서가 쉽게 바뀐다.
    table = None
    for candidate in pd.read_html(io.StringIO(res.text)):
        if column in [str(c) for c in candidate.columns]:
            table = candidate
            break
    if table is None:
        raise ValueError(f"'{column}' 컬럼을 가진 표를 찾지 못했습니다 — 페이지 구조가 바뀐 것 같습니다")

    out = []
    for sym, name in zip(table[column].astype(str), table[name_column].astype(str)):
        # 야후는 복수 클래스 주식에 하이픈을 쓴다 (BRK.B → BRK-B).
        out.append((sym.strip().upper().replace(".", "-"), name.strip()))
    return out


def _fetch_naver_kospi200() -> list[tuple[str, str]]:
    """네이버 금융 코스피200 편입종목. 표에는 코드가 없어 링크에서 뽑는다."""
    out: list[tuple[str, str]] = []
    seen: set[str] = set()
    for page in range(1, 25):  # 페이지당 20종목. 여유를 두고 새 종목이 없으면 멈춘다.
        res = requests.get(
            f"https://finance.naver.com/sise/entryJongmok.naver?&page={page}",
            headers=HEADERS, timeout=TIMEOUT,
        )
        res.raise_for_status()
        res.encoding = "euc-kr"
        fresh = [(c, n.strip()) for c, n in NAVER_ITEM.findall(res.text) if c not in seen]
        if not fresh:
            break
        for code, name in fresh:
            seen.add(code)
            out.append((f"{code}.KS", name))  # 야후는 코스피에 .KS 접미사를 쓴다
    return out


SOURCES: dict[str, dict] = {
    "sp500": {
        "label": "S&P 500",
        "min_count": 400,
        "fetch": partial(
            _fetch_table,
            url="https://en.wikipedia.org/wiki/List_of_S%26P_500_companies",
            column="Symbol",
            name_column="Security",
        ),
    },
    "nasdaq100": {
        "label": "나스닥 100",
        "min_count": 90,
        "fetch": partial(
            _fetch_table,
            url="https://www.slickcharts.com/nasdaq100",
            column="Symbol",
            name_column="Company",
        ),
    },
    "kospi200": {
        "label": "코스피 200",
        "min_count": 180,  # 정기 변경 전후로 199~201개를 오간다
        "fetch": _fetch_naver_kospi200,
    },
}

_cache: dict[str, list[tuple[str, str]]] = {}


def constituents(universe: str, refresh: bool = False) -> list[tuple[str, str]]:
    """(야후 심볼, 회사 이름) 목록."""
    if universe not in SOURCES:
        raise ValueError(f"알 수 없는 유니버스: {universe}. 사용 가능: {', '.join(SOURCES)}")
    if universe in _cache and not refresh:
        return _cache[universe]

    src = SOURCES[universe]
    out: list[tuple[str, str]] = []
    seen: set[str] = set()
    for sym, name in src["fetch"]():
        # 나스닥 100에는 GOOG/GOOGL처럼 한 회사의 복수 상장이 함께 들어 있다.
        # 종목 단위로는 서로 다른 시세라 둘 다 남기고, 같은 심볼만 걸러낸다.
        if sym and sym != "NAN" and sym not in seen:
            seen.add(sym)
            out.append((sym, name))

    if len(out) < src["min_count"]:
        raise ValueError(
            f"{src['label']} 구성종목이 {len(out)}개뿐입니다 — 페이지를 잘못 읽은 것 같습니다"
        )

    _cache[universe] = out
    return out


def symbols(universe: str, refresh: bool = False) -> list[str]:
    return [sym for sym, _ in constituents(universe, refresh)]
