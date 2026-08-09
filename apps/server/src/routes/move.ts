import { MoveRequestSchema, type GameData } from '@nogada/shared'
import type { FastifyInstance } from 'fastify'
import { moveThroughTransition } from '../services/moveService.js'
import { LOCAL_PLAYER_ID } from '../state/constants.js'
import type { PlayerStore } from '../state/store.js'

export function registerMoveRoutes(app: FastifyInstance, store: PlayerStore, data: GameData): void {
  app.post('/api/move', (request, reply) => {
    const parsed = MoveRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ code: 'bad_request' })

    const player = store.get(LOCAL_PLAYER_ID)
    // 대화·채집과 달리 난수를 만들지 않는다 — 전환에는 고를 것이 없다.
    // 어느 칸에서 어디로 가는지는 전환표가 이미 정해 두었다.
    const result = moveThroughTransition({ player, data, x: parsed.data.x, y: parsed.data.y })

    if (!result.ok) return reply.code(400).send({ code: result.code })

    // 저장하지 않으면 새로고침할 때마다 첫 맵으로 돌아간다 — 위치를 서버가
    // 갖기로 한 이유가 정확히 그것이다.
    store.save(result.outcome.player)
    return result.outcome
  })
}
