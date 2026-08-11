import { randomInt } from 'node:crypto'
import { TalkRequestSchema, createRng, type GameData } from '@nogada/shared'
import type { FastifyInstance } from 'fastify'
import { performTalk } from '../services/talkService.js'
import { NO_CHARACTER, applyToCharacter } from '../state/applyToCharacter.js'
import { LOCAL_PLAYER_ID } from '../state/constants.js'
import type { Persistence } from '../state/persistence.js'

export function registerTalkRoutes(app: FastifyInstance, store: Persistence, data: GameData): void {
  app.post('/api/talk', async (request, reply) => {
    const parsed = TalkRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ code: 'bad_request' })

    // 대화도 상태를 남긴다(said·recent·lastTalkAt). 저장하지 않으면 같은 인사가
    // 매번 처음처럼 나오고, once 규칙은 영원히 한 번째다 — 그래서 이것도 읽고
    // 판정하고 쓰는 한 덩어리다.
    const result = await applyToCharacter(store, LOCAL_PLAYER_ID, (player) =>
      performTalk({
        player,
        data,
        speakerId: parsed.data.speakerId,
        // 동점인 대사 중 무엇이 나올지도 판정이고, 판정의 무작위성은 서버에서만
        // 나온다. 시각도 마찬가지다 — 다시 읽으면 그때의 시각으로 다시 고른다.
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
