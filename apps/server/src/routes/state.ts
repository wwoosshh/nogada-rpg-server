import type { FastifyInstance } from 'fastify'
import { requireAccount } from '../auth/sessions.js'
import { NO_CHARACTER } from '../state/applyToCharacter.js'
import type { Persistence } from '../state/persistence.js'

export function registerStateRoutes(app: FastifyInstance, store: Persistence): void {
  app.get('/api/state', async (request, reply) => {
    // 누구의 상태인가는 요청이 아니라 세션이 정한다 — 클라이언트가 키를 적어
    // 보낼 수 있으면 그것이 곧 남의 진행도를 여는 길이다.
    const player = await store.getCharacter(requireAccount(request).characterId)
    // 없는 캐릭터를 지어내지 않는다 — 만드는 곳은 캐릭터 생성 API 하나뿐이다.
    if (!player) return reply.code(404).send({ code: NO_CHARACTER })
    return { player }
  })
}
