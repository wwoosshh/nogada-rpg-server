import { runStoryHook, startVillages } from '@nogada/data'
import {
  CreateCharacterRequestSchema,
  DeleteCharacterRequestSchema,
  normalizeDisplayName,
  type GameData,
  type PlayerState,
} from '@nogada/shared'
import type { FastifyInstance } from 'fastify'
import { requireAccount } from '../auth/sessions.js'
import { NO_CHARACTER, applyToCharacter } from '../state/applyToCharacter.js'
import { createInitialPlayer } from '../state/newCharacter.js'
import type { Persistence } from '../state/persistence.js'
import { BAD_REQUEST } from './auth.js'

/** 고를 수 없는 마을을 골랐다. 어떤 마을이 있는지는 콘텐츠가 정한다. */
export const UNKNOWN_VILLAGE = 'unknown_village'
/** 지울 캐릭터의 이름을 잘못 적었다. */
export const NAME_MISMATCH = 'name_mismatch'

/**
 * 내 캐릭터 — 있는지 묻고, 만들고, 지운다.
 *
 * 세션이 이미 "누구인가"에 답했으므로 이 라우트들은 캐릭터 키를 받지 않는다.
 * 받게 하는 순간 남의 캐릭터를 지목할 수 있는 길이 열린다.
 */
