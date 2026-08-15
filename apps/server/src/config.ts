import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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

/** `app.listen` 에 그대로 실리는 한 벌. */
export interface ListenAddress {
  host: string
  port: number
}

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
 * 이 프로세스는 **사람이 앞에 앉아 보고 있는 개발 콘솔**인가.
 *
 * 기본값 둘이 이 물음 하나에 매달려 있다 — 요청 로그를 남길 것인가
 * (parseLogger), 500 응답에 오류 문장을 실을 것인가(app.ts 의 에러 핸들러).
 * 둘을 따로 판정하면 언젠가 한쪽만 고쳐지고, 그날 배포는 "로그는 남는데 내부
 * 오류는 그대로 뱉는" 반쪽이 된다. 물음이 하나면 답도 하나다.
 *
 * **왜 `NODE_ENV` 만으로는 못 가르는가:** 이 게임이 실제로 도는 자리는
 * 컨테이너가 아니라 윈도 서비스(WinSW)이고, 그 XML 은 `NODE_ENV` 를 놓지
 * 않는다(docs/deploy-windows.md 의 서비스 정의 — 놓는 것은 `GIT_SHA` 하나다).
 * 개발 PC 도 놓지 않는다. 즉 `NODE_ENV === undefined` 는 개발과 배포 **둘 다**를
 * 가리켜서, 그 하나로 기본을 정하면 배포가 개발인 척한다. 공개 직전까지 요청
 * 로그가 한 줄도 안 남아 있던 것이 정확히 그 결과다.
 *
 * 그래서 **stdout 이 콘솔에 붙어 있는가**를 함께 본다. 개발은 사람이 터미널에서
 * 띄우고, 서비스는 아무도 안 보는 파일로 흘러간다(WinSW 의
 * `logs\nogada-server.out.log`). 실측으로 확인한 것 둘: 새 콘솔을 붙여 띄우면
 * `pnpm --filter … exec` 도 `tsx watch` 도 자식에게 stdio 를 물려주어 isTTY 가
 * true 로 남는다(그래서 `pnpm dev:server` 는 계속 조용하다); WinSW 는 stdout 을
 * 파일로 돌리므로 undefined 다.
 *
 * `NODE_ENV=production` 은 TTY 보다 세다 — 컨테이너를 `-t` 로 띄워 놓고 들여다
 * 보는 일이 있는데, 그때 콘솔이 붙었다고 배포가 개발이 되지는 않는다.
 *
 * 틀리는 쪽의 값이 다르다는 것도 이 방향의 근거다: 개발을 배포로 잘못 보면
 * 콘솔이 시끄러워지고 마는데(고치는 데 `LOG_LEVEL=off` 한 줄), 배포를 개발로
 * 잘못 보면 아무 흔적도 안 남고 오류 문장이 밖으로 나간다.
 */
export function isDevConsole(
  nodeEnv: string | undefined,
  stdoutIsTty: boolean | undefined,
): boolean {
  if (nodeEnv?.trim() === 'production') return false
  return stdoutIsTty === true
}

/**
 * `LOG_LEVEL` — 요청 로그를 남길 것인가, 어디까지.
 *
 * **적지 않으면 개발 콘솔에서만 조용하다**(isDevConsole). 서비스로 돌든
 * 컨테이너로 돌든, 사람이 안 보는 자리에 선 서버는 아무 설정 없이도 `info` 로
 * 말한다 — 배포된 `.env` 는 커밋되지 않아 우리가 고칠 수 없고, 그 파일이 이
 * 변수를 모르는 채 서버가 계속 말이 없다면 이 코드는 아무것도 한 것이 없다.
 * 반대로 개발 PC 는 지금까지 조용했고 그것을 시끄럽게 바꾸는 것은 이 변경이
 * 할 일이 아니다. 보고 싶으면 `LOG_LEVEL=debug`.
 *
 * **`NODE_ENV=test` 면 무조건 끈다.** 명시된 `LOG_LEVEL` 보다도 세게 이긴다 —
 * 셸에 남아 있던 환경변수 하나 때문에 테스트 출력이 사람마다 달라지면 안 된다.
 * 로그를 시험하는 테스트는 `buildApp({ logger })` 로 직접 앉힌다.
 *
 * 모르는 값이 오면 **끄지 않고 `info` 로 간다.** `LOG_LEVEL=Info` 같은 오타에
 * pino 는 기동 중에 던지는데, 로그 심각도 한 글자 때문에 서버가 안 뜨는 것은
 * 어떤 계산으로도 남는 장사가 아니다.
 */
