"""한국투자증권(KIS) Open API 클라이언트.

한국 시장은 미국과 달리 투자자 유형별 매매동향을 공개한다. 네이버 모바일 API로도
외국인·기관·개인 순매수를 받을 수 있지만 최근 10거래일에서 끊긴다. 과거까지
소급하려면 증권사 API가 필요하고, 그중 REST를 제공해 macOS에서 쓸 수 있는 곳이
한국투자증권이다.

자격증명은 backend/.env 에서 읽는다. 실전 앱키는 시세뿐 아니라 주문 API까지
열리므로 저장소에 들어가면 안 된다 (.gitignore 에 등록해 두었다).
"""
import json
import os
import time
from datetime import datetime
from pathlib import Path

import requests
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

REAL_HOST = "https://openapi.koreainvestment.com:9443"
PAPER_HOST = "https://openapivts.koreainvestment.com:29443"

# 토큰은 24시간 유효한데 발급 호출 자체에 유량 제한이 있다. 서버를 다시 띄울 때마다
# 새로 받으면 금방 막히므로 파일에 남겨 재사용한다.
TOKEN_CACHE = BASE_DIR / ".kis_token.json"
TOKEN_MARGIN = 600  # 만료 10분 전에는 새로 받는다

# 초당 호출 제한이 있다. 넘기면 EGW00201 로 거절당한다. 모의투자 쪽이 실전보다
# 빡빡해서 기본값을 모의 기준으로 잡는다 — 늦더라도 거절당하는 것보다 낫다.
MIN_INTERVAL = float(os.getenv("KIS_MIN_INTERVAL", "0.6"))
RETRY_ON_THROTTLE = 3
# 잠깐 뒤 다시 부르면 풀리는 오류. EGW00201은 유량 초과, EGW00316은 "조회 처리 중 오류 —
# 재 조회 수행 부탁드립니다"로 KIS가 직접 재시도를 요청한다 (HTTP 500으로 온다).
# 재시도 없이 실패로 올리면 일괄 수집이 연속 실패로 중단된다 (2026-09 수급 48/201에서 멈췄다).
RETRYABLE = {"EGW00201", "EGW00316"}
_last_call = 0.0


class KisError(RuntimeError):
    """설정 누락이나 API 오류. 호출부가 사용자에게 그대로 보여줄 수 있는 문장을 담는다."""


def _env() -> str:
    return "real" if os.getenv("KIS_ENV", "paper").lower() == "real" else "paper"


def _key_pair(env: str) -> tuple[str, str]:
    """환경별 앱키. 모의와 실전은 키가 다르고 서로의 서버에서 통하지 않는다.

    둘을 각각 적어 두고 KIS_ENV 로 고른다. 값을 바꿔치기하는 방식이면
    실전 키가 담긴 채로 실수로 남기 쉽다.
    """
    prefix = "KIS_REAL" if env == "real" else "KIS_PAPER"
    key = os.getenv(f"{prefix}_APP_KEY", "")
    secret = os.getenv(f"{prefix}_APP_SECRET", "")
    if not key or not secret:  # 이전 단일 키 설정과도 호환된다
        key = key or os.getenv("KIS_APP_KEY", "")
        secret = secret or os.getenv("KIS_APP_SECRET", "")
    return key, secret


def config() -> dict:
    """현재 설정. 키 값 자체는 노출하지 않는다."""
    env = _env()
    key, secret = _key_pair(env)
    return {
        "env": env,
        "host": REAL_HOST if env == "real" else PAPER_HOST,
        "configured": bool(key and secret),
        "key_hint": f"{key[:4]}…{key[-2:]}" if len(key) > 6 else "",
    }


def _credentials() -> tuple[str, str, str]:
    env = _env()
    key, secret = _key_pair(env)
    if not (key and secret):
        prefix = "KIS_REAL" if env == "real" else "KIS_PAPER"
        raise KisError(
            f"{env} 환경의 앱키가 없습니다. backend/.env 에 "
            f"{prefix}_APP_KEY / {prefix}_APP_SECRET 를 채우세요."
        )
    return key, secret, REAL_HOST if env == "real" else PAPER_HOST