export function registerMeRoutes(app: FastifyInstance, store: Persistence, data: GameData): void {
  app.get('/api/me', async (request) => {
    const { characterId } = requireAccount(request)
    // **없으면 null 이다** — 404 가 아니다. 캐릭터가 없다는 것은 오류가 아니라
    // "이제 캐릭터를 만들 차례"라는 화면 분기다(설계 §5).
    return { character: await store.getCharacter(characterId) }
  })

  /**
   * **세계에 들어선다** — 캐릭터를 주기 전에 사슬을 지금 상태에 맞춘다(설계 ⑦).
   *
   * 왜 문이 하나 더 필요한가: 밀어올림(`catchUp`)은 「첫 판정 훅이 돌 때」 돈다
   * (설계 ⑦). 그 규칙만으로는 **화면이 먼저 뜬다** — 얼음 200,000 인 테스터가
   * 게임을 켜면 세이브의 `story` 는 아직 0 이고, 헤더 밑 띠(설계 ⑧-6)가 그 0 을
   * 읽어 「눈의 마을 북문으로 나가라」를 적는다. 첫 채집·제작·헌납·전환 전까지
   * 그대로 남고, 마을 안에서만 서성이는 사람은 계속 본다(이동 훅은 걸음마다가
   * 아니라 **전환**에서만 돈다). 설계 ⑧ 실기 확인 1번이 「띠가 안 뜬다」로 정한
   * 바로 그 자리다.
   *
   * **`GET /api/me`·`GET /api/state` 에 얹지 않는 이유**는 설계 ⑦ 이 「접속 시
   * 재판정」을 기각한 그 이유 그대로다 — 읽기 라우트가 세이브를 쓰면 안 된다.
   * 그래서 읽기는 읽기로 두고, 들어서는 순간을 **쓰기 문 하나**로 세운다.
   *
   * **로그인에 얹지 않는 이유**(검토가 권한 자리다): 이 게임의 토큰은 30일이라
   * 돌아오는 사람은 `POST /api/auth/login` 을 안 지난다 — 클라이언트는 저장된
   * 토큰으로 곧장 「이어서 하기」로 들어간다(gameStore.connect). 가입·로그인·
   * 이어서 하기 셋이 **모두** 지나는 자리는 캐릭터를 받아 오는 이 한 곳뿐이다.
   *
   * `event: null` 이라 사건은 하나도 안 세고, 도는 것은 밀어올림과 상태로 끝나는
   * 마디(`reach`)뿐이다(advanceStory 의 drift). 문턱이 전부 단조 지표라
   * (StoryCatchUp) 두 번째 부름부터는 아무것도 안 바꾼다.
   *
   * 캐릭터가 없으면 **404 가 아니라 `character: null`** 이다 — `GET /api/me` 와
   * 같은 답이라야 부팅이 한 번의 왕복으로 "만들 차례" 를 알 수 있다.
   */
  app.post('/api/me/enter', async (request) => {
    const { characterId } = requireAccount(request)
    const entered = await applyToCharacter<{ player: PlayerState }, never>(
      store,
      characterId,
      (stored) => {
        // 서비스 넷과 같은 자세다: 사본을 밀고, 밀어올림에는 **손대기 전**의 그
        // 사람을 준다(AdvanceStoryArgs.before). 여기서는 둘이 같은 상태이지만
        // 자리를 바꿔 넣어도 타입이 안 짖으므로 규칙 쪽을 따른다.
        const player = structuredClone(stored)
        runStoryHook({ data, player, before: stored, event: null })
        return { ok: true, outcome: { player } }
      },
    )
    return { character: entered.ok ? entered.outcome.player : null }
  })

  app.post('/api/me/character', async (request, reply) => {
    const parsed = CreateCharacterRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ code: BAD_REQUEST })

    // 고를 수 있는 마을은 **데이터가 정한다**(startVillages). 서버에 마을 이름을
    // 적으면 마을을 하나 더 그리는 날 그 목록이 따라오지 않는다.
    const village = startVillages(data).find((map) => map.id === parsed.data.village)
    if (!village) return reply.code(400).send({ code: UNKNOWN_VILLAGE })

    const { userId, characterId } = requireAccount(request)
    const player = createInitialPlayer({
      id: characterId,
      name: parsed.data.name,
      appearance: parsed.data.appearance,
      village: village.id,
    })

    const created = await store.createCharacter(userId, player)
    if (created) return reply.code(201).send({ player: created.player })

    // 만들지 못했다 = 이미 있다. **이중 제출을 자연스럽게 처리한다**(설계 규범 6):
    // 버튼을 두 번 눌렀거나 느린 네트워크가 요청을 다시 보냈을 때, 오류를
    // 돌려주면 이미 만들어진 자기 캐릭터를 두고 실패 화면을 보게 된다.
    const existing = await store.getCharacter(characterId)
    // 여기서 null 이면 캐릭터 키를 짓는 규칙과 저장소의 제약이 어긋난 것이다
    // (characterKey 참고) — 조용히 200 으로 덮을 수 없는 자료 불일치다.
    if (!existing) throw new Error(`계정 "${userId}" 이 캐릭터를 가졌는데 "${characterId}" 로 찾을 수 없다`)
    return { player: existing }
  })

  app.delete('/api/me/character', async (request, reply) => {
    const parsed = DeleteCharacterRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ code: BAD_REQUEST })

    const { characterId } = requireAccount(request)
    // 읽을 수 없는 캐릭터는 여기서 500 이 되고 지워지지 않는다 — 이름을 견줄 수
    // 없기 때문이다. 그것이 맞다: 읽지 못하는 상태를 지우는 것은 삭제가 아니라
    // 증거 인멸이고, 그 행은 사람이 볼 몫이다(persistence.ts 의 CharacterStateError).
    const existing = await store.getCharacter(characterId)
    if (!existing) return reply.code(404).send({ code: NO_CHARACTER })

    // 이름을 직접 타이핑하게 한다(설계 규범 7). 정규화는 만들 때와 같은 함수를
    // 쓴다 — 다르면 자기 캐릭터 이름을 정확히 적고도 지우지 못한다.
    if (normalizeDisplayName(parsed.data.confirmName) !== existing.name) {
      return reply.code(400).send({ code: NAME_MISMATCH })
    }

    await store.deleteCharacter(characterId)
    // 계정은 남는다. 잘못 고른 외형·마을 때문에 계정까지 버리게 하지 않는다.
    return reply.code(204).send()
  })
}
