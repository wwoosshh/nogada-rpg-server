import { createInitialPlayer } from './newCharacter.js'
import { START_MAP_ID } from '@nogada/data'
import { DEFAULT_APPEARANCE, type PlayerState } from '@nogada/shared'
import { describe, expect, it } from 'vitest'
import { NO_CHARACTER, applyToCharacter } from './applyToCharacter.js'
import {
  CharacterConflictError,
  Persistence,
  type CharacterVersion,
  type StoredCharacter,
  type StoredSession,
  type StoredUser,
} from './persistence.js'

/**
 * 저장 호출을 **세는** 저장소. 진짜 파일·DB 로는 셀 수 없는 것을 센다 —
 * 판정이 실패했을 때 `saveCharacter` 가 아예 안 불리는가.
 *
 * 계정·세션 쪽은 이 스위트가 안 쓰므로 던진다. 조용히 아무것도 안 하게 두면
 * 나중에 누가 그 경로를 쓰기 시작해도 이 가짜가 사실인 척 대답한다.
 */
class CountingStore extends Persistence {
  saveCalls: PlayerState[] = []
  /** 다음 saveCharacter 가 충돌로 튕길 횟수 — 재시도 경로를 시험할 때 쓴다. */
  conflictsLeft = 0
  private version = 1

  constructor(private player: PlayerState | null) {
    super()
  }

  async readCharacter(id: string): Promise<StoredCharacter | null> {
    if (!this.player || this.player.id !== id) return null
    return { player: structuredClone(this.player), version: String(this.version) }
  }

  async saveCharacter(player: PlayerState, expectedVersion?: CharacterVersion): Promise<CharacterVersion> {
    this.saveCalls.push(structuredClone(player))
    if (this.conflictsLeft > 0) {
      this.conflictsLeft -= 1
      this.version += 1
      throw new CharacterConflictError(player.id)
    }
    if (expectedVersion !== undefined && expectedVersion !== String(this.version)) {
      throw new CharacterConflictError(player.id)
    }
    this.player = structuredClone(player)
    this.version += 1
    return String(this.version)
  }

  async createUser(): Promise<StoredUser | null> {
    throw new Error('이 스위트는 계정을 안 쓴다')
  }
  async findUser(): Promise<StoredUser | null> {
    throw new Error('이 스위트는 계정을 안 쓴다')
  }
  async createSession(): Promise<void> {
    throw new Error('이 스위트는 세션을 안 쓴다')
  }
  async findSession(): Promise<StoredSession | null> {
    throw new Error('이 스위트는 세션을 안 쓴다')
  }
  async extendSession(): Promise<void> {
    throw new Error('이 스위트는 세션을 안 쓴다')
  }
  async deleteSession(): Promise<void> {
    throw new Error('이 스위트는 세션을 안 쓴다')
  }
  async deleteExpiredSessions(): Promise<void> {
    throw new Error('이 스위트는 세션을 안 쓴다')
  }
  async createCharacter(): Promise<StoredCharacter | null> {
    throw new Error('이 스위트는 캐릭터를 만들지 않는다')
  }
  async deleteCharacter(): Promise<void> {
    throw new Error('이 스위트는 캐릭터를 지우지 않는다')
  }
  async close(): Promise<void> {}
}

const 사람 = (): PlayerState =>
  createInitialPlayer({
    id: '1',
    name: '아무개',
    appearance: DEFAULT_APPEARANCE,
    village: START_MAP_ID,
  })

describe('applyToCharacter — 거절이 저장소에 닿지 못하게 막는 자리', () => {
  /**
   * **이 테스트가 서비스 넷의 "거절은 아무것도 안 바꾼다"를 통째로 진다.**
   *
   * 서비스는 판정 전에 `structuredClone` 으로 복제본을 만들므로(gatherService 등),
   * 거절 경로에서 그 복제본에 무엇을 쓰든 **서비스 쪽 테스트로는 잡히지 않는다** —
   * 인자로 건넨 객체도, 저장된 상태도 안 변하기 때문이다. 실제로 거절 줄에
   * `player.nextActionAt = now + 3000` 을 넣어 보면 서버 테스트 403개가 전부 초록이다.
   *
   * 갈리는 곳은 여기 한 줄(`if (!judged.ok) return judged`)뿐이다. 그 줄이 사라지면
   * 네 서비스의 모든 거절이 한꺼번에 상태를 쓰기 시작하고, 그 사고를 잡는 검사는
   * 이것 말고 없다.
   */
  it('판정이 실패하면 저장을 아예 시도하지 않는다', async () => {
    const store = new CountingStore(사람())

    const result = await applyToCharacter(store, '1', () => ({ ok: false, code: 'too_fast' }))

    expect(result).toEqual({ ok: false, code: 'too_fast' })
    expect(store.saveCalls).toEqual([])
  })

  it('판정이 성공하면 판정이 내놓은 그 사람을 저장한다 — 읽은 것이 아니라', async () => {
    const store = new CountingStore(사람())

    const result = await applyToCharacter(store, '1', (player) => ({
      ok: true,
      outcome: { player: { ...player, gold: player.gold + 7 } },
    }))

    if (!result.ok) throw new Error(`성공해야 한다: ${result.code}`)
    expect(store.saveCalls).toHaveLength(1)
    expect(store.saveCalls[0]!.gold).toBe(사람().gold + 7)
    expect(result.outcome.player.gold).toBe(사람().gold + 7)
  })

  /**
   * 없는 캐릭터는 판정에 **닿지도 않는다.** 판정을 부르고 나서 거르면, 판정
   * 함수가 `player` 없이 불릴 수 있다는 뜻이 되어 서비스마다 그 방어를 다시 적게 된다.
   */
  it('캐릭터가 없으면 판정을 부르지 않는다', async () => {
    const store = new CountingStore(null)
    let judged = false

    const result = await applyToCharacter(store, '1', () => {
      judged = true
      return { ok: false, code: 'too_fast' }
    })

    expect(result).toEqual({ ok: false, code: NO_CHARACTER })
    expect(judged).toBe(false)
    expect(store.saveCalls).toEqual([])
  })

  /**
   * 밀리면 **판정부터** 다시 한다. 계산만 다시 쓰면 지나간 상태 위에서 굴린
   * 주사위를 새 상태에 얹게 된다(applyToCharacter 의 주석) — 그래서 세는 것은
   * 저장 횟수가 아니라 판정 횟수다.
   */
  it('판본이 밀리면 판정부터 다시 부른다', async () => {
    const store = new CountingStore(사람())
    store.conflictsLeft = 1
    let calls = 0

    const result = await applyToCharacter(store, '1', (player) => {
      calls += 1
      return { ok: true, outcome: { player } }
    })

    expect(result.ok).toBe(true)
    expect(calls).toBe(2)
    expect(store.saveCalls).toHaveLength(2)
  })

  /** 세 번을 내리 밀리면 500 이다 — 이 상태를 200 으로 포장할 방법은 없다. */
  it('세 번을 내리 밀리면 던진다', async () => {
    const store = new CountingStore(사람())
    store.conflictsLeft = 3

    await expect(
      applyToCharacter(store, '1', (player) => ({ ok: true, outcome: { player } })),
    ).rejects.toBeInstanceOf(CharacterConflictError)
    expect(store.saveCalls).toHaveLength(3)
  })
})
