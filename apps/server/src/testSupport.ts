import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { START_MAP_ID } from '@nogada/data'
import { DEFAULT_APPEARANCE, type PlayerState } from '@nogada/shared'
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify'
import { buildApp, type BuildAppOptions } from './app.js'
import { JsonPersistence } from './state/jsonPersistence.js'
import {
  Persistence,
  type CharacterVersion,
  type StoredCharacter,
  type StoredSession,
  type StoredUser,
} from './state/persistence.js'

/**
 * 서버 테스트가 **앱을 어떻게 세우고 누구로 요청하는가**를 정하는 한 곳.
 *
 * 왜 모으는가: 라우트 테스트 전부가 `app.inject` 를 직접 부르던 시절에는 모든
 * 요청이 암묵적으로 'local' 플레이어였다. 계정이 들어오면서 모든 요청에
 * `Authorization: Bearer` 가 필요해졌는데, 그때 서른세 개의 테스트를 각각
 * 고쳤다면 같은 기계적 수정을 서른세 번 하고 한 번 틀렸을 것이다. 신원이 여기
 * 한 곳에 있어서 그날 바뀐 파일은 이 파일 하나다 — 테스트가 확인하는 게임
 * 동작은 한 줄도 손대지 않았다.
 */

/**
 * 임시 세이브 파일 위에 앱을 세운다. 임시 디렉터리는 `app.close()` 가 지운다 —
 * 테스트가 저장소 루트에 `.data/` 를 남기지 않게 하는 것이 원래 목적이었고,
 * 정리 시점을 앱 수명에 묶어 두면 테스트마다 뒷정리를 적을 필요가 없다.
 */
export interface TestAppOptions extends BuildAppOptions {
  /**
   * 저장소를 **프로세스 밖에 있는 것처럼** 감싼다 — 호출마다 진짜로 한 턴 기다린다.
   *
   * 왜 필요한가: JSON 파일 저장소는 읽기가 메모리라 `읽기 → 판정 → 쓰기` 사이에
   * 다른 요청이 끼어들 틈이 사실상 없다. 그 틈은 저장소가 Postgres 로 나가는
   * 순간 열리는데, 그때 깨지는 것을 지금 잡을 수 없다면 동시성은 시험되지 않은
   * 것이다. 기다리는 저장소를 앉혀 두면 그 틈이 매번 열린다.
   */
  waitingStore?: boolean
}

export async function buildTestApp(options: TestAppOptions = {}): Promise<FastifyInstance> {
  const { waitingStore, ...appOptions } = options
  // 세이브 파일을 밖에서 주면 그 파일 위에 세운다 — **그리고 지우지 않는다.**
  // 같은 파일 위에 앱을 다시 세우는 테스트가 있고(캐릭터 행을 손으로 갈아 끼운
  // 뒤 다시 읽히는지 보는 테스트), 앱을 닫을 때마다 지우면 그것이 불가능하다.
  const own = appOptions.dataFile === undefined
  const dir = own ? mkdtempSync(join(tmpdir(), 'nogada-')) : undefined
  const dataFile = appOptions.dataFile ?? join(dir!, 'players.json')

  const app = await buildApp({
    ...appOptions,
    dataFile,
    // 테스트는 조용하다. `NODE_ENV=test` 일 때 parseLogger 도 끄지만, 그것은
    // vitest 가 그 변수를 놓아 준다는 가정 위에 서 있다 — 테스트가 시끄러워지는
    // 조건이 실행 환경에 달려 있으면 안 되므로 여기서 한 번 더 못 박는다.
    // 로그를 시험하는 테스트만 `logger` 를 직접 준다.
    logger: appOptions.logger ?? false,
    persistence:
      appOptions.persistence ??
      (waitingStore ? new WaitingStore(await JsonPersistence.open(dataFile)) : undefined),
  })
  if (dir) {
    app.addHook('onClose', async () => {
      rmSync(dir, { recursive: true, force: true })
    })
  }
  saveFiles.set(app, dataFile)
  return app
}

const saveFiles = new WeakMap<FastifyInstance, string>()

/** 이 앱이 쓰는 세이브 파일의 경로. 같은 파일 위에 앱을 다시 세울 때 쓴다. */
export function saveFileOf(app: FastifyInstance): string {
  const file = saveFiles.get(app)
  if (!file) throw new Error('buildTestApp 으로 세운 앱이 아니다')
  return file
}

/**
 * 세이브 파일의 캐릭터 행 하나를 **그대로** 갈아 끼운다.
 *
 * 스키마를 통과하지 못하는 세이브 앞에서 서버가 무엇을 하는지 보려면 그런 행이
 * 먼저 있어야 한다. 앱을 세우기 전에 심을 수 없는 이유는 캐릭터 키를 이제
 * 가입이 발급하기 때문이다 — 누가 될지는 가입해 봐야 안다.
 */
