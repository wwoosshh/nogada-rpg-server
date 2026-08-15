import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { START_MAP_ID, loadGameData, startVillages } from '@nogada/data'
import { APPEARANCES, DEFAULT_APPEARANCE, type PlayerState } from '@nogada/shared'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { IP_BACKOFF, SIGNUP_BACKOFF } from './auth/rateLimit.js'
import { hashToken } from './auth/sessions.js'
import { JsonPersistence } from './state/jsonPersistence.js'
import { asPlayer, buildTestApp, type TestPlayer } from './testSupport.js'

/**
 * 게임의 문 — 가입·로그인·세션, 그리고 캐릭터의 일생.
 *
 * app.test.ts 가 "무엇을 할 수 있는가"를 본다면 여기는 "누구인가"를 본다.
 * 둘을 나누는 이유는 앞의 스위트가 신원을 헬퍼에 맡기고 게임 동작만 보게
 * 하려는 것이고(testSupport 참고), 그 헬퍼가 감춘 것을 여기서 직접 두드린다.
 */

const credentials = { username: '노가다꾼', password: 'nogada-password' }

const register = (
  app: FastifyInstance,
  payload: Record<string, unknown> = credentials,
  ip?: string,
) => app.inject({ method: 'POST', url: '/api/auth/register', payload, ...(ip ? { remoteAddress: ip } : {}) })

/** 아이디만 다른 가입 요청. 셈이 걸리는 것이 아이디가 아니라 IP 임을 분명히 한다. */
const signup = (app: FastifyInstance, n: number, ip: string) =>
  register(app, { username: `사람${n}`, password: credentials.password }, ip)

const login = (app: FastifyInstance, payload: Record<string, unknown> = credentials, ip?: string) =>
  app.inject({ method: 'POST', url: '/api/auth/login', payload, ...(ip ? { remoteAddress: ip } : {}) })

const withToken = (app: FastifyInstance, token: string, url = '/api/state') =>
  app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } })

