import { EquipRequestSchema, type GameData } from '@nogada/shared'
import type { FastifyInstance } from 'fastify'
import { performEquip } from '../services/equipService.js'
import { requireAccount } from '../auth/sessions.js'
import { NO_CHARACTER, applyToCharacter } from '../state/applyToCharacter.js'
import type { Persistence } from '../state/persistence.js'

export function registerEquipRoutes(
  app: FastifyInstance,
  store: Persistence,
  data: GameData,
): void {
  app.post('/api/equip', async (request, reply) => {
    const parsed = EquipRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ code: 'bad_request' })

    // 채집·제작과 달리 시드도 시각도 만들지 않는다 — 착용은 난수도 행동 간격도
    // 없는 정리 행위다(§6-앞 11). 동시성은 같은 낙관 잠금이 처리한다.
    const result = await applyToCharacter(store, requireAccount(request).characterId, (player) =>
      performEquip({ player, items: data.items, instanceId: parsed.data.instanceId }),
    )

    if (!result.ok) {
      return reply.code(result.code === NO_CHARACTER ? 404 : 400).send({ code: result.code })
    }
    // { player } 통째 — 상태 조회와 같은 모양이라(§6-앞 11) 클라이언트의 적용 경로가 하나다.
    return result.outcome
  })
}
