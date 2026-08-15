import { InnRequestSchema, type GameData } from '@nogada/shared'
import type { FastifyInstance } from 'fastify'
import { performRest } from '../services/innService.js'
import { requireAccount } from '../auth/sessions.js'
import { NO_CHARACTER, applyToCharacter } from '../state/applyToCharacter.js'
import type { Persistence } from '../state/persistence.js'

/**
 * 여관 문 하나(아크 D §2). 거래(trade.ts)의 배선을 그대로 따르되 시드는 없고
 * — 값도 결과(만혈)도 등록부와 판정이 정한다 — 시각만 만든다: 만혈 판정
 * (currentHp)과 lastHitAt 이 같은 순간을 봐야 한다.
 *
 * 여관은 라우트가 등록부에서 꺼내 서비스에 준다(performRest 의 계약). hasOwn
 * 인 이유는 speakerId 가 클라이언트가 보낸 문자열이라서다 — "constructor" 같은
 * 상속 키가 여관 행세를 하면 안 된다(speakerPresence 의 그 방어).
 */
export function registerInnRoutes(app: FastifyInstance, store: Persistence, data: GameData): void {
  app.post('/api/inn', async (request, reply) => {
    const parsed = InnRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ code: 'bad_request' })

    const { speakerId } = parsed.data
    const inn = Object.hasOwn(data.inns, speakerId) ? data.inns[speakerId] : undefined
    // 등록부에 없는 화자 — 화면은 talk 응답의 inn 으로만 패널을 여므로 정상
    // 조작으로는 오지 않고, 손으로 지은 요청뿐이다. 그래도 코드로 답한다.
    if (!inn) return reply.code(400).send({ code: 'unknown_inn' })

    const result = await applyToCharacter(store, requireAccount(request).characterId, (player) =>
      performRest({ player, data, inn, now: Date.now() }),
    )

    if (!result.ok) {
      return reply.code(result.code === NO_CHARACTER ? 404 : 400).send({ code: result.code })
    }
    // { player } 통째 — 상태 조회와 같은 모양이라 클라이언트의 적용 경로가 하나다.
    return result.outcome
  })
}