describe('POST /api/auth/register', () => {
  it('가입하면 곧바로 들어갈 토큰을 준다 — 방금 적은 것을 다시 적게 하지 않는다', async () => {
    const app = await buildTestApp()

    const res = await register(app)

    expect(res.statusCode).toBe(201)
    const { token } = res.json() as { token: string }
    expect(token.length).toBeGreaterThan(20)
    // 그 토큰이 실제로 문을 연다. 토큰 모양만 보면 아무 문자열이나 통과한다.
    expect((await withToken(app, token, '/api/me')).statusCode).toBe(200)

    await app.close()
  })

  // 왜: 아이디 중복이 밖에서 보이는 것은 수용한다(설계 규범 6) — 가입 화면은
  //     그것을 말해 줘야 쓸 수 있다. 대신 409 라는 분명한 답이어야 한다:
  //     200 으로 삼키면 남의 계정에 들어갔다고 착각하게 된다.
  it('이미 있는 아이디는 409 다 — 먼저 가입한 사람의 비밀번호를 덮지 않는다', async () => {
    const app = await buildTestApp()
    await register(app)

    const again = await register(app, { ...credentials, password: '남의비밀번호를넣는다' })

    expect(again.statusCode).toBe(409)
    expect(again.json()).toEqual({ code: 'username_taken' })
    // 원래 비밀번호가 그대로 통한다 — 덮였다면 가입 요청 하나로 계정을 빼앗는 길이다.
    expect((await login(app)).statusCode).toBe(200)

    await app.close()
  })

  // 왜: 정규화하지 않으면 눈에 똑같은 아이디 둘이 서로 다른 계정이 되고,
  //     "노가다꾼" 으로 가입한 사람이 " 노가다꾼 " 을 남에게 뺏긴다.
  it('공백·대소문자만 다른 아이디는 같은 아이디다', async () => {
    const app = await buildTestApp()
    await register(app, { username: 'Nogada', password: credentials.password })

    const res = await register(app, { username: '  nogada  ', password: credentials.password })

    expect(res.statusCode).toBe(409)
    await app.close()
  })

  // 왜: 리미터가 실패만 세던 시절, 가입 성공은 아무 데도 안 세였다. 같은 IP 로
  //     순차 60회를 시도해도 429 가 하나도 안 나왔다 — 아이디만 바꾸면 한 IP 가
  //     계정을 무한히 열 수 있었다는 뜻이다. 공개된 주소에서 그것은 몇 분 만에
  //     찾아온다.
  //     그리고 **경계를 정확히 못 박는다.** 오래 이 검사가 "앞의 다섯은 201 이고
  //     어딘가에 429 가 있다"까지만 재서, 여섯 번째가 열리는 줄을 아무도 안 쟀다.
  //     그 빈자리에 산문 둘이 "5개까지, 6번째부터"라고 적혀 있었고(런북 2장과
  //     rateLimit.ts) 실측은 **6개까지, 7번째부터**였다 — 자유 횟수보다 하나 많은
  //     이유는 부르는 쪽이 `retryAfterMs` 를 먼저 보고 그 뒤에 `fail` 하기
  //     때문이다(routes/auth.ts). 그 산문이 "공개해도 되는가"의 근거라 한 칸이
  //     값비싸고, 그래서 여기서 숫자를 정확히 세운다.
  it('가입은 성공해도 세어진다 — 한 IP 가 계정을 무한히 열지 못한다', async () => {
    const app = await buildTestApp()
    const attempts = SIGNUP_BACKOFF.freeAttempts + 4

    const codes: number[] = []
    const responses = []
    for (let i = 0; i < attempts; i += 1) {
      const res = await signup(app, i, '10.9.9.9')
      codes.push(res.statusCode)
      responses.push(res)
    }

    // 자유 횟수 **+ 1** 개가 열린다. 사람이 가입 화면에서 두어 번 틀리는 것까지
    // 막으면 안 되고, 그 하나가 더 열리는 것은 문을 지나고 나서 세기 때문이다.
    const 열린수 = SIGNUP_BACKOFF.freeAttempts + 1
    expect(codes.slice(0, 열린수)).toEqual(Array(열린수).fill(201))
    // 그리고 그 다음부터는 전부 막힌다 — "어딘가에 429 가 있다"가 아니다.
    expect(codes.slice(열린수)).toEqual(Array(attempts - 열린수).fill(429))
    // 런북이 "5초 대기가 배증한다"고 적는 그 첫 5초.
    expect(responses[열린수]!.headers['retry-after']).toBe(
      String(SIGNUP_BACKOFF.baseDelayMs / 1000),
    )

    await app.close()
  })

  // 왜: **이 회귀 검사는 반드시 동시여야 한다.** 순차로 쓰면 이 버그가 다시
  //     들어와도 초록이다 — 게이트가 `확인 → await hashPassword(argon2, 수십 ms)
  //     → 셈` 순서일 때, 동시에 들어온 요청은 전부 아무도 아직 세지 않은 표를
  //     보고 통과한다. 리미터가 세는 것이 "시도 횟수"가 아니라 "왕복 라운드
  //     수"가 되는 것이고, 실측으로 동시 128회가 606ms 에 128개 다 201 을 받았다.
  it('동시에 쏟아진 가입은 한 라운드가 통째로 통과하지 못한다', async () => {
    const app = await buildTestApp()
    const burst = 32

    const codes = (
      await Promise.all(Array.from({ length: burst }, (_, i) => signup(app, i, '10.9.9.8')))
    ).map((res) => res.statusCode)

    expect(codes.filter((code) => code === 429).length).toBeGreaterThan(0)
    // 자유 횟수를 넘겨 만들어진 계정이 있으면 안 된다. 문을 지난 요청 하나가
    // 곧바로 세므로, 한 번에 통과하는 것은 자유 횟수 + 그 문턱의 하나뿐이다.
    expect(codes.filter((code) => code === 201).length).toBeLessThanOrEqual(
      SIGNUP_BACKOFF.freeAttempts + 1,
    )

    await app.close()
  })

  // 왜: 가입 표(SIGNUP_BACKOFF)와 별개로 가입 시도는 그 IP 의 셈에도 들어가야
  //     한다. 스캐너는 가입과 로그인을 섞어 두드리는데, 둘이 서로의 셈을 모르면
  //     한쪽을 자유 횟수 직전까지 쓰고 다른 쪽으로 넘어가는 것이 공짜가 된다.
  it('가입 시도는 그 IP 의 로그인 셈에도 들어간다', async () => {
    const app = await buildTestApp()
    const ip = '10.9.9.7'
    for (let i = 0; i < SIGNUP_BACKOFF.freeAttempts; i += 1) {
      expect((await signup(app, i, ip)).statusCode).toBe(201)
    }

    // 아이디를 매번 바꾼다 — 계정별 셈이 아니라 IP 셈만 남기려는 것이다. 가입이
    // 세어졌다면 이 여섯 번째에서 IP 의 자유 횟수를 넘긴다.
    const remaining = IP_BACKOFF.freeAttempts - SIGNUP_BACKOFF.freeAttempts + 1
    for (let i = 0; i < remaining; i += 1) {
      const res = await login(app, { username: `없는사람${i}`, password: credentials.password }, ip)
      expect(res.statusCode).toBe(401)
    }

    expect((await login(app, { username: '또다른사람', password: credentials.password }, ip)).statusCode).toBe(429)

    await app.close()
  })

  it('규칙에 어긋나는 아이디·비밀번호는 400 이다', async () => {
    const app = await buildTestApp()

    expect((await register(app, { username: 'no gada', password: 'goodpassword' })).statusCode).toBe(400)
    expect((await register(app, { username: '노가다꾼', password: '짧다' })).statusCode).toBe(400)
    expect((await register(app, {})).statusCode).toBe(400)

    await app.close()
  })
})