export function writeRawCharacter(file: string, id: string, raw: unknown): void {
  const save = JSON.parse(readFileSync(file, 'utf8')) as { characters: Record<string, unknown> }
  save.characters[id] = raw
  writeFileSync(file, JSON.stringify(save, null, 2), 'utf8')
}

/**
 * 이 앱의 세이브 파일에 **지금 실제로** 들어 있는 캐릭터 원본들. 행이 남았는지
 * 보려면 파일을 봐야 한다.
 *
 * 파일에는 계정·세션도 함께 들어 있지만 여기서는 캐릭터 칸만 꺼낸다 — 테스트가
 * 묻는 것은 언제나 "그 캐릭터의 행이 어떻게 됐는가"다.
 */
export function rawSaveOf(app: FastifyInstance): Record<string, unknown> {
  const file = saveFiles.get(app)
  if (!file) throw new Error('buildTestApp 으로 세운 앱이 아니다')
  const save = JSON.parse(readFileSync(file, 'utf8')) as { characters?: Record<string, unknown> }
  return save.characters ?? {}
}

/**
 * 진짜 저장소를 그대로 쓰되 매 호출 앞에 한 턴을 넣는다. 저장 규칙을 다시
 * 구현하지 않는 것이 요점이다 — 흉내 낸 저장소는 계약에서 조용히 어긋난다.
 */
class WaitingStore extends Persistence {
  constructor(private readonly inner: Persistence) {
    super()
  }

  private static tick(): Promise<void> {
    // setImmediate 는 마이크로태스크가 아니라 이벤트 루프의 한 바퀴다 — 그래야
    // 다른 요청의 핸들러가 실제로 그 사이에 들어온다.
    return new Promise((resolve) => setImmediate(resolve))
  }

  async readCharacter(id: string): Promise<StoredCharacter | null> {
    await WaitingStore.tick()
    return this.inner.readCharacter(id)
  }

  async saveCharacter(player: PlayerState, expectedVersion?: CharacterVersion): Promise<CharacterVersion> {
    await WaitingStore.tick()
    return this.inner.saveCharacter(player, expectedVersion)
  }

  async createUser(username: string, passwordHash: string): Promise<StoredUser | null> {
    await WaitingStore.tick()
    return this.inner.createUser(username, passwordHash)
  }

  async findUser(username: string): Promise<StoredUser | null> {
    await WaitingStore.tick()
    return this.inner.findUser(username)
  }

  async createSession(tokenHash: string, userId: string, expiresAt: number): Promise<void> {
    await WaitingStore.tick()
    return this.inner.createSession(tokenHash, userId, expiresAt)
  }

  async findSession(tokenHash: string): Promise<StoredSession | null> {
    await WaitingStore.tick()
    return this.inner.findSession(tokenHash)
  }

  async extendSession(tokenHash: string, expiresAt: number): Promise<void> {
    await WaitingStore.tick()
    return this.inner.extendSession(tokenHash, expiresAt)
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await WaitingStore.tick()
    return this.inner.deleteSession(tokenHash)
  }

  async deleteExpiredSessions(userId: string, now: number): Promise<void> {
    await WaitingStore.tick()
    return this.inner.deleteExpiredSessions(userId, now)
  }

  async createCharacter(userId: string, player: PlayerState): Promise<StoredCharacter | null> {
    await WaitingStore.tick()
    return this.inner.createCharacter(userId, player)
  }

  async deleteCharacter(id: string): Promise<void> {
    await WaitingStore.tick()
    return this.inner.deleteCharacter(id)
  }

  async close(): Promise<void> {
    return this.inner.close()
  }
}

/** 테스트가 "이 사람으로" 요청을 보내는 손잡이. */
export interface TestPlayer {
  /**
   * 이 플레이어의 캐릭터 id. 응답 안의 id 를 단정할 때 쓴다 — 글자로 'local' 을
   * 적어 두면 계정이 들어와 id 가 달라지는 날 그 단정이 조용히 거짓이 된다.
   * 캐릭터를 만들지 않은 플레이어는 빈 문자열이다(아직 아무 행도 없다).
   */
  readonly id: string
  /** 이 사람의 캐릭터 이름. 삭제 확인처럼 이름을 되짚는 요청이 쓴다. */
  readonly name: string
  /** 세션 토큰. 같은 사람으로 다른 앱에 다시 앉을 때 쓴다(`resume`). */
  readonly token: string
  /** 이 플레이어로 보내는 요청. 신원을 싣는 방법은 이 안에서만 바뀐다. */
  inject(options: InjectOptions): Promise<LightMyRequestResponse>
}

