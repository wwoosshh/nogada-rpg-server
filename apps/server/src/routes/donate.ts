import { DonateRequestSchema, type GameData } from '@nogada/shared'
import type { FastifyInstance } from 'fastify'
import { performDonate } from '../services/donateService.js'
import { requireAccount } from '../auth/sessions.js'
import { NO_CHARACTER, applyToCharacter } from '../state/applyToCharacter.js'
import type { Persistence } from '../state/persistence.js'

/**
 * 헌납 한 문. 거래(trade.ts)의 배선을 그대로 따르되(§6-앞 12) **아무것도 만들지
 * 않는다** — 시드도 시각도 없다. 상점 문처럼 시각에 따라 열리고 닫히는 자리가
 * 아니고(방은 하나뿐이고 언제나 있다), 무엇이 얼마나 오는가에도 주사위가 없다.
 *
 * 동시 요청은 채집·제작·거래와 같은 applyToCharacter 낙관 잠금이 처리한다.
 */
export function registerDonateRoutes(
  app: FastifyInstance,
  store: Persistence,
  data: GameData,
): void {
  app.post('/api/donate', async (request, reply) => {
    const parsed = DonateRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ code: 'bad_request' })

    const { itemId, count } = parsed.data
    const result = await applyToCharacter(store, requireAccount(request).characterId, (player) =>
      performDonate({ player, data, itemId, count }),
    )

    if (!result.ok) {
      return reply.code(result.code === NO_CHARACTER ? 404 : 400).send({ code: result.code })
    }
    // { player, achieved } — achieved 는 채집·제작 응답과 같은 모양이다(§6-앞 9).
    return result.outcome
  })
}