describe('POST /api/auth/login', () => {
  it('가입한 계정으로 다시 들어간다', async () => {
    const app = await buildTestApp()
    await register(app)

    const res = await login(app)

    expect(res.statusCode).toBe(200)
    expect((await withToken(app, (res.json() as { token: string }).token, '/api/me')).statusCode).toBe(200)

    await app.close()
  })

  // 왜: 이것이 열거를 막는 유일한 장치다(설계 규범 6). "없는 아이디"와
  //     "비밀번호가 틀렸다"를 나눠 말하면 그 둘을 세는 것만으로 실재하는 아이디
  //     목록을 만들 수 있고, 그다음은 그 목록에만 힘을 쓰면 된다.
  it('없는 계정과 틀린 비밀번호가 똑같은 답을 받는다', async () => {
    const app = await buildTestApp()
    await register(app)

    const wrongPassword = await login(app, { ...credentials, password: '틀린비밀번호' })
    const noSuchUser = await login(app, { username: '없는사람', password: credentials.password })

    expect(wrongPassword.statusCode).toBe(401)
    expect(noSuchUser.statusCode).toBe(noSuchUser.statusCode)
    expect(noSuchUser.statusCode).toBe(401)
    expect(noSuchUser.json()).toEqual(wrongPassword.json())
    expect(wrongPassword.json()).toEqual({ code: 'invalid_credentials' })

    await app.close()
  })

  it('대소문자를 다르게 적어도 같은 계정으로 들어간다', async () => {
    const app = await buildTestApp()
    await register(app, { username: 'Nogada', password: credentials.password })

    expect((await login(app, { username: 'NOGADA', password: credentials.password })).statusCode).toBe(200)

    await app.close()
  })

  // 왜: 아이디만 세면 IP 를 바꿔 가며 한 계정을 두드리는 것을 못 막는다는 것의
  //     반대편이다 — IP 만 세면 아이디를 바꿔 가며 흔한 비밀번호 하나를 전수로
  //     시도하는 것을 못 막는다. 그래서 둘 다 센다(설계 규범 6).
  it('IP 를 바꿔 가며 한 계정을 두드리면 그 계정이 잠긴다', async () => {
    const app = await buildTestApp()
    await register(app)

    // 아이디당 자유 횟수(5)를 넘겨 실패시킨다. IP 는 매번 다르므로 IP 백오프는
    // 걸리지 않는다 — 잠기는 것은 계정 쪽이다.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const res = await login(app, { ...credentials, password: '틀린비밀번호' }, `10.0.0.${attempt}`)
      expect(res.statusCode).toBe(401)
    }

    const blocked = await login(app, credentials, '10.0.0.99')

    // **맞는 비밀번호도 막힌다.** 검사가 비밀번호 검증보다 앞에 있다는 뜻이고,
    // 그래야 대기가 실제로 추측 속도를 늦춘다.
    expect(blocked.statusCode).toBe(429)
    expect(blocked.json()).toEqual({ code: 'too_many_attempts' })
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0)

    await app.close()
  })

  // 왜: 아이디를 바꿔 가며 두드리면 계정별 기록에는 아무것도 쌓이지 않는다.
  //     IP 쪽 기록이 없으면 그 공격은 아무 저항도 받지 않는다.
  it('아이디를 바꿔 가며 두드리면 그 IP 가 잠긴다', async () => {
    const app = await buildTestApp()

    for (let attempt = 0; attempt < 11; attempt += 1) {
      const res = await login(app, { username: `사람${attempt}`, password: credentials.password }, '10.1.1.1')
      expect(res.statusCode).toBe(401)
    }

    const blocked = await login(app, { username: '또다른사람', password: credentials.password }, '10.1.1.1')
    expect(blocked.statusCode).toBe(429)

    // 다른 IP 는 멀쩡하다 — 한 사람이 두드려서 온 세상이 잠기면 안 된다.
    expect((await login(app, credentials, '10.2.2.2')).statusCode).toBe(401)

    await app.close()
  })

  // 왜: 위의 두 검사는 **순차**라 이 버그를 못 잡는다. 검증(argon2)이 수십 ms 인
  //     동안 셈이 뒤에 있으면, 동시에 들어온 요청들은 서로를 보지 못한 채 한
  //     라운드가 통째로 지나간다 — 실측으로 동시 64회가 401 을 64개 받았다.
  //     추측을 늦추는 것이 이 장치의 전부인데, 한 번에 64개를 시험할 수 있으면
  //     늦춰지는 것은 아무것도 없다.
  it('동시에 쏟아진 로그인 실패도 세어진다 — 한 라운드가 통째로 지나가지 못한다', async () => {
    const app = await buildTestApp()
    const burst = 32

    // 아이디를 매번 바꾼다 — 계정 쪽 셈이 아니라 IP 쪽 셈이 이것을 막아야 한다.
    const codes = (
      await Promise.all(
        Array.from({ length: burst }, (_, i) =>
          login(app, { username: `사람${i}`, password: credentials.password }, '10.3.3.3'),
        ),
      )
    ).map((res) => res.statusCode)

    expect(codes.filter((code) => code === 429).length).toBeGreaterThan(0)
    // 문을 지난 요청이 곧바로 세므로 한 번에 시험되는 것은 자유 횟수 + 하나다.
    expect(codes.filter((code) => code === 401).length).toBeLessThanOrEqual(
      IP_BACKOFF.freeAttempts + 1,
    )

    await app.close()
  })
})

