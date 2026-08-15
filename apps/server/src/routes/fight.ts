import { randomInt } from 'node:crypto'
import { createRng, FightRequestSchema, type GameData, type PlayerLocation } from '@nogada/shared'
import type { FastifyInstance } from 'fastify'
import { requireAccount } from '../auth/sessions.js'
import { NO_CHARACTER, applyToCharacter } from '../state/applyToCharacter.js'
import type { Persistence } from '../state/persistence.js'
import { performFight, type MonsterWorld } from '../services/fightService.js'

export function registerFightRoutes(
  app: FastifyInstance,
  store: Persistence,
  data: GameData,
  world: MonsterWorld,
  spawn: PlayerLocation,
): void {
  app.post('/api/fight', async (request, reply) => {
    const parsed = FightRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ code: 'bad_request' })

    const result = await applyToCharacter(store, requireAccount(request).characterId, (player) =>
      performFight({
        player,
        data,
        ...world,
        spawn,
        instanceId: parsed.data.instanceId,
        claim: { x: parsed.data.x, y: parsed.data.y },
        // 시드도 시각도 판정할 때마다 새로 만든다(gather 라우트의 그 이유) —
        // 저장이 밀려 다시 판정하면 새 상태 위에서 새 주사위를 굴려야 한다.
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
