import { randomInt } from 'node:crypto'
import { GatherRequestSchema, createRng, type GameData } from '@nogada/shared'
import type { FastifyInstance } from 'fastify'
import { performGather } from '../services/gatherService.js'
import { LOCAL_PLAYER_ID } from '../state/constants.js'
import type { PlayerStore } from '../state/store.js'

export function registerGatherRoutes(
  app: FastifyInstance,
  store: PlayerStore,
  data: GameData,
): void {
  app.post('/api/gather', (request, reply) => {
    const parsed = GatherRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ code: 'bad_request' })

    const player = store.get(LOCAL_PLAYER_ID)
    // 시드는 서버가 매 요청 새로 만든다. 클라이언트는 관여할 수 없다.
    const rng = createRng(randomInt(0, 2 ** 31))

    const result = performGather({
      player,
      data,
      nodeId: parsed.data.nodeId,
      rng,
      now: Date.now(),
    })

    if (!result.ok) {
      const status = result.code === 'on_cooldown' ? 409 : 400
      return reply.code(status).send(
        result.availableAt === undefined
          ? { code: result.code }
          : { code: result.code, availableAt: result.availableAt },
      )
    }

    store.save(result.outcome.player)
    return result.outcome
  })
}