describe('세션', () => {
  /** 세션의 만료를 손으로 옮기려면 저장소 손잡이가 필요하다 — 시계를 기다릴 수는 없다. */
  let dir: string
  let store: JsonPersistence

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'nogada-'))
    store = await JsonPersistence.open(join(dir, 'players.json'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('토큰 없이 게임 라우트를 부르면 401 이다', async () => {
    const app = await buildTestApp()

    for (const url of ['/api/state', '/api/me']) {
      const res = await app.inject({ method: 'GET', url })
      expect(res.statusCode, url).toBe(401)
      expect(res.json()).toEqual({ code: 'unauthorized' })
    }
    const gather = await app.inject({ method: 'POST', url: '/api/gather', payload: { instanceId: 'copper_vein-1' } })
    expect(gather.statusCode).toBe(401)

    await app.close()
  })

  it('아무 문자열이나 토큰이 되지 않는다', async () => {
    const app = await buildTestApp()
    await asPlayer(app)

    expect((await withToken(app, '아무거나')).statusCode).toBe(401)
    // 모양이 틀린 헤더도 마찬가지다.
    const wrongScheme = await app.inject({
      method: 'GET',
      url: '/api/state',
      headers: { authorization: '노가다꾼' },
    })
    expect(wrongScheme.statusCode).toBe(401)

    await app.close()
  })

  it('로그아웃한 토큰은 더 이상 열지 못한다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app)

    const out = await me.inject({ method: 'POST', url: '/api/auth/logout' })
    expect(out.statusCode).toBe(204)

    expect((await me.inject({ method: 'GET', url: '/api/state' })).statusCode).toBe(401)

    await app.close()
  })

  // 왜: 이미 만료된 토큰으로 로그아웃하는 것이 401 이면, 클라이언트는 "지울
  //     수도 없는 토큰"을 들고 남는다. 결과는 어느 쪽이든 같다 — 그 세션은 없다.
  it('토큰 없이 로그아웃해도 오류가 아니다', async () => {
    const app = await buildTestApp()

    expect((await app.inject({ method: 'POST', url: '/api/auth/logout' })).statusCode).toBe(204)

    await app.close()
  })

  it('만료된 세션은 401 이고, 그 자리에서 지워진다', async () => {
    const app = await buildTestApp({ persistence: store })
    const me = await asPlayer(app)
    const tokenHash = hashToken(me.token)

    await store.extendSession(tokenHash, Date.now() - 1)

    expect((await me.inject({ method: 'GET', url: '/api/state' })).statusCode).toBe(401)
    // 남겨 두면 아무도 못 쓰는 행이 계정마다 쌓이고, 청소를 도는 일이 하나 더 생긴다.
    expect(await store.findSession(tokenHash)).toBeNull()

    await app.close()
  })

  // 왜: 30일이 지나면 게임 도중에 갑자기 로그아웃된다. 그렇다고 요청마다 미루면
  //     채집 한 번에 세션 표 쓰기가 하나씩 더 붙는다 — 이레 남았을 때만 미룬다
  //     (설계 규범 5).
  it('남은 기간이 이레보다 적으면 요청 하나가 세션을 미룬다', async () => {
    const app = await buildTestApp({ persistence: store })
    const me = await asPlayer(app)
    const tokenHash = hashToken(me.token)
    const day = 24 * 60 * 60 * 1000
    await store.extendSession(tokenHash, Date.now() + 3 * day)

    await me.inject({ method: 'GET', url: '/api/state' })

    expect((await store.findSession(tokenHash))?.expiresAt).toBeGreaterThan(Date.now() + 29 * day)

    await app.close()
  })

  it('넉넉히 남았으면 아무것도 쓰지 않는다', async () => {
    const app = await buildTestApp({ persistence: store })
    const me = await asPlayer(app)
    const tokenHash = hashToken(me.token)
    const far = Date.now() + 20 * 24 * 60 * 60 * 1000
    await store.extendSession(tokenHash, far)

    await me.inject({ method: 'GET', url: '/api/state' })

    expect((await store.findSession(tokenHash))?.expiresAt).toBe(far)

    await app.close()
  })

  // 왜: 만료된 세션은 그 토큰이 다시 제시될 때 지워진다 — 그러니 누수는 "영구
  //     누적"이 아니라 **다시 안 돌아오는 기기의 행**이다. 아무도 그 토큰을 들고
  //     오지 않으므로 아무도 그것을 지우지 않는다. 청소를 도는 주체를 세우는
  //     대신(이 저장소는 그래서 만료 타이머를 피해 왔다) 이미 쓰기가 일어나는
  //     자리에 얹는다: 그 사람이 다시 로그인할 때.
  it('새 세션을 열면 그 계정의 만료된 세션이 함께 사라진다', async () => {
    const app = await buildTestApp({ persistence: store })
    const me = await asPlayer(app, { username: credentials.username, password: credentials.password })
    const stale = hashToken(me.token)
    // 그 기기는 다시 돌아오지 않는다 — 만료만 지나 있고 아무도 제시하지 않는다.
    await store.extendSession(stale, Date.now() - 1)

    const again = await login(app)
    expect(again.statusCode).toBe(200)

    expect(await store.findSession(stale)).toBeNull()
    // 방금 연 세션은 멀쩡하다 — 청소가 지금 들어온 사람을 끊으면 로그인이 아니다.
    expect(await store.findSession(hashToken((again.json() as { token: string }).token))).not.toBeNull()

    await app.close()
  })

  // 왜: 토큰이 그대로 저장되면 DB 백업 한 부가 남의 계정 열쇠 꾸러미가 된다
  //     (설계 규범 5). 세션 표에는 sha256 만 있어야 한다.
  it('저장소에는 토큰이 아니라 그 해시가 남는다', async () => {
    const app = await buildTestApp({ persistence: store })
    const me = await asPlayer(app)

    expect(await store.findSession(me.token)).toBeNull()
    expect(await store.findSession(hashToken(me.token))).not.toBeNull()

    await app.close()
  })

  it('인증이 필요 없는 문도 있다 — 서버가 살아 있는가와 지금 몇 시인가', async () => {
    const app = await buildTestApp()

    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/api/time' })).statusCode).toBe(200)

    await app.close()
  })
})

