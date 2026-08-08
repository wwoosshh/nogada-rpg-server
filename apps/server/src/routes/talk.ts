import { randomInt } from 'node:crypto'
import { TalkRequestSchema, createRng, type GameData } from '@nogada/shared'
import type { FastifyInstance } from 'fastify'
import { performTalk } from '../services/talkService.js'
import { LOCAL_PLAYER_ID } from '../state/constants.js'
import type { PlayerStore } from '../state/store.js'

export function registerTalkRoutes(
  app: FastifyInstance,
  store: PlayerStore,
  data: GameData,
): void {
  app.post('/api/talk', (request, reply) => {
    const parsed = TalkRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ code: 'bad_request' })

    const player = store.get(LOCAL_PLAYER_ID)
    // 시드는 서버가 매 요청 새로 만든다 — 채집·제작과 같다. 동점인 대사 중
    // 무엇이 나올지도 판정이고, 판정의 무작위성은 서버에서만 나온다.
    const rng = createRng(randomInt(0, 2 ** 31))

    const result = performTalk({
      player,
      data,
      speakerId: parsed.data.speakerId,
      rng,
      now: Date.now(),
    })

    if (!result.ok) return reply.code(400).send({ code: result.code })

    // 대화도 상태를 남긴다(said·recent·lastTalkAt). 저장하지 않으면 같은 인사가
    // 매번 처음처럼 나오고, once 규칙은 영원히 한 번째다.
    store.save(result.outcome.player)
    return result.outcome
  })
}
