import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PlayerState } from '@nogada/shared'
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify'
import { buildApp, type BuildAppOptions } from './app.js'
import { LOCAL_PLAYER_ID } from './state/constants.js'
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
 * 왜 모으는가: 지금 라우트 테스트 전부가 `app.inject` 를 직접 불러 암묵적으로
 * 'local' 플레이어가 된다. 계정이 들어오면(A2) 모든 요청에 `Authorization:
 * Bearer` 가 필요해지는데, 그때 서른세 개의 테스트를 각각 고치면 같은 기계적
 * 수정을 서른세 번 하고 한 번 틀린다. 신원을 여기 한 곳에 두면 그날 바뀌는
 * 파일은 이 파일 하나다 — 테스트가 확인하는 게임 동작은 손대지 않는다.
 */

/**
 * 임시 세이브 파일 위에 앱을 세운다. 임시 디렉터리는 `app.close()` 가 지운다 —
 * 테스트가 저장소 루트에 `.data/` 를 남기지 않게 하는 것이 원래 목적이었고,
 * 정리 시점을 앱 수명에 묶어 두면 테스트마다 뒷정리를 적을 필요가 없다.
 *
 * async 인 이유: 저장 계층이 비동기라 `buildApp` 이 저장소를 여는 것을 기다린다.
 * 가입·로그인이 앞에 붙는 날(A2)에도 바뀌는 것은 이 함수 안뿐이다.
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
  /**
   * 앱을 세우기 전에 세이브 파일에 **그대로** 써 넣을 내용. 스키마를 통과하지
   * 못하는 세이브 앞에서 서버가 무엇을 하는지 보려면 그런 세이브가 먼저 있어야
   * 한다.
   */
  seedRawSave?: Record<string, unknown>
}

export async function buildTestApp(options: TestAppOptions = {}): Promise<FastifyInstance> {
  const dir = mkdtempSync(join(tmpdir(), 'nogada-'))
  const dataFile = join(dir, 'players.json')
  const { waitingStore, seedRawSave, ...appOptions } = options
  if (seedRawSave) {
    // 세이브 파일에는 이제 계정·세션·캐릭터가 함께 있다. 테스트가 심는 것은
    // 캐릭터의 원본이므로, 파일의 나머지 칸은 여기서 채운다 — 그 모양을 테스트
    // 본문마다 다시 적게 하면 파일 형식이 바뀔 때마다 전부 고쳐야 한다.
    const save = { nextUserId: 1, users: {}, sessions: {}, characters: seedRawSave, owners: {} }
    writeFileSync(dataFile, JSON.stringify(save, null, 2), 'utf8')
  }

  const app = await buildApp({
    dataFile,
    ...appOptions,
    persistence:
      appOptions.persistence ??
      (waitingStore ? new WaitingStore(await JsonPersistence.open(dataFile)) : undefined),
  })
  app.addHook('onClose', async () => {
    rmSync(dir, { recursive: true, force: true })
  })
  saveFiles.set(app, dataFile)
  return app
}

const saveFiles = new WeakMap<FastifyInstance, string>()

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
   */
  readonly id: string
  /** 이 플레이어로 보내는 요청. 신원을 싣는 방법은 이 안에서만 바뀐다. */
  inject(options: InjectOptions): Promise<LightMyRequestResponse>
}

/**
 * 요청을 보낼 플레이어를 얻는다.
 *
 * 지금은 서버가 계정을 모르므로 모든 요청이 곧 `LOCAL_PLAYER_ID` 다 — 헤더 없이
 * 그냥 보낸다. A2 에서 이 함수가 가입·로그인을 수행하고 받은 토큰을 매 요청의
 * `Authorization` 헤더에 실으면, 테스트 본문은 한 줄도 바뀌지 않는다.
 */
export async function asPlayer(app: FastifyInstance): Promise<TestPlayer> {
  return {
    id: LOCAL_PLAYER_ID,
    inject: (options) => app.inject(options),
  }
}
