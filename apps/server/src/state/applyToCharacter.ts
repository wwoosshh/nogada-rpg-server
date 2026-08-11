import type { PlayerState } from '@nogada/shared'
import { CharacterConflictError, type Persistence } from './persistence.js'

/**
 * 판정 하나가 내놓는 것 — 서비스 넷(채집·제작·대화·이동)이 모두 이 모양이다.
 */
export type Judgement<TOutcome, TCode extends string> =
  | { ok: true; outcome: TOutcome }
  | { ok: false; code: TCode }

/** 캐릭터가 없다. 계정이 오기 전에는 부팅 관문이 만들어 주므로 실전에서는 보기 어렵다. */
export const NO_CHARACTER = 'no_character'

/**
 * 몇 번까지 다시 읽는가. 한 캐릭터를 동시에 조작하는 것은 같은 사람의 손가락
 * 둘뿐이라(같은 계정의 두 창) 한 번만 밀려도 대개 끝난다. 그래도 0 이면
 * 두 번째 손가락이 이유 없이 500 을 본다.
 */
const MAX_ATTEMPTS = 3

/**
 * 읽고 → 판정하고 → **내가 읽은 판본일 때만** 쓴다. 판본이 어긋났으면 계산을
 * 버리고 처음부터 다시 읽는다.
 *
 * **왜 이것이 필요한가:** 저장이 비동기가 된 순간 `읽기 → 판정 → 쓰기` 사이에
 * 다른 요청이 통째로 끼어들 수 있다. 두 채집 요청이 같은 상태를 읽으면 둘 다
 * "간격이 지났다"고 판정하고, 나중에 쓴 쪽이 먼저 쓴 쪽의 결과를 덮는다 —
 * 광석 하나와 숙련도 한 줌이 아무 오류 없이 사라진다. 판본을 견주면 늦은 쪽은
 * 다시 읽고, 그때는 자기 눈으로 "방금 캤다"를 보게 된다(too_fast).
 *
 * `judge` 를 매 시도마다 다시 부르는 것이 요점이다. 판정에 쓰는 시각과 난수는
 * 그 안에서 새로 만들어야 한다 — 지나간 상태 위에서 굴린 주사위를 새 상태에
 * 얹으면 그것이야말로 조용한 거짓말이다.
 */
export async function applyToCharacter<TOutcome extends { player: PlayerState }, TCode extends string>(
  store: Persistence,
  id: string,
  judge: (player: PlayerState) => Judgement<TOutcome, TCode>,
): Promise<Judgement<TOutcome, TCode | typeof NO_CHARACTER>> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const stored = await store.readCharacter(id)
    if (!stored) return { ok: false, code: NO_CHARACTER }

    const judged = judge(stored.player)
    if (!judged.ok) return judged

    try {
      await store.saveCharacter(judged.outcome.player, stored.version)
      return judged
    } catch (error) {
      if (!(error instanceof CharacterConflictError)) throw error
    }
  }

  // 세 번을 내리 밀렸다. 이 상태를 200 으로 포장할 방법은 없다 — 라우트가 500 으로 올린다.
  throw new CharacterConflictError(id)
}
