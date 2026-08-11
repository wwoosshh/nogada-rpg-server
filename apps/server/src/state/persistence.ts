import { loadGameData, startLocation } from '@nogada/data'
import { PlayerStateSchema, resolvePlayerLocation, type PlayerState } from '@nogada/shared'

/**
 * 캐릭터 저장 계층 — 구현 둘(JSON 파일 · PostgreSQL)이 지키는 하나의 계약.
 *
 * 왜 비동기인가: 저장소가 다른 프로세스로 나가는 순간 읽기와 쓰기 사이에 다른
 * 요청이 끼어들 수 있다. 그 틈을 인정하는 것이 이 인터페이스의 존재 이유다 —
 * 아래 `expectedVersion` 이 없으면 두 채집이 같은 상태를 읽고 하나가 다른
 * 하나를 덮어써서, 캔 광석이 조용히 사라진다.
 */

/**
 * 저장된 판본. **속은 구현이 정한다** — Postgres 는 `updated_at`, JSON 은 세는 수.
 * 부르는 쪽은 읽을 때 받은 값을 저장할 때 되돌려주기만 한다.
 */
export type CharacterVersion = string

/** 읽어 온 캐릭터와 그것을 읽은 판본. 저장할 때 이 판본을 돌려줘야 덮어쓰기를 막는다. */
export interface StoredCharacter {
  player: PlayerState
  version: CharacterVersion
}

/**
 * 저장된 상태를 읽을 수 없다.
 *
 * **행은 지우지 않는다.** 지금까지의 JSON 저장소는 형식이 맞지 않는 세이브를
 * 조용히 버리고 새 플레이어를 만들어 줬다(store.ts 주석이 "실제 유저 데이터가
 * 생기기 전에 이 결정을 뒤집어야 한다"고 예고한 그 동작이다). 개발용 세이브
 * 하나뿐일 때는 편했지만, 남의 진행도에 대해서는 그것이 곧 삭제다. 이제는
 * 읽기가 실패로 끝나고(라우트에서 500), 행은 그 자리에 남아 사람이 본다.
 */
export class CharacterStateError extends Error {
  constructor(
    readonly characterId: string,
    readonly detail: string,
  ) {
    super(`캐릭터 "${characterId}" 의 저장된 상태를 읽을 수 없다: ${detail}`)
    this.name = 'CharacterStateError'
  }
}

/**
 * 내가 읽은 판본이 이미 지나갔다 — 그 사이 다른 요청이 저장했다.
 *
 * 이 오류가 없으면 lost update 다: 두 요청이 같은 상태를 읽고 각자 계산한 뒤
 * 나중에 쓴 쪽이 먼저 쓴 쪽의 결과를 통째로 지운다. 부르는 쪽은 계산을 버리고
 * 다시 읽어야 한다(applyToCharacter 참고).
 */
export class CharacterConflictError extends Error {
  constructor(readonly characterId: string) {
    super(`캐릭터 "${characterId}" 가 그 사이 바뀌었다`)
    this.name = 'CharacterConflictError'
  }
}

export abstract class Persistence {
  /** 캐릭터와 판본을 함께 읽는다. 없으면 null. */
  abstract readCharacter(id: string): Promise<StoredCharacter | null>

  /**
   * 캐릭터를 쓴다. `expectedVersion` 을 주면 **그 판본일 때만** 쓰고, 아니면
   * `CharacterConflictError` 를 던진다. 새 판본을 돌려준다.
   */
  abstract saveCharacter(
    player: PlayerState,
    expectedVersion?: CharacterVersion,
  ): Promise<CharacterVersion>

  /** 저장소를 닫는다(풀 드레인). 서버가 SIGTERM 을 받으면 여기까지 온다. */
  abstract close(): Promise<void>

  /**
   * 판본이 필요 없는 읽기 — 그냥 보여 주기만 할 때(GET /api/state).
   *
   * **없으면 null 이다.** 예전 저장소는 없는 id 를 물으면 새 플레이어를 지어내
   * 돌려줬는데, 그러면 오타 난 id 하나가 빈 캐릭터를 낳는다. 캐릭터를 만드는
   * 곳은 캐릭터 생성 API 하나뿐이어야 한다.
   */
  async getCharacter(id: string): Promise<PlayerState | null> {
    return (await this.readCharacter(id))?.player ?? null
  }
}

/**
 * 저장된 무엇을 `PlayerState` 로 읽는다 — **구현 둘이 같은 이 함수를 쓴다.**
 *
 * 읽기 계약이 여기 다 있다:
 * 1. `PlayerStateSchema`(zod)가 진실의 원본이다. 기본값이 옛 세이브를 살린다 —
 *    없던 필드가 생겨도 그 세이브를 통째로 버리지 않는다.
 * 2. 파싱이 실패하면 던진다. 버리지 않는다(CharacterStateError 참고).
 * 3. 없어진 맵을 가리키는 자리는 시작 자리로 되돌린다. 세이브는 남는데 콘텐츠는
 *    계속 바뀌므로, 보정하지 않으면 클라이언트가 없는 맵을 404 로 받고 검은
 *    화면에서 죽는다 — 게임 안에서 빠져나올 방법이 없다.
 * 4. `id` 는 **행의 키**로 도장 찍는다. 상태 안의 id 와 행의 키가 어긋나면
 *    "누구의 상태인가"에 답이 둘이 되고, 저장이 엉뚱한 행으로 간다.
 */
export function decodeCharacter(id: string, raw: unknown): PlayerState {
  const result = PlayerStateSchema.safeParse(raw)
  if (!result.success) {
    throw new CharacterStateError(
      id,
      result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
    )
  }

  const data = loadGameData()
  const location = resolvePlayerLocation(data, result.data.location, startLocation(data))
  if (location !== result.data.location) {
    console.warn(
      `캐릭터 "${id}" 가 지금 없는 자리(${result.data.location.mapId} ` +
        `${result.data.location.x}, ${result.data.location.y})에 있어 시작 지점으로 되돌린다`,
    )
  }

  return { ...result.data, location, id }
}
