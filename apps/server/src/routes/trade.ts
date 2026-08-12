import { BuyRequestSchema, SellRequestSchema, type GameData } from '@nogada/shared'
import type { FastifyInstance } from 'fastify'
import { performBuy, performSell } from '../services/tradeService.js'
import { requireAccount } from '../auth/sessions.js'
import { NO_CHARACTER, applyToCharacter } from '../state/applyToCharacter.js'
import type { Persistence } from '../state/persistence.js'

/**
 * 거래 두 문. 착용(equip.ts)의 배선을 그대로 따르되 **시각만 만든다**.
 *
 * 시드는 없다 — 무엇을 얼마에 사고파는가에 주사위가 없다. 행동 간격도 없다
 * (§6-앞 18 — 거래는 행동이 아니다). 시각이 필요한 이유는 하나뿐이다: 상점 문은
 * 화자가 그 자리에 서 있을 때만 열리고, 화자는 밤이면 실내로 들어간다(§6-앞 4).
 * 대화 라우트가 같은 이유로 `Date.now()` 를 넣는다.
 *
 * 동시 요청은 채집·제작과 같은 applyToCharacter 낙관 잠금이 처리한다 — 같은 계정의
 * 두 창이 같은 스택을 동시에 팔면 늦은 쪽은 자기 눈으로 줄어든 스택을 다시 본다.
 */
export function registerTradeRoutes(
  app: FastifyInstance,
  store: Persistence,
  data: GameData,
): void {
  app.post('/api/shop/sell', async (request, reply) => {
    const parsed = SellRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ code: 'bad_request' })

    const { shopId, itemId, count } = parsed.data
    const result = await applyToCharacter(store, requireAccount(request).characterId, (player) =>
      performSell({ player, data, shopId, itemId, count, now: Date.now() }),
    )

    if (!result.ok) {
      return reply.code(result.code === NO_CHARACTER ? 404 : 400).send({ code: result.code })
    }
    // { player } 통째 — 상태 조회와 같은 모양이라 클라이언트의 적용 경로가 하나다.
    return result.outcome
  })

  app.post('/api/shop/buy', async (request, reply) => {
    const parsed = BuyRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ code: 'bad_request' })

    const { shopId, itemId, count } = parsed.data
    const result = await applyToCharacter(store, requireAccount(request).characterId, (player) =>
      performBuy({ player, data, shopId, itemId, count, now: Date.now() }),
    )

    if (!result.ok) {
      return reply.code(result.code === NO_CHARACTER ? 404 : 400).send({ code: result.code })
    }
    return result.outcome
  })
}
