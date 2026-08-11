import { randomInt } from 'node:crypto'
import { GatherRequestSchema, createRng, type GameData } from '@nogada/shared'
import type { FastifyInstance } from 'fastify'
import { performGather } from '../services/gatherService.js'
import { NO_CHARACTER, applyToCharacter } from '../state/applyToCharacter.js'
import { LOCAL_PLAYER_ID } from '../state/constants.js'
import type { Persistence } from '../state/persistence.js'

export function registerGatherRoutes(
  app: FastifyInstance,
  store: Persistence,
  data: GameData,
): void {
  app.post('/api/gather', async (request, reply) => {
    const parsed = GatherRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ code: 'bad_request' })

    const result = await applyToCharacter(store, LOCAL_PLAYER_ID, (player) =>
      performGather({
        player,
        data,
        instanceId: parsed.data.instanceId,
        // 시드도 시각도 **판정할 때마다** 새로 만든다. 저장이 밀려 다시 읽으면
        // 그때는 새 상태 위에서 다시 굴려야 한다 — 지나간 상태에서 굴린 주사위를
        // 새 상태에 얹으면 그 결과는 아무 상태에도 속하지 않는다.
        rng: createRng(randomInt(0, 2 ** 31)),
        now: Date.now(),
      }),
    )

    if (!result.ok) {
      return reply.code(result.code === NO_CHARACTER ? 404 : 400).send({ code: result.code })
    }
    return result.outcome
  })
}
