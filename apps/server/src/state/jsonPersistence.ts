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
} from './persistence.js'

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

  /**
   * `characters` 는 **파싱하지 않은 원본**을 그대로 들고 있다. 읽을 때마다
   * decodeCharacter 를 통과시키는 이유가 규범이다: 형식이 맞지 않는 상태를 여는
   * 순간 버려 버리면 그 사람의 진행도가 사라진다. 원본을 쥐고 있으면 읽기가
   * 실패해도 행이 그 자리에 남는다.
   */
  private constructor(
    private readonly filePath: string,
    private readonly characters: Record<string, unknown>,
  ) {
    super()
  }

  static async open(filePath: string): Promise<JsonPersistence> {
    mkdirSync(dirname(filePath), { recursive: true })
    return new JsonPersistence(filePath, await readCharacterFile(filePath))
  }

  async readCharacter(id: string): Promise<StoredCharacter | null> {
    if (!Object.hasOwn(this.characters, id)) return null
    return {
      player: decodeCharacter(id, this.characters[id]),
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
    return this.enqueue(player.id, async () => {
      const current = this.versionOf(player.id)
      const exists = Object.hasOwn(this.characters, player.id)
      if (expectedVersion !== undefined && (!exists || expectedVersion !== current)) {
        throw new CharacterConflictError(player.id)
      }

      // 판본은 저장마다 반드시 달라져야 한다 — 같은 값이 두 번 나오면 지나간
      // 판본으로 쓰는 요청이 통과한다.
      const next = String(Number(current) + 1)
      this.characters[player.id] = structuredClone(player)
      this.versions.set(player.id, next)
      await this.persist()
      return next
    })
  }

  async close(): Promise<void> {
    // 쓰다 만 파일을 남기지 않는다. 열어 둔 자원은 없다.
    await this.writing
  }

  private versionOf(id: string): CharacterVersion {
    return this.versions.get(id) ?? '1'
  }

  private enqueue<T>(id: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(id) ?? Promise.resolve()
    // 앞 작업의 실패가 뒤를 막지 않도록 성공·실패 양쪽에서 이어 붙인다.
    const next = previous.then(task, task)
    this.queues.set(
      id,
      next.catch(() => undefined),
    )
    return next
  }

  /**
   * 파일 쓰기는 캐릭터를 가리지 않고 한 줄로 세운다.
   *
   * 파일에는 모든 캐릭터가 함께 들어 있어서, 두 캐릭터의 저장이 나란히 쓰면
   * 늦게 시작한 쪽이 먼저 끝나는 순간 한쪽 변경이 파일에서 사라진다. 직렬화하고
   * **자기 차례에** 현재 맵을 문자열로 만들면 마지막 쓰기가 항상 전부를 담는다.
   */
  private persist(): Promise<void> {
    this.writing = this.writing.then(async () => {
      await writeFile(this.filePath, JSON.stringify(this.characters, null, 2), 'utf8')
    })
    return this.writing
  }
}

/**
 * 저장 파일을 읽는다. 파일이 없으면 빈 저장소로 시작한다.
 *
 * 파일 자체가 JSON 으로 깨졌다면 그것은 **행 하나의 문제가 아니라 파일 전체의
 * 문제**라 여기서 던진다. 조용히 빈 저장소로 시작하면 그 순간 모든 캐릭터가
 * 없는 것이 되고, 첫 저장이 깨진 파일을 덮어써 되살릴 길이 사라진다.
 */
async function readCharacterFile(filePath: string): Promise<Record<string, unknown>> {
  let text: string
  try {
    text = await readFile(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }

  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`세이브 파일 ${filePath} 이 캐릭터 표가 아니다`)
  }
  return parsed as Record<string, unknown>
}