export function parseLogger(
  raw: string | undefined,
  nodeEnv: string | undefined,
  stdoutIsTty: boolean | undefined,
): LoggerSetting {
  if (nodeEnv?.trim() === 'test') return false

  const word = raw?.trim().toLowerCase() ?? ''
  if (word === '') return isDevConsole(nodeEnv, stdoutIsTty) ? false : at('info')
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
 * `HOST`·`PORT` — 서버가 어느 문에 서는가.
 *
 * **기본은 `0.0.0.0` 이고 그대로 둔다.** 좁은 쪽이 안전하지만 기본을
 * `127.0.0.1` 로 바꾸면 **오늘 붙어 있는 것들이 조용히 끊긴다** — 개발 중에는
 * 폰과 다른 기계가 LAN 주소로 붙고, 지금 운영도 Tailscale 주소(100.125.30.85)로
 * 닿는다. 이 변수가 하는 일은 좁혀 두는 것이 아니라 **좁힐 수 있게 하는 것**이다.
 *
 * 터널 뒤에서는 `HOST=127.0.0.1` 을 준다. cloudflared 가 `127.0.0.1:3000` 으로
 * 들어오므로 다른 문은 열 이유가 없고, 열어 둔 채로는 터널을 세워도 3000 이
 * LAN·Tailscale 에 평문으로 계속 열려 있다(docs/deploy-public.md 4장 3단계).
 *
 * 빈 값은 "안 정했다"로 읽는다. `.env` 에 `HOST=` 한 줄만 남기는 일이 흔한데,
 * 그 빈 문자열을 그대로 넘기면 listen 이 터진다. `PORT=` 는 더 나쁘다 —
 * `Number('')` 는 0 이고 0 은 "아무 빈 포트나 골라라"라서, 서버는 멀쩡히 뜨고
 * 아무도 못 찾는 자리에 선다. 숫자가 아닌 오타(`PORT=삼천`)는 여기서 흡수하지
 * **않는다**: 그건 사람이 값을 적었는데 뜻이 없는 경우라, 조용히 3000 으로
 * 밀어 두면 "내가 적은 포트가 아닌 곳"에 선 서버를 아무도 못 알아챈다.
 */
export function parseListen(
  rawHost: string | undefined,
  rawPort: string | undefined,
): ListenAddress {
  const host = rawHost?.trim() ?? ''
  const port = rawPort?.trim() ?? ''
  return { host: host === '' ? '0.0.0.0' : host, port: port === '' ? 3000 : Number(port) }
}

/**
 * 클라이언트 dist 의 기본 자리 — 이 저장소 안의 `apps/client/dist`.
 *
 * 절대경로로 굳혀 두는 이유: 상대경로면 **어디서 띄웠는가**가 답을 바꾼다.
 * 개발은 저장소 루트에서, WinSW 는 `apps\server` 에서 띄운다
 * (docs/deploy-windows.md 의 workingdirectory) — 같은 설정이 두 자리에서 다른
 * 폴더를 가리키면 한쪽에서만 그림 없는 사이트가 뜬다.
 *
 * 이 자리를 고른 것은 **배포가 이 폴더를 안 지우기 때문**이다. dist 는
 * `.gitignore` 대상이고 배포 워크플로는 `git clean` 을 일부러 돌리지 않으므로
 * (.github/workflows/deploy.yml — 거기 `.env` 와 node_modules 가 있다),
 * 사람이 한 번 밀어 넣은 dist 는 `git reset --hard` 를 지나도 그대로 남는다.
 */
const DEFAULT_CLIENT_DIST = fileURLToPath(new URL('../../client/dist', import.meta.url))

/**
 * `CLIENT_DIST` — 서버가 같은 오리진으로 내줄 클라이언트 빌드가 어디 있는가.
 *
 * **없어도 서버는 뜬다.** 실제로 개발과 테스트는 dist 없이 서버를 띄우고, 서버
 * PC 도 사람이 dist 를 밀어 넣기 전까지는 없는 상태다(라이선스 에셋이 없어
 * 서버 PC 에서 빌드할 수 없다 — docs/deploy.md 의 "미니PC 는 그림을 모른다").
 * 그래서 이 값이 가리키는 곳이 비어 있으면 정적 서빙을 그냥 안 붙인다. 폴더가
 * 있는지 보는 것은 파일시스템의 일이라 여기서는 **경로만 정한다**(app.ts).
 *
 * 빈 값은 "안 정했다"로 읽는다 — `HOST`·`PORT` 와 같은 자세다(parseListen).
 * `.env` 에 `CLIENT_DIST=` 한 줄만 남는 일이 흔한데, 그 빈 문자열을 경로로
 * 넘기면 `resolve('')` 가 현재 작업 디렉터리가 되어 **저장소를 통째로 웹에
 * 내놓는다.** 여기서 걸러야 하는 것이 그 한 가지다.
 */
export function parseClientDist(raw: string | undefined): string {
  const value = raw?.trim() ?? ''
  // 상대경로로 적어도 절대경로로 만든다. 사람이 `.env` 에 `../client/dist` 를
  // 적을 때 기준으로 삼는 것은 그 서버를 띄우는 자리(cwd)다.
  return value === '' ? DEFAULT_CLIENT_DIST : resolve(value)
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