export interface AsPlayerOptions {
  /** 아이디를 지목한다. 생략하면 앱 안에서 겹치지 않는 것을 짓는다. */
  username?: string
  password?: string
  name?: string
  appearance?: string
  /** 어느 마을에서 시작하는가. 생략하면 시작 맵이다 — 기존 테스트가 그 자리를 가정한다. */
  village?: string
  /** 계정만 열고 캐릭터는 만들지 않는다. "캐릭터 없는 사람"이 무엇을 보는지 시험할 때. */
  withoutCharacter?: boolean
  /**
   * 이미 있는 사람으로 **다시 앉는다** — 가입하지 않고 그 토큰을 그대로 쓴다.
   * 같은 세이브 파일 위에 앱을 다시 세운 뒤 "그 사람"으로 이어 물으려면 필요하다.
   */
  resume?: TestPlayer
}

/** 한 앱 안에서 아이디가 겹치지 않게 하는 번호. 겹치면 두 번째 가입이 409 다. */
let accountSeq = 0

/**
 * 이 플레이어가 앉은 기계의 주소 — **사람마다 다르다.**
 *
 * 가입은 성공해도 IP 별로 세어지므로(auth/rateLimit.ts), 전부 기본 IP 로
 * 가입하면 한 앱에서 일곱 번째 asPlayer 가 429 로 터진다(실측: 6개까지 되고
 * 7번째에서 예외). 그러면 실패한 것은 리미터인데 화면에는 "가입하지 못했다"만
 * 남아, 원인을 찾는 데 반나절이 든다 — 리미터를 앱마다 두는 이유(routes/auth.ts)
 * 와 같은 함정이 한 앱 안에서 다시 생기는 것이다. 거래·프레즌스처럼 여러 사람이
 * 필요한 검사가 곧 온다.
 *
 * 리미터를 직접 시험하는 auth.test.ts 는 자기 IP 를 명시하므로 영향이 없다.
 * 10.77 대역을 쓰는 이유도 그것이다 — 그쪽이 쓰는 10.0/10.1/10.2/10.3/10.9 와
 * 겹치지 않아야 한 앱 안에서 서로의 셈을 흩지 않는다.
 */
const machineOf = (seq: number): string => `10.77.${Math.floor(seq / 254) % 254}.${(seq % 254) + 1}`

/**
 * 요청을 보낼 플레이어를 얻는다 — **가입하고, 로그인하고, 캐릭터를 만든다.**
 *
 * 테스트 본문이 이 셋을 각자 적지 않는 것이 이 함수의 존재 이유다. 신원을 싣는
 * 방법(`Authorization: Bearer`)도, 캐릭터가 어디서 시작하는지도 여기서만 정한다.
 */
export async function asPlayer(
  app: FastifyInstance,
  options: AsPlayerOptions = {},
): Promise<TestPlayer> {
  if (options.resume) {
    const { id, name, token } = options.resume
    return { id, name, token, inject: bearerInject(app, token) }
  }

  accountSeq += 1
  const username = options.username ?? `테스터${accountSeq}`
  const password = options.password ?? 'nogada-password'
  const name = options.name ?? '아무개'
  const remoteAddress = machineOf(accountSeq)

  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password },
    remoteAddress,
  })
  if (registered.statusCode !== 201) {
    throw new Error(`가입하지 못했다: ${registered.statusCode} ${registered.body}`)
  }

  // 가입이 준 토큰을 그냥 쓰지 않고 한 번 더 로그인하는 이유: 테스트마다 로그인
  // 경로가 실제로 열려 있는지 확인하게 된다. 가입만 통과하고 로그인이 깨진
  // 서버는 새 사람만 받고 돌아온 사람은 못 받는 서버다.
  const loggedIn = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password },
    remoteAddress,
  })
  if (loggedIn.statusCode !== 200) {
    throw new Error(`로그인하지 못했다: ${loggedIn.statusCode} ${loggedIn.body}`)
  }
  const token = (loggedIn.json() as { token: string }).token
  const inject = bearerInject(app, token)

  if (options.withoutCharacter) return { id: '', name, token, inject }

  const created = await inject({
    method: 'POST',
    url: '/api/me/character',
    payload: {
      name,
      appearance: options.appearance ?? DEFAULT_APPEARANCE,
      // 시작 맵을 기본으로 두는 이유: 기존 테스트들이 "새 플레이어는 시작 맵에
      // 서 있다"를 딛고 서서 전환표를 밟는다(app.test.ts 의 enterField).
      village: options.village ?? START_MAP_ID,
    },
  })
  if (created.statusCode !== 201) {
    throw new Error(`캐릭터를 만들지 못했다: ${created.statusCode} ${created.body}`)
  }

  return { id: (created.json() as { player: PlayerState }).player.id, name, token, inject }
}

function bearerInject(
  app: FastifyInstance,
  token: string,
): (options: InjectOptions) => Promise<LightMyRequestResponse> {
  return (options) =>
    app.inject({
      ...options,
      // 테스트가 직접 준 헤더를 덮지 않는다 — 잘못된 토큰을 일부러 싣는 테스트가 있다.
      headers: { authorization: `Bearer ${token}`, ...options.headers },
    })
}
