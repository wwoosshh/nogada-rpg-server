import { UseRequestSchema, type GameData } from '@nogada/shared'
import type { FastifyInstance } from 'fastify'
import { requireAccount } from '../auth/sessions.js'
import { performUse } from '../services/useService.js'
import { NO_CHARACTER, applyToCharacter } from '../state/applyToCharacter.js'
import type { Persistence } from '../state/persistence.js'

/**
 * 사용 한 문. 착용(equip.ts)의 배선을 그대로 따르되 **시각을 만든다** — 날씨가
 * 언제 그치는지를 적어야 하기 때문이다(거래 라우트가 상점 문 때문에 시각을
 * 만드는 것과 같은 자리).
 *
 * 시드는 없다(무엇이 얼마나 오는가에 주사위가 없다). 행동 간격도 없다 — 사용은
 * 정리와 같은 손짓이지 행동이 아니다(useService 의 머리말).
 */
export function registerUseRoutes(app: FastifyInstance, store: Persistence, data: GameData): void {
  app.post('/api/use', async (request, reply) => {
    const parsed = UseRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ code: 'bad_request' })

    const result = await applyToCharacter(store, requireAccount(request).characterId, (player) =>
      performUse({ player, items: data.items, itemId: parsed.data.itemId, now: Date.now() }),
    )

    if (!result.ok) {
      return reply.code(result.code === NO_CHARACTER ? 404 : 400).send({ code: result.code })
    }
    // { player } 통째 — 상태 조회와 같은 모양이라 클라이언트의 적용 경로가 하나다.
    return result.outcome
  })
}