describe('캐릭터의 일생', () => {
  const spawnOf = (mapId: string) => {
    const map = loadGameData().maps[mapId]
    if (!map) throw new Error(`맵 "${mapId}" 이 없다`)
    return { mapId, x: map.spawn.x, y: map.spawn.y }
  }

  const create = (me: TestPlayer, payload: Record<string, unknown>) =>
    me.inject({ method: 'POST', url: '/api/me/character', payload })

  // 왜: 캐릭터가 없다는 것은 오류가 아니라 "이제 만들 차례"라는 화면 분기다
  //     (설계 §5). 404 로 답하면 클라이언트가 서버 고장과 구별할 수 없다.
  it('가입만 한 사람의 /api/me 는 character: null 이다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app, { withoutCharacter: true })

    const res = await me.inject({ method: 'GET', url: '/api/me' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ character: null })

    await app.close()
  })

  // 왜: 게임 라우트는 다르다 — 캐릭터 없이 채집할 수는 없고, 그 사실을 200 으로
  //     포장하면 클라이언트가 없는 상태 위에 화면을 그린다.
  it('캐릭터 없이 게임 라우트를 부르면 404 no_character 다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app, { withoutCharacter: true })

    for (const request of [
      { method: 'GET' as const, url: '/api/state' },
      { method: 'POST' as const, url: '/api/gather', payload: { instanceId: 'copper_vein-1' } },
    ]) {
      const res = await me.inject(request)
      expect(res.statusCode, request.url).toBe(404)
      expect(res.json()).toEqual({ code: 'no_character' })
    }

    await app.close()
  })

  it('고른 이름·외형으로, 고른 마을의 spawn 에서 시작한다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app, { withoutCharacter: true })
    // 시작 맵이 아닌 마을을 고른다 — 무엇을 고르든 같은 자리에 서면 고르게 한
    // 것이 거짓이다.
    const village = startVillages(loadGameData()).find((map) => map.id !== START_MAP_ID)!

    // 기본값이 아닌 외형을 고른다 — 기본값으로 시험하면 "고른 것이 저장됐다"와
    // "아무것도 안 하고 기본값이 남았다"가 같은 결과라 구별되지 않는다. 목록에서
    // 골라 오므로 외형 목록이 바뀌어도 이 시험은 그대로 산다.
    const look = APPEARANCES.find((id) => id !== DEFAULT_APPEARANCE)!
    const res = await create(me, { name: '노가다', appearance: look, village: village.id })

    expect(res.statusCode).toBe(201)
    const { player } = res.json() as { player: PlayerState }
    expect(player.name).toBe('노가다')
    expect(player.appearance).toBe(look)
    expect(player.location).toEqual(spawnOf(village.id))
    // 만든 것이 곧 다음 부팅의 상태여야 한다.
    expect((await me.inject({ method: 'GET', url: '/api/state' })).json()).toEqual({ player })

    await app.close()
  })

  // 왜: 이중 제출은 버튼을 두 번 누르거나 느린 네트워크가 요청을 다시 보내면
  //     생긴다. 그때 오류를 돌려주면 이미 만들어진 자기 캐릭터를 두고 실패
  //     화면을 보게 되고, 새로 만들어 주면 방금까지의 진행도가 사라진다.
  it('두 번 제출해도 캐릭터는 하나다 — 진행도를 덮지 않고 있는 것을 돌려준다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app)
    // 조금이라도 놀아 둔다. 두 번째 제출이 상태를 덮으면 이 흔적이 사라진다.
    await me.inject({ method: 'POST', url: '/api/move', payload: { x: 0, y: 0 } })
    const before = (await me.inject({ method: 'GET', url: '/api/state' })).json() as { player: PlayerState }

    const again = await create(me, {
      name: '다른이름',
      appearance: APPEARANCES.find((id) => id !== DEFAULT_APPEARANCE)!,
      village: START_MAP_ID,
    })

    expect(again.statusCode).toBe(200)
    expect((again.json() as { player: PlayerState }).player).toEqual(before.player)

    await app.close()
  })

  // 왜: 마을 목록은 데이터가 정한다(startVillages). 채집장이나 개발용 시험장에서
  //     시작할 수 있으면 "시작 마을 = 첫 숙련도" 설계가 무너진다.
  it('마을이 아닌 맵으로는 시작할 수 없다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app, { withoutCharacter: true })
    const villages = new Set(startVillages(loadGameData()).map((map) => map.id))
    const notVillage = Object.keys(loadGameData().maps).find((id) => !villages.has(id))!

    for (const village of [notVillage, '없는마을']) {
      const res = await create(me, { name: '노가다', appearance: DEFAULT_APPEARANCE, village })
      expect(res.statusCode, village).toBe(400)
      expect(res.json()).toEqual({ code: 'unknown_village' })
    }
    expect((await me.inject({ method: 'GET', url: '/api/me' })).json()).toEqual({ character: null })

    await app.close()
  })

  it('목록에 없는 외형과 너무 짧은 이름은 거절한다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app, { withoutCharacter: true })

    const badLook = await create(me, { name: '노가다', appearance: '고질라', village: START_MAP_ID })
    const shortName = await create(me, { name: '한', appearance: DEFAULT_APPEARANCE, village: START_MAP_ID })

    expect(badLook.statusCode).toBe(400)
    expect(shortName.statusCode).toBe(400)

    await app.close()
  })

  // 왜: 슬롯이 하나뿐이라 삭제가 없으면 잘못 고른 외형·마을이 영구히 갇힌다
  //     (설계 규범 7).
  it('이름을 정확히 적으면 지워지고, 그 계정으로 다시 만들 수 있다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app, { name: '노가다' })

    const deleted = await me.inject({
      method: 'DELETE',
      url: '/api/me/character',
      payload: { confirmName: '노가다' },
    })

    expect(deleted.statusCode).toBe(204)
    expect((await me.inject({ method: 'GET', url: '/api/me' })).json()).toEqual({ character: null })
    // 계정까지 버리게 하지 않는다 — 다시 만들면 그 사람으로 계속한다.
    const reborn = await create(me, { name: '다시', appearance: DEFAULT_APPEARANCE, village: START_MAP_ID })
    expect(reborn.statusCode).toBe(201)
    expect((reborn.json() as { player: PlayerState }).player.name).toBe('다시')

    await app.close()
  })

  // 왜: 버튼 하나로 지우면 수십 시간이 오타 하나에 사라진다. 이름을 적게 하는
  //     것이 그 둘 사이의 답이고, 그러려면 틀린 이름은 반드시 막아야 한다.
  it('이름이 틀리면 지우지 않는다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app, { name: '노가다' })

    const res = await me.inject({
      method: 'DELETE',
      url: '/api/me/character',
      payload: { confirmName: '노가다꾼' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ code: 'name_mismatch' })
    expect((await me.inject({ method: 'GET', url: '/api/state' })).statusCode).toBe(200)

    await app.close()
  })

  it('없는 캐릭터를 지우려 하면 404 다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app, { withoutCharacter: true })

    const res = await me.inject({
      method: 'DELETE',
      url: '/api/me/character',
      payload: { confirmName: '아무개' },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ code: 'no_character' })

    await app.close()
  })

  // 왜: 설계의 성공 기준 3 이다 — 한 서버에서 두 계정이 서로 다른 진행도로
  //     공존해야 한다. 'local' 하나를 보던 시절에는 두 사람이 같은 캐릭터를
  //     나눠 쓰고 있었고, 그 사실을 어떤 테스트도 잡지 못했다.
  it('두 계정이 서로 다른 캐릭터로 공존한다', async () => {
    const app = await buildTestApp()
    const one = await asPlayer(app, { name: '첫사람' })
    const other = await asPlayer(app, { name: '둘째' })

    expect(one.id).not.toBe(other.id)

    // 한쪽만 움직인다.
    const transition = loadGameData().transitions.find((t) => t.fromMap === START_MAP_ID)!
    const moved = await one.inject({
      method: 'POST',
      url: '/api/move',
      payload: { x: transition.fromX, y: transition.fromY },
    })
    expect(moved.statusCode).toBe(200)

    const mine = (await one.inject({ method: 'GET', url: '/api/state' })).json() as { player: PlayerState }
    const theirs = (await other.inject({ method: 'GET', url: '/api/state' })).json() as { player: PlayerState }

    expect(mine.player.location.mapId).toBe(transition.toMap)
    expect(theirs.player.location).toEqual(spawnOf(START_MAP_ID))
    expect(theirs.player.name).toBe('둘째')

    await app.close()
  })

  // 왜: 가입이 성공해도 IP 별로 세어진 뒤, asPlayer 가 전부 기본 IP 로 가입하면
  //     한 앱에서 **일곱 번째**가 429 로 터졌다(실측: 6개까지 되고 7번째에서
  //     "가입하지 못했다: 429"). 리미터를 앱마다 두는 이유가 "테스트 하나의
  //     실패가 다음 테스트를 막고, 그런 실패는 원인을 찾는 데 반나절이 든다"
  //     인데(routes/auth.ts), 그 함정이 한 앱 **안에서** 다시 생긴 것이다.
  //     거래·프레즌스처럼 여러 사람이 필요한 검사가 오기 전에 자를 대 둔다.
  it('한 앱에 자유 횟수보다 많은 사람을 앉혀도 리미터에 걸리지 않는다', async () => {
    const app = await buildTestApp()
    const crowd = SIGNUP_BACKOFF.freeAttempts + 3

    const players: TestPlayer[] = []
    for (let i = 0; i < crowd; i += 1) players.push(await asPlayer(app, { name: `사람${i}` }))

    // 사람마다 다른 기계에서 들어온다는 것이 이것이 되는 이유다 — 같은 IP 라면
    // 여섯 번째까지만 서고 나머지는 429 다.
    expect(new Set(players.map((one) => one.id)).size).toBe(crowd)
    expect((await players[crowd - 1]!.inject({ method: 'GET', url: '/api/state' })).statusCode).toBe(200)

    await app.close()
  })
})
