import { randomInt, randomUUID } from 'node:crypto'
import { CraftRequestSchema, createRng, type GameData } from '@nogada/shared'
import type { FastifyInstance } from 'fastify'
import { performCraft } from '../services/craftService.js'
import { NO_CHARACTER, applyToCharacter } from '../state/applyToCharacter.js'
import { LOCAL_PLAYER_ID } from '../state/constants.js'
import type { Persistence } from '../state/persistence.js'

export function registerCraftRoutes(
  app: FastifyInstance,
  store: Persistence,
  data: GameData,
): void {
  app.post('/api/craft', async (request, reply) => {
    const parsed = CraftRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ code: 'bad_request' })

    const result = await applyToCharacter(store, LOCAL_PLAYER_ID, (player) =>
      performCraft({
        player,
        data,
        recipeId: parsed.data.recipeId,
        // 채집과 같은 이유로 시드·시각은 판정할 때마다 새로 만든다(gather.ts 참고).
        rng: createRng(randomInt(0, 2 ** 31)),
        newId: () => randomUUID(),
        now: Date.now(),
      }),
    )

    if (!result.ok) {
      return reply.code(result.code === NO_CHARACTER ? 404 : 400).send({ code: result.code })
    }
    return result.outcome
  })
}
