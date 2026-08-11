/**
 * 배포가 바꾸는 것들 — 환경변수를 값으로 옮기는 한 곳.
 *
 * 왜 파싱을 따로 떼는가: 이 값들은 **틀려도 서버가 멈추지 않는다.** 오리진
 * 목록에 오타가 나면 게임이 그냥 안 붙고(브라우저 콘솔에만 보인다), 프록시
 * 설정이 틀리면 레이트리미터가 조용히 무력해지고, 로그 설정이 틀리면 남을
 * 것이 안 남는다. 조용히 어긋나는 것은 테스트로 붙잡아야 하고, 테스트가
 * 붙잡으려면 `process.env` 를 읽는 자리와 문자열을 해석하는 자리가 갈라져
 * 있어야 한다.
 */

/** `@fastify/cors` 의 `origin` 에 그대로 실리는 값. `true` 는 "오는 대로 받는다"다. */
export type CorsOrigin = true | string[]

/** Fastify 의 `trustProxy` 에 그대로 실리는 값. */
export type TrustProxy = boolean | number | string[]

/** pino 가 아는 심각도. 이 밖의 값을 주면 pino 는 **기동 중에 던진다.** */
export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace'

const LOG_LEVELS: readonly string[] = ['fatal', 'error', 'warn', 'info', 'debug', 'trace']

/** 끄는 말들. `silent` 는 pino 의 이름이고 나머지는 사람이 적을 법한 말이다. */
const LOG_OFF_WORDS: readonly string[] = ['off', 'none', 'silent', 'false', 'no', '0']

/** 가려진 자리에 남는 글자. 값이 없어진 것과 가려진 것을 로그에서 구분할 수 있어야 한다. */
export const LOG_CENSOR = '[가려짐]'

/**
 * 로그에서 지울 자리들.
 *
 * **이 서버에서 자격증명은 셋이다** — 비밀번호, 세션 토큰, 그리고 그 토큰을
 * 실어 나르는 `Authorization` 헤더. 셋 다 로그에 한 줄만 남아도 그 계정은
 * 남의 것이 되므로(비밀번호 찾기가 없어서 되돌릴 방법도 없다) 같은 값으로 친다.
 *
 * 지금 Fastify 의 기본 `req` 직렬화기는 method·url·host·remoteAddress 만 남기고
 * 헤더도 본문도 아예 싣지 않는다. 그러니 아래 경로 중 상당수는 **오늘은 걸릴
 * 것이 없다.** 그래도 적어 두는 이유: 디버깅하다가 직렬화기를 갈아 끼우거나
 * `request.log.info({ headers })` 를 한 줄 넣는 날이 오고, 그 한 줄은 리뷰에서
 * 위험해 보이지 않는다. pino 는 **직렬화기가 돈 뒤에** 가리므로(확인함) 그날
 * 이 목록이 그대로 그물이 된다.
 *
 * 같은 값이 여러 이름으로 실린다: Fastify 는 `req`, 손으로 적으면 `request`,
 * 헤더만 따로 넘기면 `headers` 다. 하나만 적으면 나머지 둘로 새어 나간다.
 */
export const LOG_REDACT_PATHS: readonly string[] = [
  'req.headers.authorization',
  'request.headers.authorization',
  'headers.authorization',
  // 쿠키는 지금 안 쓰지만, 쓰게 되는 날 세션이 여기로 다닌다.
  'req.headers.cookie',
  'request.headers.cookie',
  'headers.cookie',
  'password',
  '*.password',
  'req.body.password',
  'request.body.password',
  'body.password',
  'passwordHash',
  '*.passwordHash',
  'token',
  '*.token',
]

/** Fastify 의 `logger` 에 그대로 실리는 값. `false` 는 "한 줄도 남기지 않는다"다. */
export type LoggerSetting = false | { level: LogLevel; redact: { paths: string[]; censor: string } }

/**
 * `LOG_LEVEL` — 요청 로그를 남길 것인가, 어디까지.
 *
 * **컨테이너에서는 기본이 `info` 다.** 값을 정하는 것이 `LOG_LEVEL` 하나가
 * 아니라 `NODE_ENV` 와 둘인 이유가 여기 있다: 배포 중인 미니PC 의 `.env` 는
 * 이 변수를 모르는 채로 이미 쓰이고 있고(그 파일은 커밋되지 않아 우리가 고칠
 * 수 없다), 그 서버가 이번 배포 뒤에도 여전히 말이 없다면 이 변경은 아무것도
 * 한 것이 없다. 이미지가 `NODE_ENV=production` 을 박아 두므로(Dockerfile)
 * 컨테이너는 아무 설정 없이도 말을 하게 된다.
 *
 * **`NODE_ENV=test` 면 무조건 끈다.** 명시된 `LOG_LEVEL` 보다도 세게 이긴다 —
 * 셸에 남아 있던 환경변수 하나 때문에 테스트 출력이 사람마다 달라지면 안 된다.
 * 로그를 시험하는 테스트는 `buildApp({ logger })` 로 직접 앉힌다.
 *
 * 개발 PC(둘 다 아닌 경우)는 조용한 쪽이 기본이다. 지금까지 조용했고, 그것을
 * 시끄럽게 바꾸는 것은 이 변경이 할 일이 아니다. 보고 싶으면 `LOG_LEVEL=debug`.
 *
 * 모르는 값이 오면 **끄지 않고 `info` 로 간다.** `LOG_LEVEL=Info` 같은 오타에
 * pino 는 기동 중에 던지는데, 로그 심각도 한 글자 때문에 서버가 안 뜨는 것은
 * 어떤 계산으로도 남는 장사가 아니다.
 */
export function parseLogger(raw: string | undefined, nodeEnv: string | undefined): LoggerSetting {
  if (nodeEnv?.trim() === 'test') return false

  const word = raw?.trim().toLowerCase() ?? ''
  if (word === '') return nodeEnv?.trim() === 'production' ? at('info') : false
  if (LOG_OFF_WORDS.includes(word)) return false
  return at(LOG_LEVELS.includes(word) ? (word as LogLevel) : 'info')
}

/**
 * 심각도 하나에 리댁션을 붙여 내놓는다. 매번 새 배열을 주는 이유는 pino 가
 * 이 배열을 자기 것으로 들고 가기 때문이다 — 공유하면 앱 하나가 목록을 건드릴 때
 * 다른 앱까지 함께 바뀐다.
 */
function at(level: LogLevel): LoggerSetting {
  return { level, redact: { paths: [...LOG_REDACT_PATHS], censor: LOG_CENSOR } }
}

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