def _cached_token(host: str) -> str | None:
    if not TOKEN_CACHE.exists():
        return None
    try:
        data = json.loads(TOKEN_CACHE.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    # 모의와 실전은 토큰이 다르다. 호스트가 바뀌면 캐시를 쓰지 않는다.
    if data.get("host") != host or data.get("expires_at", 0) - TOKEN_MARGIN < time.time():
        return None
    return data.get("token")


def get_token() -> str:
    key, secret, host = _credentials()
    cached = _cached_token(host)
    if cached:
        return cached

    res = requests.post(
        f"{host}/oauth2/tokenP",
        json={"grant_type": "client_credentials", "appkey": key, "appsecret": secret},
        timeout=20,
    )
    if not res.ok:
        raise KisError(f"토큰 발급 실패 (HTTP {res.status_code}): {res.text[:200]}")
    body = res.json()
    token = body.get("access_token")
    if not token:
        raise KisError(f"토큰 발급 응답에 access_token 이 없습니다: {str(body)[:200]}")

    expires_in = int(body.get("expires_in", 86400))
    TOKEN_CACHE.write_text(json.dumps({
        "host": host, "token": token, "expires_at": time.time() + expires_in,
        "issued_at": datetime.utcnow().isoformat(),
    }))
    TOKEN_CACHE.chmod(0o600)
    return token


def _throttle() -> None:
    global _last_call
    wait = MIN_INTERVAL - (time.time() - _last_call)
    if wait > 0:
        time.sleep(wait)
    _last_call = time.time()


def request(path: str, tr_id: str, params: dict) -> dict:
    """시세 계열 GET 호출. 주문 API는 이 클라이언트에서 다루지 않는다."""
    key, secret, host = _credentials()
    last_msg = ""

    for attempt in range(RETRY_ON_THROTTLE):
        _throttle()
        try:
            res = requests.get(
                f"{host}{path}",
                headers={
                    "authorization": f"Bearer {get_token()}",
                    "appkey": key,
                    "appsecret": secret,
                    "tr_id": tr_id,
                    "custtype": "P",  # 개인
                },
                params=params,
                timeout=20,
            )
        except (requests.Timeout, requests.ConnectionError) as e:
            # 모의투자 서버는 응답이 20초를 넘기곤 한다. 다음 호출은 대개 정상이라 재시도한다.
            last_msg = type(e).__name__
            time.sleep(MIN_INTERVAL * (attempt + 2))
            continue
        body = res.json() if res.content else {}
        # 유량 초과·일시 오류는 잠깐 쉬면 풀린다. 다른 오류와 달리 재시도할 가치가 있다.
        if body.get("msg_cd") in RETRYABLE:
            last_msg = body.get("msg_cd")
            time.sleep(MIN_INTERVAL * (attempt + 2))
            continue
        if not res.ok:
            raise KisError(f"{tr_id} 실패 (HTTP {res.status_code}): {res.text[:200]}")
        # KIS는 HTTP 200 으로도 실패를 알린다. rt_cd 가 "0" 이어야 정상이다.
        if body.get("rt_cd") not in ("0", None):
            raise KisError(f"{tr_id} 오류 [{body.get('msg_cd')}] {body.get('msg1', '')[:150]}")
        return body

    reason = "유량 제한" if last_msg == "EGW00201" else f"일시 오류({last_msg})"
    raise KisError(f"{tr_id} {reason}으로 {RETRY_ON_THROTTLE}회 재시도 후 실패했습니다")


def investor_flow_daily(code: str, end_date: str) -> list[dict]:
    """종목별 투자자 매매동향 (일별). end_date 로 끝나는 30거래일을 돌려준다.

    끝나는 날을 앞으로 옮기면 그 이전 30일이 오므로, 반복하면 과거로 소급된다.
    3개월이면 3회, 1년이면 9회쯤이다. 주체가 외국인·기관·개인에 그치지 않고
    연기금·투신·사모·은행·보험·증권까지 나뉘어 온다.
    """
    body = request(
        "/uapi/domestic-stock/v1/quotations/investor-trade-by-stock-daily",
        "FHPTJ04160001",
        {
            "FID_COND_MRKT_DIV_CODE": "J",
            "FID_INPUT_ISCD": code,
            "FID_INPUT_DATE_1": end_date,
            "FID_ORG_ADJ_PRC": "1",   # 수정주가 반영
            "FID_ETC_CLS_CODE": "0",
        },
    )
    return body.get("output2", [])


def investor_flow(code: str) -> list[dict]:
    """종목별 투자자 매매동향 (외국인·기관·개인).

    조회 기간을 지정하는 파라미터가 없어 API가 돌려주는 최근 구간만 받는다.
    실제로 몇 거래일이 오는지는 키를 넣고 확인해야 한다 — 그 길이에 따라
    매일 적재가 필요한지, 소급이 가능한지가 갈린다.
    """
    body = request(
        "/uapi/domestic-stock/v1/quotations/inquire-investor",
        "FHKST01010900",
        {"FID_COND_MRKT_DIV_CODE": "J", "FID_INPUT_ISCD": code},
    )
    return body.get("output", [])
