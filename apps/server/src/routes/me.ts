import { startVillages } from '@nogada/data'
import {
  CreateCharacterRequestSchema,
  DeleteCharacterRequestSchema,
  normalizeDisplayName,
  type GameData,
} from '@nogada/shared'
import type { FastifyInstance } from 'fastify'
import { requireAccount } from '../auth/sessions.js'
import { NO_CHARACTER } from '../state/applyToCharacter.js'
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
