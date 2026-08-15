import { mkdirSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { PlayerState } from '@nogada/shared'
import {
  CharacterConflictError,
  Persistence,
  decodeCharacter,
  type CharacterVersion,
  type StoredCharacter,
  type StoredSession,
  type StoredUser,
} from './persistence.js'

/**
 * 세이브 파일 하나의 속 — 계정·세션·캐릭터가 **같은 파일**에 있다(설계 §2).
 *
 * 나누지 않는 이유는 이 저장소의 존재 이유 그대로다: docker 없이 게임을 켜는
 * 것. 파일 셋을 서로 맞추는 순간 그 편의가 사라지고, 셋 중 하나만 지운 사람이
 * 주인 없는 캐릭터를 만나게 된다.
 */
interface SaveFile {
  /**
   * 다음 계정에 줄 번호. Postgres 의 BIGSERIAL 을 손으로 흉내 낸다 — 계정 키가
   * 두 저장소에서 같은 성격(문자열로 다루는 증가하는 수)이어야 위에 앉은 코드가
   * 저장소를 갈아 끼워도 같은 뜻을 유지한다.
   */
  nextUserId: number
  users: Record<string, { username: string; passwordHash: string }>
  sessions: Record<string, { userId: string; expiresAt: number }>
  /**
   * 캐릭터의 **파싱하지 않은 원본**. 읽을 때마다 decodeCharacter 를 통과시키는
   * 이유가 규범이다: 형식이 맞지 않는 상태를 여는 순간 버려 버리면 그 사람의
   * 진행도가 사라진다. 원본을 쥐고 있으면 읽기가 실패해도 행이 그 자리에 남는다.
   */
  characters: Record<string, unknown>
  /**
   * 캐릭터 키 → 주인 계정 키. Postgres 의 `characters.user_id UNIQUE` 자리다.
   *
   * 이름 사본(`characters.name`)은 여기 없다. 그 칸은 사람이 DB 를 들여다볼 때
   * JSONB 를 헤집지 않으려고 두는 것인데, 이 저장소에서는 상태가 이미 눈에
   * 보이는 JSON 이라 사본이 할 일이 없다.
   */
  owners: Record<string, string>
}

/**
 * 개발 폴백 저장소 — JSON 파일 하나.
 *
 * `DATABASE_URL` 이 없으면 이것으로 돈다. docker 없이 게임을 켤 수 있어야
 * 하기 때문이고, 그것이 이 구현이 남아 있는 유일한 이유다. 프로세스 하나가
 * 파일 하나를 독점한다고 가정한다(같은 파일을 두 서버가 열면 서로의 쓰기를
 * 덮어쓴다 — 그때가 Postgres 를 쓸 때다).
 */
export class JsonPersistence extends Persistence {
  private readonly versions = new Map<string, CharacterVersion>()
  private readonly queues = new Map<string, Promise<unknown>>()
  private writing: Promise<void> = Promise.resolve()

  private constructor(
    private readonly filePath: string,
    private readonly save: SaveFile,
  ) {
    super()
  }

  static async open(filePath: string): Promise<JsonPersistence> {
    mkdirSync(dirname(filePath), { recursive: true })
    return new JsonPersistence(filePath, await readSaveFile(filePath))
  }

  async createUser(username: string, passwordHash: string): Promise<StoredUser | null> {
    // **유일성 검사가 쓰기와 같은 줄 위에 있어야 한다.** 큐 밖에서 찾아보고
    // 들어오면 그 사이에 다른 가입이 끼어들어 같은 아이디가 둘 생긴다 —
    // Postgres 의 UNIQUE 제약이 하는 일을 여기서는 이 직렬화가 한다.
    return this.enqueue(ACCOUNTS, async () => {
      if (this.findUserEntry(username)) return null

      const id = String(this.save.nextUserId)
      this.save.nextUserId += 1
      this.save.users[id] = { username, passwordHash }
      await this.persist()
      return { id, username, passwordHash }
    })
  }

  async findUser(username: string): Promise<StoredUser | null> {
    const found = this.findUserEntry(username)
    return found ? { id: found[0], ...found[1] } : null
  }

  async createSession(tokenHash: string, userId: string, expiresAt: number): Promise<void> {
    await this.enqueue(ACCOUNTS, async () => {
      this.save.sessions[tokenHash] = { userId, expiresAt }
      await this.persist()
    })
  }

  async findSession(tokenHash: string): Promise<StoredSession | null> {
    const session = this.save.sessions[tokenHash]
    return session ? { ...session } : null
  }

  async extendSession(tokenHash: string, expiresAt: number): Promise<void> {
    await this.enqueue(ACCOUNTS, async () => {
      const session = this.save.sessions[tokenHash]
      // 없는 세션이면 아무 일도 하지 않는다 — 방금 로그아웃한 사람의 요청이
      // 여기 닿을 수 있고, 그것이 세션을 되살리면 로그아웃이 거짓이 된다.
      if (!session) return
      session.expiresAt = expiresAt
      await this.persist()
    })
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.enqueue(ACCOUNTS, async () => {
      delete this.save.sessions[tokenHash]
      await this.persist()
    })
  }

  async deleteExpiredSessions(userId: string, now: number): Promise<void> {
    await this.enqueue(ACCOUNTS, async () => {
      let removed = false
      for (const [tokenHash, session] of Object.entries(this.save.sessions)) {
        if (session.userId !== userId || session.expiresAt > now) continue
        delete this.save.sessions[tokenHash]
        removed = true
      }
      // 지운 것이 없으면 파일을 다시 쓰지 않는다. 이 메서드는 로그인마다 불리는데,
      // 대개는 지울 것이 없다 — 그때마다 세이브 전체를 다시 쓰면 청소가 아니라 비용이다.
      if (removed) await this.persist()
    })
  }

  async createCharacter(userId: string, player: PlayerState): Promise<StoredCharacter | null> {
    // 계정 큐 위에서 만든다 — "이 계정이 이미 캐릭터를 가졌는가"는 캐릭터 하나가
    // 아니라 표 전체에 걸친 사실이라, 캐릭터별 큐로는 두 요청을 세울 수 없다.
    return this.enqueue(ACCOUNTS, async () => {
      const taken =
        Object.hasOwn(this.save.characters, player.id) ||
        Object.values(this.save.owners).includes(userId)
      if (taken) return null

      const version = this.bump(player.id)
      this.save.characters[player.id] = structuredClone(player)
      this.save.owners[player.id] = userId
      await this.persist()
      return { player: decodeCharacter(player.id, this.save.characters[player.id]), version }
    })
  }

  async deleteCharacter(id: string): Promise<void> {
    await this.enqueue(ACCOUNTS, async () => {
      delete this.save.characters[id]
      delete this.save.owners[id]
      // 판본은 지우지 않는다. 같은 키로 다시 만든 캐릭터가 지워진 캐릭터의
      // 판본을 물려받으면, 그 사이에 읽어 둔 옛 판본으로 저장이 통과한다.
      this.bump(id)
      await this.persist()
    })
  }

  async readCharacter(id: string): Promise<StoredCharacter | null> {
    if (!Object.hasOwn(this.save.characters, id)) return null
    return {
      player: decodeCharacter(id, this.save.characters[id]),
      version: this.versionOf(id),
    }
  }

  async saveCharacter(
    player: PlayerState,
    expectedVersion?: CharacterVersion,
  ): Promise<CharacterVersion> {
    // **캐릭터별 직렬화 큐.** 판본을 견주는 것과 실제로 쓰는 것 사이에 await 가
    // 있으면(파일 쓰기는 비동기다) 두 저장이 나란히 같은 판본을 보고 둘 다
    // 통과한다 — 낙관적 잠금이 이름만 남는다. 견주기부터 쓰기까지를 한 줄로
    // 세워야 그 검사가 실제로 무엇을 막는다.
    return this.enqueue(`character:${player.id}`, async () => {
      const exists = Object.hasOwn(this.save.characters, player.id)
      // 없는 캐릭터는 여기서 생기지 않는다 — 만드는 곳은 createCharacter 하나다.
      if (!exists) throw new CharacterConflictError(player.id)
      if (expectedVersion !== undefined && expectedVersion !== this.versionOf(player.id)) {
        throw new CharacterConflictError(player.id)
      }

      const next = this.bump(player.id)
      this.save.characters[player.id] = structuredClone(player)
      await this.persist()
      return next
    })
  }

  async close(): Promise<void> {
    // 쓰다 만 파일을 남기지 않는다. 열어 둔 자원은 없다.
    await this.writing
  }

  private findUserEntry(
    username: string,
  ): [string, { username: string; passwordHash: string }] | undefined {
    // 정규화는 부르는 쪽이 이미 했다 — 여기서 또 하면 규칙을 아는 곳이 둘이 된다.
    return Object.entries(this.save.users).find(([, user]) => user.username === username)
  }

  private versionOf(id: string): CharacterVersion {
    return this.versions.get(id) ?? '1'
  }

  /** 판본은 저장마다 반드시 달라져야 한다 — 같은 값이 두 번 나오면 지나간 판본이 통과한다. */
  private bump(id: string): CharacterVersion {
    const next = String(Number(this.versionOf(id)) + 1)
    this.versions.set(id, next)
    return next
  }

  private enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve()
    // 앞 작업의 실패가 뒤를 막지 않도록 성공·실패 양쪽에서 이어 붙인다.
    const next = previous.then(task, task)
    this.queues.set(
      key,
      next.catch(() => undefined),
    )
    return next
  }

  /**
   * 파일 쓰기는 캐릭터를 가리지 않고 한 줄로 세운다.
   *
   * 파일에는 계정도 세션도 모든 캐릭터도 함께 들어 있어서, 둘이 나란히 쓰면
   * 늦게 시작한 쪽이 먼저 끝나는 순간 한쪽 변경이 파일에서 사라진다. 직렬화하고
   * **자기 차례에** 현재 내용을 문자열로 만들면 마지막 쓰기가 항상 전부를 담는다.
   */
  private persist(): Promise<void> {
    this.writing = this.writing.then(async () => {
      await writeFile(this.filePath, JSON.stringify(this.save, null, 2), 'utf8')
    })
    return this.writing
  }
}

