import { randomInt, randomUUID } from 'node:crypto'
import { CraftRequestSchema, createRng, type GameData } from '@nogada/shared'
import type { FastifyInstance } from 'fastify'
import { performCraft } from '../services/craftService.js'
import { LOCAL_PLAYER_ID } from '../state/constants.js'
import type { PlayerStore } from '../state/store.js'

export function registerCraftRoutes(
  app: FastifyInstance,
  store: PlayerStore,
  data: GameData,
): void {
  app.post('/api/craft', (request, reply) => {
    const parsed = CraftRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ code: 'bad_request' })

    const player = store.get(LOCAL_PLAYER_ID)
    // 시드는 서버가 매 요청 새로 만든다. 클라이언트는 관여할 수 없다.
    const rng = createRng(randomInt(0, 2 ** 31))

    const result = performCraft({
      player,
      data,
      recipeId: parsed.data.recipeId,
      rng,
      newId: () => randomUUID(),
    })

    if (!result.ok) return reply.code(400).send({ code: result.code })

    store.save(result.outcome.player)
    return result.outcome
  })
}
