/**
 * 배포가 바꾸는 것들 — 환경변수를 값으로 옮기는 한 곳.
 *
 * 왜 파싱을 따로 떼는가: 이 두 값은 **틀려도 서버가 멈추지 않는다.** 오리진
 * 목록에 오타가 나면 게임이 그냥 안 붙고(브라우저 콘솔에만 보인다), 프록시
 * 설정이 틀리면 레이트리미터가 조용히 무력해진다. 조용히 어긋나는 것은
 * 테스트로 붙잡아야 하고, 테스트가 붙잡으려면 `process.env` 를 읽는 자리와
 * 문자열을 해석하는 자리가 갈라져 있어야 한다.
 */

/** `@fastify/cors` 의 `origin` 에 그대로 실리는 값. `true` 는 "오는 대로 받는다"다. */
export type CorsOrigin = true | string[]

/** Fastify 의 `trustProxy` 에 그대로 실리는 값. */
export type TrustProxy = boolean | number | string[]

/**
 * `CORS_ORIGIN` — 쉼표로 나눈 허용 출처 목록.
 *
 * **비어 있으면 `true`(전부 허용)다.** 기본을 잠그지 않는 이유는 이 값이 없는
 * 환경이 곧 개발 PC 이기 때문이다 — 지금까지 `origin: true` 로 돌던 개발이
 * 이 변경으로 막히면, 막힌 사람은 원인을 CORS 에서 찾지 않는다. 배포에서는
 * `.env` 가 목록을 준다.
 *
 * 안드로이드 빌드(Capacitor)의 출처는 `capacitor://localhost` 와
 * `http://localhost` 다 — 웹 주소가 아니라서 잊기 쉽고, 잊으면 앱에서만
 * 안 붙는다(`.env.example` 참고).
 *
 * 끝의 `/` 는 떼어 낸다. `Origin` 헤더에는 경로가 없어서 `https://a.example/`
 * 라고 적으면 **영원히 일치하지 않는데**, 주소창에서 복사하면 그 슬래시가 붙어
 * 온다. 사람이 흔히 저지르는 오타 하나를 여기서 흡수한다.
 */
export function parseCorsOrigin(raw: string | undefined): CorsOrigin {
  const list = splitList(raw).map((origin) => origin.replace(/\/+$/, ''))
  if (list.length === 0 || list.includes('*')) return true
  return list
}

/**
 * `TRUST_PROXY` — `X-Forwarded-For` 를 믿을 것인가.
 *
 * **기본은 끈다.** 서버를 직접 노출한 상태에서 켜면 아무나 헤더를 지어내
 * 요청마다 다른 IP 인 척할 수 있고, 그러면 IP 백오프(auth/rateLimit.ts)가
 * 무력해진다. 반대로 리버스 프록시 뒤에서 켜지 않으면 모든 요청이 프록시 IP
 * 하나로 보여, 한 사람의 실패가 나머지 전부를 막는다(설계 규범 8).
 *
 * 받는 꼴 셋:
 * - `true`/`on`/`yes` — 전부 믿는다. 프록시가 몇 대인지 모를 때뿐이고, 권하지 않는다.
 * - 숫자 — 앞에서부터 그만큼의 홉을 프록시로 본다. Caddy 한 대 뒤라면 `1` 이다.
 * - IP/CIDR 목록 — 그 주소에서 온 것만 프록시로 본다. 가장 좁고 가장 안전하다.
 */
export function parseTrustProxy(raw: string | undefined): TrustProxy {
  const value = raw?.trim() ?? ''
  if (value === '') return false

  const word = value.toLowerCase()
  if (word === 'true' || word === 'on' || word === 'yes') return true
  if (word === 'false' || word === 'off' || word === 'no') return false

  // 홉 수. `1` 을 "참"으로 읽지 않는 이유는 그 둘이 다른 뜻이기 때문이다 —
  // 참은 "전부 믿는다", 1 은 "한 대만 믿는다"다.
  if (/^\d+$/.test(value)) return Number(value)

  const list = splitList(value)
  return list.length > 0 ? list : false
}

/** 쉼표로 나누고, 앞뒤 공백을 떼고, 빈 칸은 버린다. 사람이 손으로 쓰는 값이다. */
function splitList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}
