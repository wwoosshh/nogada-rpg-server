import { EnhanceRequestSchema } from '@nogada/shared'
import type { FastifyInstance } from 'fastify'
import { performEnhance } from '../services/equipService.js'
import { requireAccount } from '../auth/sessions.js'
import { NO_CHARACTER, applyToCharacter } from '../state/applyToCharacter.js'
import type { Persistence } from '../state/persistence.js'

export function registerEnhanceRoutes(app: FastifyInstance, store: Persistence): void {
  app.post('/api/enhance', async (request, reply) => {
    const parsed = EnhanceRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ code: 'bad_request' })

    // GameData 를 받지 않는 유일한 게임 라우트다 — 재료와 대상은 itemId 가 같은
    // 인스턴스라는 규칙(§5)이라 정의 조회 자체가 필요 없다. 강화는 성공 100%(v1)
    // 이므로 시드도 만들지 않고, 행동 간격도 없다(§6-앞 11 — 정리 행위).
    const result = await applyToCharacter(store, requireAccount(request).characterId, (player) =>
      performEnhance({ player, materialInstanceId: parsed.data.materialInstanceId }),
    )

    if (!result.ok) {
      return reply.code(result.code === NO_CHARACTER ? 404 : 400).send({ code: result.code })
    }
    // { player } 통째 — 상태 조회와 같은 모양이라(§6-앞 11) 클라이언트의 적용 경로가 하나다.
    return result.outcome
  })
}