/** 계정·세션·캐릭터 생성이 서로를 밀어내지 않게 한 줄로 세우는 큐의 이름. */
const ACCOUNTS = 'accounts'

function emptySave(): SaveFile {
  // 1 부터 준다 — BIGSERIAL 과 같은 자리에서 시작해야 두 저장소의 키가 같은
  // 모양이 된다(0 은 "없음"으로 읽히기 쉽다).
  return { nextUserId: 1, users: {}, sessions: {}, characters: {}, owners: {} }
}

/**
 * 저장 파일을 읽는다. 파일이 없으면 빈 저장소로 시작한다.
 *
 * 파일 자체가 JSON 으로 깨졌다면 그것은 **행 하나의 문제가 아니라 파일 전체의
 * 문제**라 여기서 던진다. 조용히 빈 저장소로 시작하면 그 순간 모든 캐릭터가
 * 없는 것이 되고, 첫 저장이 깨진 파일을 덮어써 되살릴 길이 사라진다.
 */
async function readSaveFile(filePath: string): Promise<SaveFile> {
  let text: string
  try {
    text = await readFile(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptySave()
    throw error
  }

  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`세이브 파일 ${filePath} 이 저장소 모양이 아니다`)
  }

  const save = parsed as Partial<SaveFile>
  if (!save.characters) {
    // 계정 이전의 파일은 캐릭터 표 하나였다. 그 세이브는 이관하지 않고 폐기하기로
    // 정했고(설계 규범 15), 여기서 조용히 빈 저장소로 시작하면 첫 저장이 그
    // 파일을 덮어써 되돌릴 수 없게 된다 — 지우는 것은 사람이 정할 일이다.
    throw new Error(
      `세이브 파일 ${filePath} 은 계정이 생기기 전의 개발 세이브다 — 이관하지 않는다(설계 규범 15). ` +
        `그 파일을 지우면 새 저장소로 시작한다`,
    )
  }

  return { ...emptySave(), ...save }
}
