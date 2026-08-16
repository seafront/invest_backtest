/** Axios 에러에서 FastAPI의 detail 메시지를 꺼낸다. 없으면 일반 메시지로 폴백. */
export function errMessage(err: unknown, fallback = "요청에 실패했습니다"): string {
  const e = err as { response?: { data?: { detail?: string } }; message?: string };
  return e?.response?.data?.detail ?? e?.message ?? fallback;
}
