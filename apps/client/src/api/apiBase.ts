/**
 * 서버 주소가 무엇이 되는가 — 한 줄짜리 규칙이지만 **틀리면 조용히 틀린다.**
 *
 * 이 한 줄을 따로 떼어 낸 이유는 `??` 와 `||` 의 차이가 배포 전체를 가르기
 * 때문이다. 같은 오리진 서빙(docs/deploy-public.md 6단계)은 `.env.production` 의
 * `VITE_API_BASE_URL=` 이 **빈 문자열**로 실려 오는 것에 통째로 매달려 있다 —
 * 빈 문자열이면 모든 호출이 `/api/...` 가 되어 주소가 번들에 안 박히고, 그래서
 * CORS 도 혼합 콘텐츠도 안드로이드 평문 차단도 생기지 않는다.
 *
 * `||` 로 "고치면" 빈 문자열이 falsy 라 폴백이 이기고, 공개된 사이트의 번들에
 * `http://localhost:3000` 이 박힌 채로 나간다. 그 실패는 타입 검사도 빌드도
 * 통과하고 **폰에서야 발견된다** — 그래서 여기에 자를 댄다(apiBase.test.ts).
 */
export function resolveApiBase(raw: string | undefined): string {
  return raw ?? 'http://localhost:3000'
}
