import type { FastifyInstance } from 'fastify'
import { LOCAL_PLAYER_ID } from '../state/constants.js'
import { NO_CHARACTER } from '../state/applyToCharacter.js'
import type { Persistence } from '../state/persistence.js'

export function registerStateRoutes(app: FastifyInstance, store: Persistence): void {
  app.get('/api/state', async (_request, reply) => {
    const player = await store.getCharacter(LOCAL_PLAYER_ID)
    // 없는 캐릭터를 지어내지 않는다 — 만드는 곳은 캐릭터 생성 API 하나뿐이다.
    if (!player) return reply.code(404).send({ code: NO_CHARACTER })
    return { player }
  })
}
