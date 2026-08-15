import { LoginRequestSchema, RegisterRequestSchema } from '@nogada/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { FailureBackoff, IP_BACKOFF, SIGNUP_BACKOFF, USERNAME_BACKOFF } from '../auth/rateLimit.js'
import { hashPassword, verifyAgainstNobody, verifyPassword } from '../auth/passwords.js'
import { hashToken, bearerToken, openSession } from '../auth/sessions.js'
import type { Persistence } from '../state/persistence.js'

/** 가입·로그인이 거절하는 이유들. 클라이언트가 화면을 고르는 데 쓰는 값이다. */
export const BAD_REQUEST = 'bad_request'
export const USERNAME_TAKEN = 'username_taken'
/**
 * **로그인 실패는 한 가지 답이다**(설계 규범 6).
 *
 * "없는 아이디"와 "비밀번호가 틀렸다"를 나눠 말하면, 그 둘을 세는 것만으로
 * 실재하는 아이디 목록을 만들 수 있다. 사람에게는 불친절하지만, 아이디를 아는
 * 사람에게만 불친절한 것이 아니라 모두에게 같은 만큼 불친절한 것이 요점이다.
 */
export const INVALID_CREDENTIALS = 'invalid_credentials'
export const TOO_MANY_ATTEMPTS = 'too_many_attempts'

/**
 * 게임의 문 — 가입·로그인.
 *
 * 이 둘만 인증 밖에 있다. 나머지 라우트는 전부 세션을 요구한다(app.ts).
 */
export function registerAuthRoutes(app: FastifyInstance, store: Persistence): void {
  // 리미터는 **앱마다 하나**다. 모듈 전역에 두면 테스트 하나의 실패가 다음
  // 테스트를 막고, 그런 실패는 원인을 찾는 데 반나절이 든다.
  const byIp = new FailureBackoff(IP_BACKOFF)
  const byUsername = new FailureBackoff(USERNAME_BACKOFF)
  // 가입만 세는 표가 따로 있다 — 로그인 성공이 IP 기록을 지우기 때문이다
  // (SIGNUP_BACKOFF 의 주석이 그 이유다).
  const bySignup = new FailureBackoff(SIGNUP_BACKOFF)

  app.post('/api/auth/register', async (request, reply) => {
    const parsed = RegisterRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ code: BAD_REQUEST })

    const now = Date.now()
    const ip = ipOf(request)
    const wait = Math.max(byIp.retryAfterMs(ip, now), bySignup.retryAfterMs(ip, now))
    if (wait > 0) return tooMany(reply, wait)

    // **세는 것은 아래 `await` 보다 앞이다.** 뒤에서 세면 동시에 들어온 요청이
    // 전부 위 문을 통과한 뒤 argon2 앞에 모이고, 그때까지 아무도 세지 않았으므로
    // 한 라운드가 통째로 지나간다(실측: 동시 128회가 606ms 에 128개 다 201).
    //
    // **성공해도 지우지 않는다.** 로그인과 다른 점이다 — 로그인의 성공은 "이 사람이
    // 맞다"라 세어 둔 것을 무를 이유가 되지만, 가입의 성공은 계정 하나가 실제로
    // 생겼다는 뜻이다. 세어야 하는 것이 바로 그것이다. 사람이 오타로 두어 번
    // 틀리는 것은 자유 횟수가 흡수한다.
    byIp.fail(ip, now)
    bySignup.fail(ip, now)

    const { username, password } = parsed.data
    // 해시를 먼저 만들고 넣는다. "있는지 보고 없으면 넣는다"로 쓰면 그 사이에
    // 다른 가입이 끼어들어 둘 다 통과하므로, 유일성은 저장소가 쓰는 순간
    // 판정한다 — null 이 그 답이다.
    const created = await store.createUser(username, await hashPassword(password))
    if (!created) {
      // 아이디 중복이 밖에서 보이는 것은 수용한다(설계 규범 6). 가입 화면은
      // "그 아이디는 이미 있다"를 말해야 쓸 수 있고, 그 사실은 어차피 가입을
      // 시도해 보면 알 수 있다. 그 시도는 위에서 이미 세었다.
      return reply.code(409).send({ code: USERNAME_TAKEN })
    }

    // 가입하면 곧바로 들어간다. 가입 직후 로그인 화면으로 돌려보내면 방금 적은
    // 것을 다시 적게 된다.
    return reply.code(201).send({ token: await openSession(store, created.id) })
  })

  app.post('/api/auth/login', async (request, reply) => {
    const parsed = LoginRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ code: BAD_REQUEST })

    const { username, password } = parsed.data
    const now = Date.now()
    const ip = ipOf(request)
    // 둘 중 **긴 쪽**을 기다린다. 짧은 쪽만 보면 다른 하나가 있으나 마나다.
    const wait = Math.max(byIp.retryAfterMs(ip, now), byUsername.retryAfterMs(username, now))
    if (wait > 0) return tooMany(reply, wait)

    // 검증하기 **전에** 실패로 세어 둔다 — 아래 argon2 는 수십 ms 라, 뒤에서
    // 세면 동시에 들어온 요청들이 전부 서로를 못 보고 지나간다(실측: 동시 64회가
    // 401 을 64개 받았다). 맞는 비밀번호였다면 아래에서 지운다 — 정직한 사람에게
    // 남는 것은 지금까지와 같이 아무것도 없다.
    byIp.fail(ip, now)
    byUsername.fail(username, now)

    const user = await store.findUser(username)
    // 없는 계정에도 같은 시간을 쓴다 — 응답 시간만으로 아이디의 존재를 셀 수
    // 없어야 한다(passwords.ts 의 verifyAgainstNobody 참고).
    const ok = user
      ? await verifyPassword(user.passwordHash, password)
      : await verifyAgainstNobody(password)

    // 실패는 이미 세어져 있다 — 여기서 또 세면 한 번의 시도가 두 번이 된다.
    if (!user || !ok) return reply.code(401).send({ code: INVALID_CREDENTIALS })

    byIp.clear(ip)
    byUsername.clear(username)
    return { token: await openSession(store, user.id) }
  })

  // 로그아웃은 세션 행 하나를 지우는 것이다(설계 §3). 인증 훅 밖에 두는 이유:
  // 이미 만료된 토큰으로 로그아웃하는 것이 401 이면, 클라이언트는 "지울 수도
  // 없는 토큰"을 들고 남는다. 없는 세션을 지우는 것도 결과는 같다 — 없다.
  app.post('/api/auth/logout', async (request, reply) => {
    const token = bearerToken(request.headers.authorization)
    if (token) await store.deleteSession(hashToken(token))
    return reply.code(204).send()
  })
}

/**
 * 리미터의 열쇠가 되는 IP.
 *
 * `request.ip` 는 프록시 뒤에서 프록시의 주소가 된다 — TLS 종단을 앞에 세우는
 * 날 `trustProxy` 를 실제 토폴로지에 맞춰 켜야 이 값이 다시 사람의 주소가
 * 된다(설계 규범 8).
 */
function ipOf(request: FastifyRequest): string {
  return request.ip
}

function tooMany(reply: FastifyReply, waitMs: number): FastifyReply {
  // 얼마나 기다려야 하는지는 숨기지 않는다. 모르면 클라이언트는 계속 두드리고,
  // 그 두드림이 대기를 다시 늘린다.
  return reply
    .code(429)
    .header('retry-after', String(Math.ceil(waitMs / 1000)))
    .send({ code: TOO_MANY_ATTEMPTS })
}
