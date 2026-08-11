import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { START_MAP_ID, loadGameData, startVillages } from '@nogada/data'
import { APPEARANCES, DEFAULT_APPEARANCE, type PlayerState } from '@nogada/shared'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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

const register = (app: FastifyInstance, payload: Record<string, unknown> = credentials) =>
  app.inject({ method: 'POST', url: '/api/auth/register', payload })

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
})
