import { EnhanceRequestSchema, type GameData } from '@nogada/shared'
import type { FastifyInstance } from 'fastify'
import { performEnhance } from '../services/equipService.js'
import { requireAccount } from '../auth/sessions.js'
import { NO_CHARACTER, applyToCharacter } from '../state/applyToCharacter.js'
import type { Persistence } from '../state/persistence.js'

export function registerEnhanceRoutes(
  app: FastifyInstance,
  store: Persistence,
  data: GameData,
): void {
  app.post('/api/enhance', async (request, reply) => {
    const parsed = EnhanceRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ code: 'bad_request' })

    // **여기 있던 "GameData 를 받지 않는 유일한 게임 라우트다"는 이제 거짓이다.**
    // 그 말의 근거는 "재료와 대상은 itemId 가 같은 인스턴스라는 규칙(§5)이라 정의
    // 조회 자체가 필요 없다"였는데, 강화가 원작 UL4 로 돌아가면서(§6-앞 11·12)
    // 두 가지를 카탈로그에서 읽어야 한다: 도구의 **티어**(어느 사다리를 타는가)와
    // 그 티어·단계의 **비용표**(무엇을 얼마나 먹는가). 이 라우트도 다른 게임
    // 라우트와 같은 모양이 됐다.
    //
    // 그대로인 것: 강화는 성공 100%(v1)이라 시드를 만들지 않고, 행동 간격도 없다
    // (§6-앞 11 — 정리 행위는 행동이 아니다).
    const result = await applyToCharacter(store, requireAccount(request).characterId, (player) =>
      performEnhance({
        player,
        items: data.items,
        costs: data.enhanceCosts,
        materialInstanceId: parsed.data.materialInstanceId,
      }),
    )

    if (!result.ok) {
      return reply.code(result.code === NO_CHARACTER ? 404 : 400).send({ code: result.code })
    }
    // { player } 통째 — 상태 조회와 같은 모양이라(§6-앞 11) 클라이언트의 적용 경로가 하나다.
    return result.outcome
  })
}
